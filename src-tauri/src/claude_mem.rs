use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use crate::process_ext::CommandNoWindowExt;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter, Manager};

// ============================================================
// 数据结构（camelCase 对齐前端字段名，与 EccCheckResult 一致）
// ============================================================

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMemCheckResult {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMemProgress {
    pub status: String,
    pub message: String,
    pub timestamp: u64,
}

/// installed_plugins.json 的最小化反序列化结构（只需检测键是否存在 + 取版本）
#[derive(Debug, Deserialize)]
struct InstalledPluginsFile {
    #[serde(default)]
    plugins: HashMap<String, Vec<PluginInstallEntry>>,
}

#[derive(Debug, Deserialize)]
struct PluginInstallEntry {
    version: Option<String>,
}

// ============================================================
// 辅助函数
// ============================================================

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 获取应用专用 Claude 配置目录。
/// ★★★ 关键：必须与 sidecar.rs 的 CLAUDE_CONFIG_DIR 逻辑完全一致 ★★★
/// 否则插件会装到全局 ~/.claude/ 而非应用专用目录，sidecar 无法加载。
pub(crate) fn get_claude_config_dir(app: &AppHandle) -> PathBuf {
    match app.path().app_local_data_dir() {
        Ok(d) => d.join("claude-home"),
        Err(_) => std::env::var("HOME")
            .map(|h| PathBuf::from(h).join(".rabbit-claude-home"))
            .unwrap_or_else(|_| PathBuf::from(".rabbit-claude-home")),
    }
}

/// 查找 claude CLI（参考 ecc.rs find_npx 逻辑，适配 claude 特性）
/// 返回 (program_path, prefix_args) —— claude 不需要 prefix_args，返回空 Vec
pub(crate) fn find_claude() -> Option<(String, Vec<String>)> {
    // 跨平台 claude 命令名
    #[cfg(target_os = "windows")]
    let claude_cmd = "claude.cmd";
    #[cfg(not(target_os = "windows"))]
    let claude_cmd = "claude";

    // 1. 直接尝试 claude --version
    let direct = Command::new(claude_cmd).arg("--version").no_window().output();
    if let Ok(out) = &direct {
        if out.status.success() {
            return Some((claude_cmd.into(), vec![]));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // 2. Windows: 通过 cmd where 查找
        let shell_check = Command::new("cmd")
            .arg("/C")
            .arg("where claude 2>nul")
            .no_window()
            .output();
        if let Ok(o) = &shell_check {
            if o.status.success() {
                let path = String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() && PathBuf::from(&path).exists() {
                    return Some((path, vec![]));
                }
            }
        }

        // 3. Windows 常见路径
        let mut candidates: Vec<String> = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(format!("{}\\npm\\claude.cmd", appdata));
        }
        if let Ok(programfiles) = std::env::var("PROGRAMFILES") {
            candidates.push(format!("{}\\nodejs\\claude.cmd", programfiles));
        }
        for candidate in &candidates {
            if PathBuf::from(candidate).exists() {
                return Some((candidate.clone(), vec![]));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // 2. macOS / Linux: 通过 shell which 查找
        let shell_check = Command::new("sh")
            .arg("-c")
            .arg("which claude 2>/dev/null")
            .output();
        if let Ok(o) = &shell_check {
            if o.status.success() {
                let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !path.is_empty() && PathBuf::from(&path).exists() {
                    return Some((path, vec![]));
                }
            }
        }

        // 3. macOS / Linux 常见路径（claude CLI 常通过 npm/volta/local 安装）
        let mut candidates: Vec<String> = vec![
            "/usr/local/bin/claude".into(),
            "/opt/homebrew/bin/claude".into(),
        ];
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(format!("{}/.local/bin/claude", home));
            candidates.push(format!("{}/.npm-global/bin/claude", home));
            candidates.push(format!("{}/.local/share/npm/bin/claude", home));
            candidates.push(format!("{}/.volta/bin/claude", home));
            candidates.push(format!("{}/.bun/bin/claude", home));
        }
        for candidate in &candidates {
            if PathBuf::from(candidate).exists() {
                return Some((candidate.clone(), vec![]));
            }
        }
    }

    None
}

/// 构建带 CLAUDE_CONFIG_DIR 注入的 claude Command
pub(crate) fn claude_command(claude_path: &str, config_dir: &PathBuf) -> Command {
    let mut cmd = Command::new(claude_path);
    cmd.no_window();
    // ★★★ 核心注入点：与 sidecar 完全一致的配置根目录 ★★★
    cmd.env("CLAUDE_CONFIG_DIR", config_dir);
    cmd
}

/// 读取子进程 stdout/stderr 并实时 emit 进度（抽自 ecc.rs 的两段线程逻辑）
fn emit_child_output(app: &AppHandle, child: &mut std::process::Child, event_name: &str) {
    if let Some(stdout) = child.stdout.take() {
        let app_out = app.clone();
        let ev = event_name.to_string();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        let _ = app_out.emit(
                            &ev,
                            ClaudeMemProgress {
                                status: "running".into(),
                                message: trimmed.into(),
                                timestamp: now_ms(),
                            },
                        );
                    }
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app_err = app.clone();
        let ev = event_name.to_string();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        let _ = app_err.emit(
                            &ev,
                            ClaudeMemProgress {
                                status: "running".into(),
                                message: trimmed.into(),
                                timestamp: now_ms(),
                            },
                        );
                    }
                }
            }
        });
    }
}

