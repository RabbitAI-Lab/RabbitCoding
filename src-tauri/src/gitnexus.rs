use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use crate::process_ext::CommandNoWindowExt;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter, Manager};

// ============================================================
// 数据结构（camelCase 对齐前端字段名）
// ============================================================

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitnexusItem {
    pub name: String,
    pub path: String,
    pub indexed: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitnexusCheckResult {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitnexusProgress {
    pub item_key: String,
    pub workspace_id: String,
    pub item_type: String,
    pub status: String,
    pub message: String,
    pub timestamp: u64,
}

// ============================================================
// 内部辅助函数
//
// 核心策略：内置 node-runtime + 应用私有 prefix，dev/prod 完全同构。
// 不依赖系统 PATH / 系统 npm / 系统 gitnexus —— 彻底隔离，对齐 sidecar 架构。
// install 用 `node <内置 npm-cli.js> install -g --prefix=<私有目录> gitnexus`；
// 运行用 `node <私有目录>/.../gitnexus/dist/cli/index.js <子命令>`。
// ============================================================

/// 当前 unix 时间戳（毫秒）
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 解析 resources/ 下的相对路径（dev/prod 双保险）
/// prod: <app>/Contents/Resources/resources/...；dev: src-tauri/resources/...
fn resource_path(app: &AppHandle, rel: &[&str]) -> Option<PathBuf> {
    let lookup = |base: PathBuf| {
        let mut p = base;
        for r in rel {
            p.push(r);
        }
        p.exists().then_some(p)
    };
    // 1. resource_dir（dev & prod 都应解析到 resources 目录）
    if let Ok(rd) = app.path().resource_dir() {
        if let Some(p) = lookup(rd.join("resources")) {
            return Some(p);
        }
    }
    // 2. dev 兜底：编译期 CARGO_MANIFEST_DIR（即 src-tauri/）下的 resources，
    //    某些 dev 配置下 resource_dir 不指向源码目录时仍可定位内置 node。
    let dev_base = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
    lookup(dev_base)
}

/// 内置 node-runtime 二进制路径
fn bundled_node(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let rel: &[&str] = &["node-runtime", "node.exe"];
    #[cfg(not(target_os = "windows"))]
    let rel: &[&str] = &["node-runtime", "bin", "node"];
    resource_path(app, rel)
}

/// 内置 npm 的 JS 入口（npm-cli.js）
/// 用 `node npm-cli.js` 执行 = npm，绕开 bin/npm 的 shebang（GUI 进程 PATH 里无 node）
fn bundled_npm_cli(app: &AppHandle) -> Option<PathBuf> {
    resource_path(
        app,
        &[
            "node-runtime",
            "lib",
            "node_modules",
            "npm",
            "bin",
            "npm-cli.js",
        ],
    )
}

/// gitnexus 全局安装 prefix（应用私有，用户可写）
/// 与 lib.rs 的 NPM_CONFIG_PREFIX 同址（app_data_dir/npm-global），dev/prod 一致。
fn gitnexus_prefix(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("npm-global")
}

/// 已安装的 gitnexus CLI 入口 JS（`node index.js` = gitnexus）
/// npm 全局布局平台差异：Unix 是 <prefix>/lib/node_modules/...，
/// Windows 是 <prefix>/node_modules/...（无 lib 一级）。
fn gitnexus_cli_js(app: &AppHandle) -> Option<PathBuf> {
    let prefix = gitnexus_prefix(app);
    #[cfg(not(target_os = "windows"))]
    let p = prefix
        .join("lib")
        .join("node_modules")
        .join("gitnexus")
        .join("dist")
        .join("cli")
        .join("index.js");
    #[cfg(target_os = "windows")]
    let p = prefix
        .join("node_modules")
        .join("gitnexus")
        .join("dist")
        .join("cli")
        .join("index.js");
    if p.exists() {
        Some(p)
    } else {
        None
    }
}

/// 返回 (node, cli_js) 用于跑 gitnexus 子命令
/// 不 fallback 系统 —— 私有目录没有就 None，由前端引导安装
fn get_gitnexus_cmd(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    Some((bundled_node(app)?, gitnexus_cli_js(app)?))
}

/// 构建运行内置 npm 的 Command（node + npm-cli.js）
fn npm_command(app: &AppHandle) -> Result<Command, String> {
    let node = bundled_node(app)
        .ok_or_else(|| "Bundled Node.js runtime missing (resources/node-runtime)".to_string())?;
    let npm_cli = bundled_npm_cli(app)
        .ok_or_else(|| "Bundled npm-cli.js missing".to_string())?;
    let mut cmd = Command::new(node);
    cmd.arg(npm_cli);
    cmd.no_window();
    Ok(cmd)
}

/// 同步跑一个 gitnexus 子命令，返回 stdout
fn run_gitnexus(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    let (node, cli) = get_gitnexus_cmd(app).ok_or_else(|| {
        "GitNexus CLI not installed. Click 安装 in settings.".to_string()
    })?;
    let mut cmd = Command::new(node);
    cmd.arg(&cli);
    for a in args {
        cmd.arg(a);
    }
    cmd.no_window();

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute gitnexus: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("gitnexus exited with code {:?}", output.status.code())
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

// ============================================================
// Tauri Commands
// ============================================================

/// 0. 一键安装 gitnexus CLI 到应用私有 prefix
/// 用内置 node + npm-cli.js（不依赖系统 npm/PATH），dev/prod 一致
#[command]
pub async fn gitnexus_install(app: AppHandle) -> Result<bool, String> {
    let prefix = gitnexus_prefix(&app);
    let _ = std::fs::create_dir_all(&prefix);

    tokio::task::spawn_blocking(move || {
        let mut cmd = npm_command(&app)?;
        // node npm-cli.js install -g --prefix=<prefix> gitnexus
        cmd.args(["install", "-g", "--prefix"]);
        cmd.arg(&prefix);
        cmd.arg("gitnexus");
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        // 跳过 4 个 optional tree-sitter grammar（dart/proto/swift/kotlin）的源码编译：
        // 它们 vendor 进 gitnexus 时无 prebuild，本地编译需 C 工具链且耗时；
        // 其余 12 个（c + 11 主流语言）靠现成 prebuild 开箱即用。
        // 详见 gitnexus/scripts/build-tree-sitter-grammars.cjs
        cmd.env("GITNEXUS_SKIP_OPTIONAL_GRAMMARS", "1");

        // 收集 stderr 用于失败诊断（累积全部非空行）
        let last_err: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn npm: {}", e))?;
        let stdout = child.stdout.take().expect("stdout");
        let stderr = child.stderr.take().expect("stderr");

        // stdout 进度线程
        let app_out = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        let _ = app_out.emit(
                            "gitnexus-install-progress",
                            GitnexusProgress {
                                item_key: "install".into(),
                                workspace_id: String::new(),
                                item_type: "install".into(),
                                status: "running".into(),
                                message: trimmed.into(),
                                timestamp: now_ms(),
                            },
                        );
                    }
                }
            }
        });

        // stderr 进度线程（同时累积非空行用于错误诊断；npm 致命错误走 stderr）
        let app_err = app.clone();
        let last_err_thread = Arc::clone(&last_err);
        let stderr_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
                        if let Ok(mut g) = last_err_thread.lock() {
                            if !g.is_empty() {
                                g.push('\n');
                            }
                            g.push_str(trimmed);
                        }
                        let _ = app_err.emit(
                            "gitnexus-install-progress",
                            GitnexusProgress {
                                item_key: "install".into(),
                                workspace_id: String::new(),
                                item_type: "install".into(),
                                status: "running".into(),
                                message: trimmed.into(),
                                timestamp: now_ms(),
                            },
                        );
                    }
                }
            }
        });

        let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;

        // 等待 stderr 线程排空管道并完成写入，避免读取 last_err 时竞态（读到空串）
        let _ = stderr_handle.join();

        if status.success() {
            let _ = app.emit(
                "gitnexus-install-progress",
                GitnexusProgress {
                    item_key: "install".into(),
                    workspace_id: String::new(),
                    item_type: "install".into(),
                    status: "done".into(),
                    message: "Installation completed".into(),
                    timestamp: now_ms(),
                },
            );
            Ok(true)
        } else {
            // 用累积的 stderr 作为真实原因（npm 的 code/errno/path 关键行在开头），
            // 截断到可读长度避免消息过长
            let mut detail = last_err.lock().map(|g| g.clone()).unwrap_or_default();
            const MAX_DETAIL: usize = 800;
            if detail.len() > MAX_DETAIL {
                detail.truncate(MAX_DETAIL);
                detail.push_str("...");
            }
            let msg = if detail.is_empty() {
                format!("npm install failed (exit {:?})", status.code())
            } else {
                format!("npm install failed (exit {:?}): {}", status.code(), detail)
            };
            let _ = app.emit(
                "gitnexus-install-progress",
                GitnexusProgress {
                    item_key: "install".into(),
                    workspace_id: String::new(),
                    item_type: "install".into(),
                    status: "error".into(),
                    message: msg.clone(),
                    timestamp: now_ms(),
                },
            );
            Err(msg)
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 卸载 gitnexus CLI（从应用私有 prefix）
#[command]
pub async fn gitnexus_uninstall(app: AppHandle) -> Result<bool, String> {
    // 未安装直接返回
    if gitnexus_cli_js(&app).is_none() {
        return Ok(false);
    }
    let prefix = gitnexus_prefix(&app);

    tokio::task::spawn_blocking(move || {
        let mut cmd = npm_command(&app)?;
        cmd.args(["uninstall", "-g", "--prefix"]);
        cmd.arg(&prefix);
        cmd.arg("gitnexus");

        let output = cmd
            .output()
            .map_err(|e| format!("Failed to run npm: {}", e))?;

        if output.status.success() {
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Err(if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                "npm uninstall failed".to_string()
            })
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 1. 检测 gitnexus 是否安装（只看应用私有 prefix，不查系统）
#[command]
pub async fn gitnexus_check(app: AppHandle) -> Result<GitnexusCheckResult, String> {
    match (gitnexus_cli_js(&app), bundled_node(&app)) {
        (Some(cli_path), Some(node_path)) => {
            // 用内置 node 跑 cli.js --version 取版本
            let version = match Command::new(&node_path)
                .arg(&cli_path)
                .arg("--version")
                .no_window()
                .output()
            {
                Ok(o) if o.status.success() => {
                    Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
                }
                _ => None,
            };
            Ok(GitnexusCheckResult {
                installed: true,
                version,
                // path 是应用私有内部路径（app_data/npm-global/...），对用户无意义，不暴露给 UI
                path: None,
            })
        }
        _ => Ok(GitnexusCheckResult {
            installed: false,
            version: None,
            path: None,
        }),
    }
}

/// 2. 索引一个路径（docs 或 repo）
/// 在后台线程执行 gitnexus analyze，实时 emit 进度事件
#[command]
pub async fn gitnexus_analyze(
    app: AppHandle,
    workspace_id: String,
    item_type: String,
    item_key: String,
    path: String,
    force: bool,
) -> Result<GitnexusItem, String> {
    let (node, cli) = get_gitnexus_cmd(&app).ok_or_else(|| {
        "GitNexus CLI not installed. Click 安装 in settings.".to_string()
    })?;

    // 验证路径存在
    let dir = std::path::Path::new(&path);
    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Path does not exist or is not a directory: {}", path));
    }

    // 提取目录名作为 registryName
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // 目标自身是否为 git 仓库（含 .git 目录或 worktree/submodule 的 .git 文件指针）。
    // gitnexus analyze 默认会从目标向上查找 git 根作为索引范围。
    // docs 是 workspace 下的普通子目录（无 .git），若不加 --skip-git，
    // 会向上定位到 workspace 根的 .git，导致索引范围错乱并报错
    // "pass --skip-git to index any folder without a .git directory"。
    // 按文件系统实际状态判断，而非依赖 item_type 语义——对 docs / repo 都健壮。
    let is_git_repo = dir.join(".git").exists();

    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&node);
        cmd.no_window();
        cmd.arg(&cli);
        cmd.arg("analyze");
        if force {
            cmd.arg("--force");
        }
        // 非 git 目录：以当前路径为索引根，跳过向上查找 git 根
        if !is_git_repo {
            cmd.arg("--skip-git");
        }
        cmd.arg(&path);

        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

        let stdout = child.stdout.take().expect("stdout should be available");
        let stderr = child.stderr.take().expect("stderr should be available");

        // 共享：记录最后的输出行（用于错误诊断）
        let last_output: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));

        // stdout 读取线程：逐行 emit 进度
        let app_stdout = app.clone();
        let ws_id = workspace_id.clone();
        let i_key = item_key.clone();
        let i_type = item_type.clone();
        let last_stdout = Arc::clone(&last_output);
        let stdout_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(mut guard) = last_stdout.lock() {
                        *guard = trimmed.to_string();
                    }
                    let _ = app_stdout.emit(
                        "gitnexus-progress",
                        GitnexusProgress {
                            item_key: i_key.clone(),
                            workspace_id: ws_id.clone(),
                            item_type: i_type.clone(),
                            status: "running".into(),
                            message: trimmed.into(),
                            timestamp: now_ms(),
                        },
                    );
                }
            }
        });

        // stderr 读取线程：同样 emit
        let app_stderr = app.clone();
        let ws_id2 = workspace_id.clone();
        let i_key2 = item_key.clone();
        let i_type2 = item_type.clone();
        let last_stderr = Arc::clone(&last_output);
        let stderr_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(mut guard) = last_stderr.lock() {
                        *guard = trimmed.to_string();
                    }
                    let _ = app_stderr.emit(
                        "gitnexus-progress",
                        GitnexusProgress {
                            item_key: i_key2.clone(),
                            workspace_id: ws_id2.clone(),
                            item_type: i_type2.clone(),
                            status: "running".into(),
                            message: trimmed.into(),
                            timestamp: now_ms(),
                        },
                    );
                }
            }
        });

        // 等待子进程结束
        let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;

        // 等待 stdout/stderr 线程排空管道并完成写入，避免读取 last_output 时竞态（读到空串）
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        // 获取最后的输出行
        let last_msg = last_output
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();

        if status.success() {
            // emit done
            let _ = app.emit(
                "gitnexus-progress",
                GitnexusProgress {
                    item_key: item_key.clone(),
                    workspace_id: workspace_id.clone(),
                    item_type: item_type.clone(),
                    status: "done".into(),
                    message: "Index completed".into(),
                    timestamp: now_ms(),
                },
            );
            Ok(GitnexusItem {
                name,
                path,
                indexed: true,
            })
        } else {
            let err_detail = if !last_msg.is_empty() {
                last_msg
            } else {
                format!("Exit code: {:?}", status.code())
            };
            // emit error
            let _ = app.emit(
                "gitnexus-progress",
                GitnexusProgress {
                    item_key: item_key.clone(),
                    workspace_id: workspace_id.clone(),
                    item_type: item_type.clone(),
                    status: "error".into(),
                    message: err_detail.clone(),
                    timestamp: now_ms(),
                },
            );
            Err(format!(
                "gitnexus analyze failed: {} (exit code: {:?})",
                err_detail,
                status.code()
            ))
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 3. 列出所有已索引仓库
#[command]
pub async fn gitnexus_list(app: AppHandle) -> Result<Vec<GitnexusItem>, String> {
    let output = run_gitnexus(&app, &["list"])?;

    // 尝试解析 JSON 格式输出
    // gitnexus list 可能输出 JSON 数组或文本表格
    let items: Vec<GitnexusItem> = if output.trim_start().starts_with('[') {
        // JSON 格式
        #[derive(Deserialize)]
        struct RawItem {
            name: Option<String>,
            path: Option<String>,
        }
        let raw_items: Vec<RawItem> =
            serde_json::from_str(&output).map_err(|e| format!("Parse list JSON failed: {}", e))?;
        raw_items
            .into_iter()
            .map(|r| GitnexusItem {
                name: r.name.unwrap_or_default(),
                path: r.path.unwrap_or_default(),
                indexed: true,
            })
            .collect()
    } else {
        // 文本格式：每行一个仓库名
        output
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|name| GitnexusItem {
                name: name.trim().to_string(),
                path: String::new(),
                indexed: true,
            })
            .collect()
    };

    Ok(items)
}

