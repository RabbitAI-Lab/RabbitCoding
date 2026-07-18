use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, Manager, State};

use crate::process_ext::CommandNoWindowExt;

/// Sidecar 进程状态
pub struct SidecarState {
    inner: Mutex<Option<SidecarHandle>>,
}

struct SidecarHandle {
    stdin: std::process::ChildStdin,
    child: std::process::Child,
}

impl Drop for SidecarHandle {
    fn drop(&mut self) {
        // 应用退出 / SidecarState 释放时自动 kill 子进程，
        // 避免 Node.js sidecar 成为孤儿进程（尤其实际关闭主窗口的场景）。
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// 启动 sidecar 的参数
#[derive(Debug, Deserialize)]
pub struct StartSidecarPayload {
    pub api_key: String,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub env_vars: Option<HashMap<String, String>>,
}

/// 向 sidecar 发送消息的参数
#[derive(Debug, Deserialize)]
pub struct SendMessagePayload {
    pub message: String,
}

/// 通用返回结构
#[derive(Debug, Serialize)]
pub struct SidecarResult {
    pub success: bool,
    pub error: Option<String>,
}

/// sidecar 状态查询结果
#[derive(Debug, Serialize)]
pub struct SidecarStatus {
    pub running: bool,
}

/// Agent 消息事件 payload（从 sidecar stdout 读取的 JSON 行）
#[derive(Debug, Serialize, Clone)]
pub struct AgentEventPayload {
    pub data: String,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

/// 启动 sidecar 进程
#[command]
pub fn start_sidecar(
    app: AppHandle,
    state: State<'_, SidecarState>,
    payload: StartSidecarPayload,
) -> SidecarResult {
    let mut guard = state.inner.lock().unwrap();

    // 检查是否已有运行中的进程
    if let Some(ref mut handle) = *guard {
        // 尝试检查进程是否还活着
        match handle.child.try_wait() {
            Ok(Some(_status)) => {
                // 进程已退出，清理旧 handle
                let _ = guard.take();
            }
            Ok(None) => {
                // 进程仍在运行，无需重新启动
                return SidecarResult {
                    success: true,
                    error: None,
                };
            }
            Err(_) => {
                let _ = guard.take();
            }
        }
    }

    // 获取 sidecar 脚本路径
    let sidecar_path = get_sidecar_path(&app);

    // 构建 Command 并动态注入环境变量
    // Windows: CREATE_NO_WINDOW，否则 GUI 应用拉起 node.exe 会弹出常驻控制台黑窗
    let mut cmd = std::process::Command::new(&sidecar_path.program);
    cmd.args(&sidecar_path.args);
    cmd.no_window();

    // 0. 清理从父进程（Tauri app / shell）继承的 ANTHROPIC_* 环境变量。
    //    确保 sidecar 的模型配置完全由本应用的 BYOK 注入决定，
    //    不被 shell 环境遗留变量干扰（例如 ANTHROPIC_AUTH_TOKEN 的优先级
    //    高于 ANTHROPIC_API_KEY，若不清理会压过 BYOK 的 key）。
    //    settings.json 的 env 字段由 SDK 端 settingSources:[] 隔离。
    for var in [
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
        "CLAUDE_CODE_DISABLE_1M_CONTEXT",
    ] {
        cmd.env_remove(var);
    }

    // 0b. 将 Claude Code 配置根目录重定向到应用专用目录，彻底隔离用户全局 ~/.claude/。
    //     这是阻断 plugins / skills / agents / commands / hooks / marketplace / rules /
    //     output-styles 等全局资源泄漏进 sidecar 的主手段（这些不受 settingSources 控制，
    //     只能换配置根目录）。目录初始为空 → 不加载任何用户全局插件/技能/代理；
    //     Claude Code 在其中维护本应用独立的运行时文件（sessions/projects 等），
    //     与用户 CLI 完全隔离。
    let claude_home = match app.path().app_local_data_dir() {
        Ok(d) => d.join("claude-home"),
        Err(_) => std::env::var("HOME")
            .map(|h| std::path::PathBuf::from(h).join(".rabbit-claude-home"))
            .unwrap_or_else(|_| std::path::PathBuf::from(".rabbit-claude-home")),
    };
    let _ = std::fs::create_dir_all(&claude_home);
    cmd.env("CLAUDE_CONFIG_DIR", &claude_home);

    // 1. 主 API Key 环境变量
    cmd.env("ANTHROPIC_API_KEY", &payload.api_key);

    // 2. Base URL（设置 ANTHROPIC_BASE_URL）
    if let Some(ref base_url) = payload.base_url {
        if !base_url.is_empty() {
            cmd.env("ANTHROPIC_BASE_URL", base_url);
        }
    }

    // 诊断日志：打印注入的模型配置（脱敏）
    let key_prefix: String = payload.api_key.chars().take(12).collect();
    eprintln!("[sidecar] Injected ANTHROPIC_API_KEY prefix: {}...", key_prefix);
    eprintln!("[sidecar] Injected ANTHROPIC_BASE_URL: {}", payload.base_url.as_deref().unwrap_or("(default)"));

    // 3. 自定义环境变量（含 apiKeyEnvVar 映射）
    if let Some(ref vars) = payload.env_vars {
        for (k, v) in vars {
            if !k.is_empty() {
                cmd.env(k, v);
            }
        }
    }

    let mut child = match cmd
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            return SidecarResult {
                success: false,
                error: Some(format!("Failed to spawn sidecar: {}", e)),
            }
        }
    };

    let stdin = child.stdin.take().expect("stdin should be available");
    let stdout = child.stdout.take().expect("stdout should be available");
    let stderr = child.stderr.take().expect("stderr should be available");

    *guard = Some(SidecarHandle { stdin, child });

    // drop guard before spawning threads
    drop(guard);

    // 启动 stdout 读取线程
    let app_stdout = app.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    if !text.trim().is_empty() {
                        let _ = app_stdout.emit("agent:message", AgentEventPayload { data: text });
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app_stdout.emit(
            "agent:sidecar-exit",
            serde_json::json!({ "reason": "stdout closed" }),
        );
    });