// ============================================================
// Tauri Commands
// ============================================================

/// 检测 claude-mem 是否已安装
/// 策略：读取 {CLAUDE_CONFIG_DIR}/plugins/installed_plugins.json，
///       检查是否存在以 "claude-mem" 开头的键（兼容 claude-mem@claude-mem 等键名）
#[command]
pub async fn claude_mem_check(app: AppHandle) -> Result<ClaudeMemCheckResult, String> {
    let config_dir = get_claude_config_dir(&app);
    let installed_json = config_dir.join("plugins").join("installed_plugins.json");

    // 兜底信号：claude-mem installer 数据目录（不受 CLAUDE_CONFIG_DIR 影响）
    let claude_mem_data_marker = std::env::var("HOME")
        .map(|h| PathBuf::from(h).join(".claude-mem").join(".install-version"))
        .ok();

    if !installed_json.exists() {
        // installed_plugins.json 不存在，但若 claude-mem installer 跑过也算"曾安装"
        let data_installed = claude_mem_data_marker
            .as_ref()
            .map(|p| p.exists())
            .unwrap_or(false);
        return Ok(ClaudeMemCheckResult {
            installed: data_installed,
            version: None,
        });
    }

    let content = std::fs::read_to_string(&installed_json)
        .map_err(|e| format!("Failed to read installed_plugins.json: {}", e))?;

    let parsed: InstalledPluginsFile = match serde_json::from_str(&content) {
        Ok(p) => p,
        Err(_) => {
            return Ok(ClaudeMemCheckResult {
                installed: false,
                version: None,
            });
        }
    };

    // 键格式: "claude-mem@<marketplace-name>"，匹配任何以 claude-mem 开头的键
    let mut found_version: Option<String> = None;
    let installed = parsed.plugins.keys().any(|key| {
        let plugin_name = key.split('@').next().unwrap_or(key);
        if plugin_name == "claude-mem" || plugin_name == "claude_mem" {
            // 记录版本
            if let Some(entries) = parsed.plugins.get(key) {
                if let Some(first) = entries.first() {
                    if let Some(ref v) = first.version {
                        found_version = Some(v.clone());
                    }
                }
            }
            true
        } else {
            false
        }
    });

    Ok(ClaudeMemCheckResult {
        installed,
        version: found_version,
    })
}

