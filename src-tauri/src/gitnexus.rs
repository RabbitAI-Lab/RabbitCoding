use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter};

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
// ============================================================

/// 当前 unix 时间戳（毫秒）
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// 查找 gitnexus 可执行文件路径
/// GUI 应用不继承 shell PATH，需要多路尝试
fn find_gitnexus() -> Option<String> {
    // 1. 直接尝试 `gitnexus`（如果 Tauri 有完整 PATH）
    #[cfg(target_os = "windows")]
    let direct_cmd = "gitnexus.cmd";
    #[cfg(not(target_os = "windows"))]
    let direct_cmd = "gitnexus";

    let direct = Command::new(direct_cmd).arg("--version").output();
    if let Ok(out) = &direct {
        if out.status.success() {
            let ver = String::from_utf8_lossy(&out.stdout).trim().to_string();
            return Some(format!("{} ({})", direct_cmd, ver));
        }
    }

    // 2. 尝试常见 npm 全局安装路径
    let all_candidates = candidates_from_home();

    for candidate in &all_candidates {
        if std::path::Path::new(candidate).exists() {
            let result = Command::new(candidate).arg("--version").output();
            if let Ok(out) = result {
                if out.status.success() {
                    return Some(candidate.clone());
                }
            }
        }
    }

    // 3. 尝试通过 shell 执行
    #[cfg(target_os = "windows")]
    {
        let shell_result = Command::new("cmd")
            .arg("/C")
            .arg("where gitnexus 2>nul")
            .output();
        if let Ok(out) = shell_result {
            let path = String::from_utf8_lossy(&out.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let shell_result = Command::new("sh")
            .arg("-c")
            .arg("which gitnexus 2>/dev/null")
            .output();
        if let Ok(out) = shell_result {
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !path.is_empty() && std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }
    }

    None
}

/// 从 HOME / USERPROFILE 目录推导可能的 gitnexus 路径（跨平台）
fn candidates_from_home() -> Vec<String> {
    let mut all_candidates: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Windows: npm global bin 通常在 %APPDATA%\npm
        if let Ok(appdata) = std::env::var("APPDATA") {
            all_candidates.push(format!("{}\\npm\\gitnexus.cmd", appdata));
        }
        if let Ok(programfiles) = std::env::var("PROGRAMFILES") {
            all_candidates.push(format!("{}\\nodejs\\gitnexus.cmd", programfiles));
        }
        // USERPROFILE 作为后备
        if let Ok(home) = std::env::var("USERPROFILE") {
            all_candidates.push(format!("{}\\AppData\\Roaming\\npm\\gitnexus.cmd", home));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS / Linux 常见路径
        all_candidates.push("/usr/local/bin/gitnexus".into());
        all_candidates.push("/opt/homebrew/bin/gitnexus".into());

        // 补充从 HOME 推导的路径
        if let Ok(home) = std::env::var("HOME") {
            all_candidates.push(format!("{}/.npm-global/bin/gitnexus", home));
            all_candidates.push(format!("{}/.local/bin/gitnexus", home));
            all_candidates.push(format!("{}/.nvm/versions/node/current/bin/gitnexus", home));
            all_candidates.push(format!("{}/.volta/bin/gitnexus", home));
            all_candidates.push(format!("{}/.bun/bin/gitnexus", home));
        }
    }

    all_candidates
}

/// 获取 gitnexus 命令（返回程序名 + 参数前缀）
/// 返回 (program, prefix_args) 元组
fn get_gitnexus_cmd() -> Option<(String, Vec<String>)> {
    let found = find_gitnexus()?;

    // 如果返回值包含 "gitnexus" 说明是直接可用的
    // (windows 返回 "gitnexus.cmd (version)", mac/linux 返回 "gitnexus (version)")
    if found.starts_with("gitnexus") && found.contains('(') {
        #[cfg(target_os = "windows")]
        return Some(("gitnexus.cmd".into(), vec![]));
        #[cfg(not(target_os = "windows"))]
        return Some(("gitnexus".into(), vec![]));
    }

    // 否则它是一个完整路径
    Some((found, vec![]))
}

/// 构建并执行一个 gitnexus 子命令（快速返回型）
fn run_gitnexus(args: &[&str]) -> Result<String, String> {
    let (program, prefix) = get_gitnexus_cmd().ok_or_else(|| {
        "GitNexus CLI not found. Install with: npm install -g gitnexus".to_string()
    })?;

    let mut cmd = Command::new(&program);
    for a in &prefix {
        cmd.arg(a);
    }
    for a in args {
        cmd.arg(a);
    }

    let output = cmd.output().map_err(|e| format!("Failed to execute: {}", e))?;

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

/// 0. 一键安装 gitnexus CLI（npm install -g gitnexus）
/// 后台执行，实时 emit 安装进度
#[command]
pub async fn gitnexus_install(app: AppHandle) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        // 优先尝试 npm
        #[cfg(target_os = "windows")]
        let npm_cmd = "npm.cmd";
        #[cfg(not(target_os = "windows"))]
        let npm_cmd = "npm";

        let (program, args): (String, Vec<String>) = match Command::new(npm_cmd).arg("--version").output() {
            Ok(out) if out.status.success() => (npm_cmd.to_string(), vec!["install".into(), "-g".into(), "gitnexus".into()]),
            _ => {
                // 尝试通过 shell 找 npm
                #[cfg(target_os = "windows")]
                {
                    let shell_check = Command::new("cmd")
                        .arg("/C")
                        .arg("where npm 2>nul")
                        .output();
                    if let Ok(o) = &shell_check {
                        if o.status.success() {
                            ("cmd".into(), vec!["/C".into(), "npm install -g gitnexus".into()])
                        } else {
                            return Err(
                                "npm not found. Please install Node.js first from https://nodejs.org".into(),
                            );
                        }
                    } else {
                        return Err(
                            "npm not found. Please install Node.js first from https://nodejs.org".into(),
                        );
                    }
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let shell_check = Command::new("sh")
                        .arg("-c")
                        .arg("which npm 2>/dev/null")
                        .output();
                    if let Ok(o) = &shell_check {
                        if o.status.success() {
                            ("sh".into(), vec!["-c".into(), "npm install -g gitnexus".into()])
                        } else {
                            return Err(
                                "npm not found. Please install Node.js first from https://nodejs.org".into(),
                            );
                        }
                    } else {
                        return Err(
                            "npm not found. Please install Node.js first from https://nodejs.org".into(),
                        );
                    }
                }
            }
        };

        let mut cmd = Command::new(&program);
        for a in &args {
            cmd.arg(a);
        }
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
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

        // stderr 进度线程
        let app_err = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() {
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
            let _ = app.emit(
                "gitnexus-install-progress",
                GitnexusProgress {
                    item_key: "install".into(),
                    workspace_id: String::new(),
                    item_type: "install".into(),
                    status: "error".into(),
                    message: format!("Exit code: {:?}", status.code()),
                    timestamp: now_ms(),
                },
            );
            Err(format!("npm install failed: {:?}", status.code()))
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 卸载 gitnexus CLI（npm uninstall -g gitnexus）
#[command]
pub async fn gitnexus_uninstall() -> Result<bool, String> {
    // 先确认已安装
    if find_gitnexus().is_none() {
        return Ok(false);
    }

    // 尝试 npm uninstall -g gitnexus
    #[cfg(target_os = "windows")]
    let npm_cmd = "npm.cmd";
    #[cfg(not(target_os = "windows"))]
    let npm_cmd = "npm";

    let output = Command::new(npm_cmd)
        .args(["uninstall", "-g", "gitnexus"])
        .output()
        .map_err(|e| format!("Failed to run npm: {}", e))?;

    if output.status.success() {
        Ok(true)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() { stderr } else if !stdout.is_empty() { stdout } else { "npm uninstall failed".to_string() })
    }
}

/// 1. 检测 gitnexus 是否安装
#[command]
pub async fn gitnexus_check() -> Result<GitnexusCheckResult, String> {
    let found = find_gitnexus();

    match found {
        Some(path_info) => {
            // 如果是 "gitnexus (version)" 或 "gitnexus.cmd (version)" 格式
            if path_info.contains('(') {
                // 提取括号内的版本号
                let ver = if let Some(start) = path_info.find('(') {
                    if let Some(end) = path_info.find(')') {
                        path_info[start + 1..end].to_string()
                    } else {
                        String::new()
                    }
                } else {
                    String::new()
                };
                #[cfg(target_os = "windows")]
                let cmd_name = "gitnexus.cmd";
                #[cfg(not(target_os = "windows"))]
                let cmd_name = "gitnexus";
                Ok(GitnexusCheckResult {
                    installed: true,
                    version: Some(ver),
                    path: Some(cmd_name.into()),
                })
            } else {
                // 是一个路径，获取版本
                let ver_output = Command::new(&path_info).arg("--version").output();
                let version = match ver_output {
                    Ok(out) if out.status.success() => {
                        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
                    }
                    _ => None,
                };
                Ok(GitnexusCheckResult {
                    installed: true,
                    version,
                    path: Some(path_info),
                })
            }
        }
        None => Ok(GitnexusCheckResult {
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
    let (program, prefix) = get_gitnexus_cmd().ok_or_else(|| {
        "GitNexus CLI not found. Install with: npm install -g gitnexus".to_string()
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

    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&program);
        for a in &prefix {
            cmd.arg(a);
        }
        cmd.arg("analyze");
        if force {
            cmd.arg("--force");
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
        std::thread::spawn(move || {
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
        std::thread::spawn(move || {
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
pub async fn gitnexus_list() -> Result<Vec<GitnexusItem>, String> {
    let output = run_gitnexus(&["list"])?;

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
pub async fn gitnexus_group_create(name: String) -> Result<bool, String> {
    // group create 如果组已存在会报错，我们忽略该错误
    match run_gitnexus(&["group", "create", &name]) {
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
    group: String,
    group_path: String,
    registry_name: String,
) -> Result<bool, String> {
    // 如果已添加会报错，忽略
    match run_gitnexus(&["group", "add", &group, &group_path, &registry_name]) {
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
    let (program, prefix) = get_gitnexus_cmd().ok_or_else(|| {
        "GitNexus CLI not found. Install with: npm install -g gitnexus".to_string()
    })?;

    let item_key = format!("ws_{}_group_sync", workspace_id);

    tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&program);
        for a in &prefix {
            cmd.arg(a);
        }
        cmd.args(&["group", "sync", &name]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;

        let stdout = child.stdout.take().expect("stdout");
        let stderr = child.stderr.take().expect("stderr");

        let app_s = app.clone();
        let ik = item_key.clone();
        let ws = workspace_id.clone();
        std::thread::spawn(move || {
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
        std::thread::spawn(move || {
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
pub async fn gitnexus_group_status(name: String) -> Result<String, String> {
    run_gitnexus(&["group", "status", &name])
}