    // 启动 stderr 读取线程（日志）
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    eprintln!("[sidecar] {}", text);
                }
                Err(_) => break,
            }
        }
    });

    SidecarResult {
        success: true,
        error: None,
    }
}

/// 向 sidecar stdin 发送消息
#[command]
pub fn send_to_sidecar(
    state: State<'_, SidecarState>,
    payload: SendMessagePayload,
) -> SidecarResult {
    let mut guard = state.inner.lock().unwrap();

    match *guard {
        Some(ref mut handle) => {
            use std::io::Write;
            match writeln!(handle.stdin, "{}", payload.message) {
                Ok(_) => SidecarResult {
                    success: true,
                    error: None,
                },
                Err(e) => SidecarResult {
                    success: false,
                    error: Some(format!("Failed to write to sidecar stdin: {}", e)),
                },
            }
        }
        None => SidecarResult {
            success: false,
            error: Some("Sidecar is not running".to_string()),
        },
    }
}

/// 停止 sidecar 进程
#[command]
pub fn stop_sidecar(state: State<'_, SidecarState>) -> SidecarResult {
    let mut guard = state.inner.lock().unwrap();

    match *guard {
        Some(ref mut handle) => {
            // 先尝试发送 shutdown 命令
            use std::io::Write;
            let _ = writeln!(handle.stdin, r#"{{"type":"shutdown"}}"#);
            // 给一点时间让 sidecar 优雅退出
            std::thread::sleep(std::time::Duration::from_millis(500));
            let _ = handle.child.kill();
            let _ = handle.child.wait();
            *guard = None;
            SidecarResult {
                success: true,
                error: None,
            }
        }
        None => SidecarResult {
            success: true,
            error: None,
        },
    }
}

/// 查询 sidecar 运行状态
#[command]
pub fn get_sidecar_status(state: State<'_, SidecarState>) -> SidecarStatus {
    let guard = state.inner.lock().unwrap();
    SidecarStatus {
        running: guard.is_some(),
    }
}

/// sidecar 脚本路径信息
struct SidecarPath {
    program: String,
    args: Vec<String>,
}

/// 获取 sidecar 脚本路径
/// 开发模式：使用 node + tsx 直接运行 TypeScript 源码（无需预编译）
/// 生产模式：使用内置 Node.js 运行 sidecar bundle（resources/sidecar/sidecar-bundle.js）
fn get_sidecar_path(app: &AppHandle) -> SidecarPath {
    let is_dev = cfg!(debug_assertions);

    if is_dev {
        // 开发模式：使用 npx tsx 直接运行 ts 源码
        // 不使用 dist/ 编译产物，避免编译产物过期导致代码不生效
        // tsx 运行时可以正常 require() node_modules 中的 native binary
        let sidecar_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sidecar");

        #[cfg(target_os = "windows")]
        let npx_program = "npx.cmd";
        #[cfg(not(target_os = "windows"))]
        let npx_program = "npx";
        let src_path = sidecar_dir.join("src").join("index.ts");
        SidecarPath {
            program: npx_program.to_string(),
            args: vec!["tsx".to_string(), src_path.to_string_lossy().to_string()],
        }
    } else {
        // 生产模式：使用内置 Node.js 运行 sidecar bundle
        // 通过 app.path().resource_dir() 获取资源目录
        match app.path().resource_dir() {
            Ok(resource_dir) => {
                // Tauri 打包时保留 src-tauri/ 的相对路径结构，
                // tauri.conf.json 中 "resources/sidecar" → Contents/Resources/resources/sidecar/
                let resources_dir = resource_dir.join("resources");
                let node_bin = resources_dir
                    .join("node-runtime")
                    .join(if cfg!(target_os = "windows") {
                        "node.exe"
                    } else {
                        "bin/node"
                    });
                let sidecar_js = resources_dir
                    .join("sidecar")
                    .join("sidecar-bundle.js");
                println!(
                    "[sidecar] production mode: node={}, sidecar={}",
                    node_bin.display(),
                    sidecar_js.display()
                );
                SidecarPath {
                    program: node_bin.to_string_lossy().to_string(),
                    args: vec![sidecar_js.to_string_lossy().to_string()],
                }
            }
            Err(e) => {
                eprintln!("[sidecar] failed to get resource dir: {e}, falling back to PATH node");
                SidecarPath {
                    program: "node".to_string(),
                    args: vec!["sidecar-bundle.js".to_string()],
                }
            }
        }
    }
}
