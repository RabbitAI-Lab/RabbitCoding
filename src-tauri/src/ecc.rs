use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter};

// ============================================================
// 数据结构
// ============================================================

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EccCheckResult {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EccProgress {
    pub status: String,
    pub message: String,
    pub timestamp: u64,
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

/// 获取 Claude 配置目录 (通常 ~/.claude 或 %USERPROFILE%\.claude)
fn get_claude_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").ok()?;
        Some(std::path::PathBuf::from(home).join(".claude"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").ok()?;
        Some(std::path::PathBuf::from(home).join(".claude"))
    }
}

/// 查找 npx（跨平台）
fn find_npx() -> Option<(String, Vec<String>)> {
    // 跨平台 npx 命令名
    #[cfg(target_os = "windows")]
    let npx_cmd = "npx.cmd";
    #[cfg(not(target_os = "windows"))]
    let npx_cmd = "npx";

    // 直接尝试 npx
    let direct = Command::new(npx_cmd).arg("--version").output();
    if let Ok(out) = &direct {
        if out.status.success() {
            return Some((npx_cmd.into(), vec![]));
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 尝试通过 cmd 找 npx
        let shell_check = Command::new("cmd")
            .arg("/C")
            .arg("where npx 2>nul")
            .output();
        if let Ok(o) = &shell_check {
            if o.status.success() {
                let path = String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() && std::path::Path::new(&path).exists() {
                    return Some((path, vec![]));
                }
            }
        }

        // 尝试常见路径
        let mut candidates: Vec<String> = Vec::new();
        if let Ok(appdata) = std::env::var("APPDATA") {
            candidates.push(format!("{}\\npm\\npx.cmd", appdata));
        }
        if let Ok(programfiles) = std::env::var("PROGRAMFILES") {
            candidates.push(format!("{}\\nodejs\\npx.cmd", programfiles));
        }
        for candidate in &candidates {
            if std::path::Path::new(candidate).exists() {
                return Some((candidate.clone(), vec![]));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS / Linux: 尝试通过 shell 找 npx
        let shell_check = Command::new("sh")
            .arg("-c")
            .arg("which npx 2>/dev/null")
            .output();
        if let Ok(o) = &shell_check {
            if o.status.success() {
                let path = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if !path.is_empty() && std::path::Path::new(&path).exists() {
                    return Some((path, vec![]));
                }
            }
        }

        // 尝试常见路径
        let mut candidates: Vec<String> = vec![
            "/usr/local/bin/npx".into(),
            "/opt/homebrew/bin/npx".into(),
        ];
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(format!("{}/.npm-global/bin/npx", home));
            candidates.push(format!("{}/.local/bin/npx", home));
            candidates.push(format!("{}/.volta/bin/npx", home));
            candidates.push(format!("{}/.bun/bin/npx", home));
        }
        for candidate in &candidates {
            if std::path::Path::new(candidate).exists() {
                return Some((candidate.clone(), vec![]));
            }
        }
    }

    None
}

// ============================================================
// Tauri Commands
// ============================================================

/// 检测 ECC 是否已安装
#[command]
pub async fn ecc_check() -> Result<EccCheckResult, String> {
    let claude_dir = get_claude_dir().ok_or_else(|| "Cannot determine HOME directory".to_string())?;

    // 检测 agents 目录下是否有 ECC 相关文件
    let agents_dir = claude_dir.join("agents");
    let mut found_ecc_agent = false;

    if let Ok(entries) = std::fs::read_dir(&agents_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            // ECC 安装的 agent 文件通常包含 "ecc-" 前缀或已知角色名
            if name_str.contains("ecc") || name_str.contains("typescript-reviewer")
                || name_str.contains("build-resolver") || name_str.contains("kotlin-reviewer")
            {
                found_ecc_agent = true;
                break;
            }
        }
    }

    // 检测 skills 目录
    let skills_dir = claude_dir.join("skills");
    let mut found_ecc_skill = false;

    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.contains("ecc") || name_str.contains("configure-ecc")
                || name_str.contains("market-research") || name_str.contains("article-writing")
            {
                found_ecc_skill = true;
                break;
            }
        }
    }

    // 检测 ECC 状态存储 (ecc2 目录 或 state store)
    let ecc2_dir = claude_dir.join("ecc2");
    let state_store = claude_dir.join("state-store");

    let installed = found_ecc_agent || found_ecc_skill || ecc2_dir.exists() || state_store.exists();

    // 尝试读取版本（如果 ecc2 存在）
    let version = if ecc2_dir.exists() {
        Some("2.0.0".to_string())
    } else if installed {
        Some("1.x".to_string())
    } else {
        None
    };

    Ok(EccCheckResult { installed, version })
}

/// 一键安装 ECC（npx ecc-install --profile minimal）
/// 后台执行，实时 emit 安装进度
#[command]
pub async fn ecc_install(app: AppHandle) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let (program, prefix) = find_npx().ok_or_else(|| {
            "npx not found. Please install Node.js first from https://nodejs.org".to_string()
        })?;

        let mut cmd = Command::new(&program);
        for a in &prefix {
            cmd.arg(a);
        }
        cmd.args(&["-y", "ecc-install", "--profile", "minimal", "--target", "claude"]);
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
                            "ecc-install-progress",
                            EccProgress {
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
                            "ecc-install-progress",
                            EccProgress {
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
                "ecc-install-progress",
                EccProgress {
                    status: "done".into(),
                    message: "ECC installation completed".into(),
                    timestamp: now_ms(),
                },
            );
            Ok(true)
        } else {
            let _ = app.emit(
                "ecc-install-progress",
                EccProgress {
                    status: "error".into(),
                    message: format!("Exit code: {:?}", status.code()),
                    timestamp: now_ms(),
                },
            );
            Err(format!("ecc-install failed: {:?}", status.code()))
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 卸载 ECC：删除 ~/.claude/ 下 ECC 相关文件
#[command]
pub async fn ecc_uninstall() -> Result<bool, String> {
    let claude_dir = get_claude_dir().ok_or_else(|| "Cannot determine HOME directory".to_string())?;

    let mut removed_any = false;

    // 删除 ecc2 目录
    let ecc2_dir = claude_dir.join("ecc2");
    if ecc2_dir.exists() {
        std::fs::remove_dir_all(&ecc2_dir).map_err(|e| format!("Failed to remove ecc2: {}", e))?;
        removed_any = true;
    }

    // 删除 state-store 目录
    let state_store = claude_dir.join("state-store");
    if state_store.exists() {
        std::fs::remove_dir_all(&state_store).map_err(|e| format!("Failed to remove state-store: {}", e))?;
        removed_any = true;
    }

    // 删除 agents 目录下 ECC 相关文件
    let agents_dir = claude_dir.join("agents");
    if let Ok(entries) = std::fs::read_dir(&agents_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.contains("ecc") || name_str.contains("typescript-reviewer")
                || name_str.contains("build-resolver") || name_str.contains("kotlin-reviewer")
            {
                let path = entry.path();
                if path.is_dir() {
                    std::fs::remove_dir_all(&path).ok();
                } else {
                    std::fs::remove_file(&path).ok();
                }
                removed_any = true;
            }
        }
    }

    // 删除 skills 目录下 ECC 相关文件
    let skills_dir = claude_dir.join("skills");
    if let Ok(entries) = std::fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.contains("ecc") || name_str.contains("configure-ecc")
                || name_str.contains("market-research") || name_str.contains("article-writing")
            {
                let path = entry.path();
                if path.is_dir() {
                    std::fs::remove_dir_all(&path).ok();
                } else {
                    std::fs::remove_file(&path).ok();
                }
                removed_any = true;
            }
        }
    }

    Ok(removed_any)
}