/// 安装 claude-mem（两步：marketplace add → plugin install）
/// 后台执行，实时 emit "claude-mem-install-progress" 事件
#[command]
pub async fn claude_mem_install(app: AppHandle) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let (program, _prefix) = find_claude().ok_or_else(|| {
            "claude CLI not found. Please install Claude Code CLI first from https://claude.ai"
                .to_string()
        })?;

        let config_dir = get_claude_config_dir(&app);
        // 确保配置目录存在
        let _ = std::fs::create_dir_all(&config_dir);

        // ---------- 第一步：添加市场源 ----------
        let _ = app.emit(
            "claude-mem-install-progress",
            ClaudeMemProgress {
                status: "running".into(),
                message: "Adding marketplace source (thedotmack/claude-mem)...".into(),
                timestamp: now_ms(),
            },
        );

        let mut cmd1 = claude_command(&program, &config_dir);
        cmd1.args([
            "plugin",
            "marketplace",
            "add",
            "thedotmack/claude-mem",
            "--scope",
            "user",
        ]);
        cmd1.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child1 = cmd1
            .spawn()
            .map_err(|e| format!("Failed to spawn marketplace add: {}", e))?;

        emit_child_output(&app, &mut child1, "claude-mem-install-progress");

        let status1 = child1
            .wait()
            .map_err(|e| format!("Wait marketplace add failed: {}", e))?;

        // marketplace add 可能返回非零（市场已存在），不视为致命错误
        if !status1.success() {
            let _ = app.emit(
                "claude-mem-install-progress",
                ClaudeMemProgress {
                    status: "running".into(),
                    message: "Marketplace may already exist, continuing to install...".into(),
                    timestamp: now_ms(),
                },
            );
        }

        // ---------- 第二步：安装插件 ----------
        let _ = app.emit(
            "claude-mem-install-progress",
            ClaudeMemProgress {
                status: "running".into(),
                message: "Installing claude-mem plugin...".into(),
                timestamp: now_ms(),
            },
        );

        let mut cmd2 = claude_command(&program, &config_dir);
        cmd2.args(["plugin", "install", "claude-mem", "-s", "user"]);
        cmd2.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child2 = match cmd2.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "claude-mem-install-progress",
                    ClaudeMemProgress {
                        status: "error".into(),
                        message: format!("Failed to spawn install: {}", e),
                        timestamp: now_ms(),
                    },
                );
                return Err(format!("Failed to spawn install: {}", e));
            }
        };

        emit_child_output(&app, &mut child2, "claude-mem-install-progress");

        let status2 = child2
            .wait()
            .map_err(|e| format!("Wait install failed: {}", e))?;

        if status2.success() {
            let _ = app.emit(
                "claude-mem-install-progress",
                ClaudeMemProgress {
                    status: "done".into(),
                    message: "claude-mem installation completed".into(),
                    timestamp: now_ms(),
                },
            );
            Ok(true)
        } else {
            // 降级重试：尝试 claude-mem@claude-mem 精确指定市场
            let _ = app.emit(
                "claude-mem-install-progress",
                ClaudeMemProgress {
                    status: "running".into(),
                    message: "Retrying with explicit marketplace name...".into(),
                    timestamp: now_ms(),
                },
            );

            let mut cmd3 = claude_command(&program, &config_dir);
            cmd3.args([
                "plugin", "install", "claude-mem@claude-mem", "-s", "user",
            ]);
            cmd3.stdout(Stdio::piped()).stderr(Stdio::piped());

            let mut child3 = match cmd3.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = app.emit(
                        "claude-mem-install-progress",
                        ClaudeMemProgress {
                            status: "error".into(),
                            message: format!("Install failed: {}", e),
                            timestamp: now_ms(),
                        },
                    );
                    return Err(format!("claude-mem install failed: {}", e));
                }
            };

            emit_child_output(&app, &mut child3, "claude-mem-install-progress");

            let status3 = child3
                .wait()
                .map_err(|e| format!("Wait retry install failed: {}", e))?;

            if status3.success() {
                let _ = app.emit(
                    "claude-mem-install-progress",
                    ClaudeMemProgress {
                        status: "done".into(),
                        message: "claude-mem installation completed".into(),
                        timestamp: now_ms(),
                    },
                );
                Ok(true)
            } else {
                let _ = app.emit(
                    "claude-mem-install-progress",
                    ClaudeMemProgress {
                        status: "error".into(),
                        message: format!("Install failed, exit code: {:?}", status3.code()),
                        timestamp: now_ms(),
                    },
                );
                Err(format!("claude-mem install failed: {:?}", status3.code()))
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 卸载 claude-mem（仅卸载插件，不删除 ~/.claude-mem 数据目录以免丢失记忆）
#[command]
pub async fn claude_mem_uninstall(app: AppHandle) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let (program, _prefix) =
            find_claude().ok_or_else(|| "claude CLI not found. Cannot uninstall.".to_string())?;

        let config_dir = get_claude_config_dir(&app);

        let mut cmd = claude_command(&program, &config_dir);
        cmd.args(["plugin", "uninstall", "claude-mem"]);

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run uninstall: {}", e))?;

        let stdout_str = String::from_utf8_lossy(&output.stdout);
        let stderr_str = String::from_utf8_lossy(&output.stderr);

        // 卸载即使返回非零（插件本来就没装），也视为成功清理
        Ok(output.status.success()
            || stderr_str.contains("not installed")
            || stdout_str.contains("not installed"))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}