/// 4. 创建仓库组
#[command]
pub async fn gitnexus_group_create(app: AppHandle, name: String) -> Result<bool, String> {
    // group create 如果组已存在会报错，我们忽略该错误
    match run_gitnexus(&app, &["group", "create", &name]) {
        Ok(_) => Ok(true),
        Err(e) => {
            // 如果是组已存在的错误，忽略
            if e.contains("already exists") || e.contains("exists") {
                Ok(true)
            } else {
                Err(e)
            }
        }
    }
}

/// 5. 添加仓库到组
#[command]
pub async fn gitnexus_group_add(
    app: AppHandle,
    group: String,
    group_path: String,
    registry_name: String,
) -> Result<bool, String> {
    // 如果已添加会报错，忽略
    match run_gitnexus(&app, &["group", "add", &group, &group_path, &registry_name]) {
        Ok(_) => Ok(true),
        Err(e) => {
            if e.contains("already") || e.contains("exists") {
                Ok(true)
            } else {
                Err(e)
            }
        }
    }
}

/// 6. 同步组（跨仓库提取契约）
/// 后台执行，emit 进度
#[command]
pub async fn gitnexus_group_sync(
    app: AppHandle,
    workspace_id: String,
    name: String,
) -> Result<bool, String> {
    let (node, cli) = get_gitnexus_cmd(&app).ok_or_else(|| {
        "GitNexus CLI not installed. Click 安装 in settings.".to_string()
    })?;

    let item_key = format!("ws_{}_group_sync", workspace_id);

    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&node);
        cmd.no_window();
        cmd.arg(&cli);
        cmd.args(&["group", "sync", &name]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

        let stdout = child.stdout.take().expect("stdout");
        let stderr = child.stderr.take().expect("stderr");

        let app_s = app.clone();
        let ik = item_key.clone();
        let ws = workspace_id.clone();
        let stdout_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let _ = app_s.emit(
                        "gitnexus-progress",
                        GitnexusProgress {
                            item_key: ik.clone(),
                            workspace_id: ws.clone(),
                            item_type: "group_sync".into(),
                            status: "running".into(),
                            message: trimmed.into(),
                            timestamp: now_ms(),
                        },
                    );
                }
            }
        });

        let app_e = app.clone();
        let ik2 = item_key.clone();
        let ws2 = workspace_id.clone();
        let stderr_handle = std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let _ = app_e.emit(
                        "gitnexus-progress",
                        GitnexusProgress {
                            item_key: ik2.clone(),
                            workspace_id: ws2.clone(),
                            item_type: "group_sync".into(),
                            status: "running".into(),
                            message: trimmed.into(),
                            timestamp: now_ms(),
                        },
                    );
                }
            }
        });

        let status = child.wait().map_err(|e| format!("Wait failed: {}", e))?;

        // 等待 stdout/stderr 线程排空管道，避免尾部进度事件丢失
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        if status.success() {
            let _ = app.emit(
                "gitnexus-progress",
                GitnexusProgress {
                    item_key,
                    workspace_id,
                    item_type: "group_sync".into(),
                    status: "done".into(),
                    message: "Group sync completed".into(),
                    timestamp: now_ms(),
                },
            );
            Ok(true)
        } else {
            let _ = app.emit(
                "gitnexus-progress",
                GitnexusProgress {
                    item_key,
                    workspace_id,
                    item_type: "group_sync".into(),
                    status: "error".into(),
                    message: format!("Exit code: {:?}", status.code()),
                    timestamp: now_ms(),
                },
            );
            Err(format!("gitnexus group sync failed: {:?}", status.code()))
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 7. 查询组状态
#[command]
pub async fn gitnexus_group_status(app: AppHandle, name: String) -> Result<String, String> {
    run_gitnexus(&app, &["group", "status", &name])
}
