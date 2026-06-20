use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Emitter};

// 复用 claude_mem.rs 的共享辅助函数，保证 CLAUDE_CONFIG_DIR 注入逻辑
// 与 sidecar.rs 完全一致，插件装到应用专用目录而非全局 ~/.claude
use crate::claude_mem::{claude_command, find_claude, get_claude_config_dir};

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

/// 判断插件键名是否属于 ECC（兼容 ecc@ecc、everything-claude-code@* 等历史键名）
fn is_ecc_plugin_key(key: &str) -> bool {
    let plugin_name = key.split('@').next().unwrap_or(key).to_lowercase();
    plugin_name == "ecc" || plugin_name == "everything-claude-code"
}

/// 读取子进程 stdout/stderr 并实时 emit 进度（与 claude_mem.rs 一致的双线程模式）
fn emit_child_output(app: &AppHandle, child: &mut std::process::Child) {
    if let Some(stdout) = child.stdout.take() {
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
    }

    if let Some(stderr) = child.stderr.take() {
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
    }
}

// ============================================================
// Tauri Commands
// ============================================================

/// 检测 ECC 是否已安装
/// 策略：读取 {CLAUDE_CONFIG_DIR}/plugins/installed_plugins.json，
///       匹配键名为 ecc 或 everything-claude-code（兼容历史记录）
#[command]
pub async fn ecc_check(app: AppHandle) -> Result<EccCheckResult, String> {
    let config_dir = get_claude_config_dir(&app);
    let installed_json = config_dir.join("plugins").join("installed_plugins.json");

    if !installed_json.exists() {
        return Ok(EccCheckResult {
            installed: false,
            version: None,
        });
    }

    let content = std::fs::read_to_string(&installed_json)
        .map_err(|e| format!("Failed to read installed_plugins.json: {}", e))?;

    let parsed: InstalledPluginsFile = match serde_json::from_str(&content) {
        Ok(p) => p,
        Err(_) => {
            return Ok(EccCheckResult {
                installed: false,
                version: None,
            });
        }
    };

    let mut found_version: Option<String> = None;
    let installed = parsed.plugins.keys().any(|key| {
        if is_ecc_plugin_key(key) {
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

    Ok(EccCheckResult {
        installed,
        version: found_version,
    })
}

/// 一键安装 ECC（通过 Claude CLI 插件机制）
/// 两步：marketplace add → plugin install（失败则降级重试 plugin@marketplace）
/// 后台执行，实时 emit "ecc-install-progress" 事件
#[command]
pub async fn ecc_install(app: AppHandle) -> Result<bool, String> {
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
            "ecc-install-progress",
            EccProgress {
                status: "running".into(),
                message: "Adding marketplace source (affaan-m/ECC)...".into(),
                timestamp: now_ms(),
            },
        );

        let mut cmd1 = claude_command(&program, &config_dir);
        cmd1.args([
            "plugin",
            "marketplace",
            "add",
            "https://github.com/affaan-m/ECC",
            "--scope",
            "user",
        ]);
        cmd1.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child1 = cmd1
            .spawn()
            .map_err(|e| format!("Failed to spawn marketplace add: {}", e))?;

        emit_child_output(&app, &mut child1);

        let status1 = child1
            .wait()
            .map_err(|e| format!("Wait marketplace add failed: {}", e))?;

        // marketplace add 可能返回非零（市场已存在），不视为致命错误
        if !status1.success() {
            let _ = app.emit(
                "ecc-install-progress",
                EccProgress {
                    status: "running".into(),
                    message: "Marketplace may already exist, continuing to install...".into(),
                    timestamp: now_ms(),
                },
            );
        }

        // ---------- 第二步：安装插件 ----------
        let _ = app.emit(
            "ecc-install-progress",
            EccProgress {
                status: "running".into(),
                message: "Installing ECC plugin...".into(),
                timestamp: now_ms(),
            },
        );

        let mut cmd2 = claude_command(&program, &config_dir);
        cmd2.args(["plugin", "install", "ecc", "-s", "user"]);
        cmd2.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child2 = match cmd2.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(
                    "ecc-install-progress",
                    EccProgress {
                        status: "error".into(),
                        message: format!("Failed to spawn install: {}", e),
                        timestamp: now_ms(),
                    },
                );
                return Err(format!("Failed to spawn install: {}", e));
            }
        };

        emit_child_output(&app, &mut child2);

        let status2 = child2
            .wait()
            .map_err(|e| format!("Wait install failed: {}", e))?;

        if status2.success() {
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
            // 降级重试：尝试 ecc@ecc 精确指定市场
            let _ = app.emit(
                "ecc-install-progress",
                EccProgress {
                    status: "running".into(),
                    message: "Retrying with explicit marketplace name...".into(),
                    timestamp: now_ms(),
                },
            );

            let mut cmd3 = claude_command(&program, &config_dir);
            cmd3.args(["plugin", "install", "ecc@ecc", "-s", "user"]);
            cmd3.stdout(Stdio::piped()).stderr(Stdio::piped());

            let mut child3 = match cmd3.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = app.emit(
                        "ecc-install-progress",
                        EccProgress {
                            status: "error".into(),
                            message: format!("Install failed: {}", e),
                            timestamp: now_ms(),
                        },
                    );
                    return Err(format!("ecc install failed: {}", e));
                }
            };

            emit_child_output(&app, &mut child3);

            let status3 = child3
                .wait()
                .map_err(|e| format!("Wait retry install failed: {}", e))?;

            if status3.success() {
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
                        message: format!("Install failed, exit code: {:?}", status3.code()),
                        timestamp: now_ms(),
                    },
                );
                Err(format!("ecc install failed: {:?}", status3.code()))
            }
        }
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?
}

/// 卸载 ECC（通过 Claude CLI 插件机制）
#[command]
pub async fn ecc_uninstall(app: AppHandle) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let (program, _prefix) =
            find_claude().ok_or_else(|| "claude CLI not found. Cannot uninstall.".to_string())?;

        let config_dir = get_claude_config_dir(&app);

        let mut cmd = claude_command(&program, &config_dir);
        cmd.args(["plugin", "uninstall", "ecc"]);

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
