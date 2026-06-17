mod sidecar;
mod db;
mod network;
mod model_test;
mod gitnexus;
mod integration;
mod feedback;
mod ecc;
mod auth;

use tauri::{Manager, PhysicalSize, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 确保工作区路径下存在 docs 目录（幂等）
#[tauri::command]
fn ensure_workspace_docs_dir(path: String) -> Result<(), String> {
    let docs_dir = std::path::Path::new(&path).join("docs");
    std::fs::create_dir_all(&docs_dir)
        .map_err(|e| format!("Failed to create docs directory: {e}"))
}

/// 确保工作区路径下存在 .rabbit/specs 目录（幂等）
#[tauri::command]
fn ensure_rabbit_specs_dir(path: String) -> Result<(), String> {
    let specs_dir = std::path::Path::new(&path).join(".rabbit").join("specs");
    std::fs::create_dir_all(&specs_dir)
        .map_err(|e| format!("Failed to create .rabbit/specs directory: {e}"))
}

/// 读取文本文件内容（绕过 Tauri fs:scope 对隐藏目录的限制，用于读取 .rabbit 等目录中的文件）
#[tauri::command]
fn read_text_file_unrestricted(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file '{path}': {e}"))
}

/// 打开系统通知设置页面（macOS / Windows），绕过 Tauri ACL 限制
#[tauri::command]
fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
            .spawn()
            .map_err(|e| format!("Failed to open notification settings: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:notifications"])
            .spawn()
            .map_err(|e| format!("Failed to open notification settings: {e}"))?;
    }
    Ok(())
}

/// 通过 Rust 后端发送桌面通知（绕过 Tauri 插件的签名限制）
/// macOS: 使用 osascript display notification
/// Windows: 使用 PowerShell toast notification
#[tauri::command]
fn send_desktop_notification(title: String, body: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        // 使用 osascript 发送通知（不需要应用签名）
        let script = format!(
            "display notification {body_quoted} with title {title_quoted} sound name \"default\"",
            body_quoted = escape_applescript_string(&body),
            title_quoted = escape_applescript_string(&title),
        );
        let output = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("Failed to run osascript: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[notify] osascript failed: {stderr}");
            return Ok(false);
        }
        return Ok(true);
    }
    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 PowerShell New-BurntToastNotification（如果已安装）
        // 或简单的 msg 命令
        let script = format!(
            "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; \
             $balloon = New-Object System.Windows.Forms.NotifyIcon; \
             $balloon.Icon = [System.Drawing.SystemIcons]::Information; \
             $balloon.BalloonTipTitle = '{}'; \
             $balloon.BalloonTipText = '{}'; \
             $balloon.Visible = $true; \
             $balloon.ShowBalloonTip(5000);",
             title.replace("'", "''"),
             body.replace("'", "''"),
        );
        let output = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| format!("Failed to run powershell: {e}"))?;
        if !output.status.success() {
            return Ok(false);
        }
        return Ok(true);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(false)
    }
}

/// 转义 AppleScript 字符串（用双引号包裹）
#[cfg(target_os = "macos")]
fn escape_applescript_string(s: &str) -> String {
    // 用双引号包裹，转义内部双引号和反斜杠
    let escaped = s.replace('\\', "\\\\").replace('"', "\\\"" );
    format!("\"{}\"", escaped)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            if let Err(e) = std::fs::create_dir_all(&app_data_dir) {
                eprintln!("[db] Failed to create app_data_dir: {e}");
                return Ok(());
            }
            let db_path = app_data_dir.join("rabbit.db");
            match db::Database::open(&db_path) {
                Ok(database) => {
                    app.manage(database);
                }
                Err(e) => {
                    eprintln!("[db] Failed to initialize database: {e}");
                    // 不 panic —— 前端会检测到 db_* 命令失败，降级到 localStorage
                }
            }

            // 生产模式：注入内置 Node.js 运行时到进程 PATH
            // 并设置 NPM_CONFIG_PREFIX 到用户可写目录，解决 npm install -g 权限问题
            // 所有子进程（sidecar、MCP、ecc.rs、gitnexus.rs）均继承此环境
            #[cfg(not(debug_assertions))]
            {
                if let Ok(resource_dir) = app.path().resource_dir() {
                    let node_bin_sub = if cfg!(target_os = "windows") {
                        ""
                    } else {
                        "bin"
                    };
                    // Tauri 打包保留路径结构：resources/node-runtime → Contents/Resources/resources/node-runtime
                    let node_bin_dir = resource_dir.join("resources").join("node-runtime").join(node_bin_sub);

                    // npm 全局安装目录——指向 app_data_dir 下的可写路径
                    // macOS 应用包签名后只读，Windows Program Files 需管理员权限
                    // 所以必须用 app_data_dir 而非 node-runtime 自带目录
                    let npm_global_dir = app_data_dir.join("npm-global");
                    let _ = std::fs::create_dir_all(&npm_global_dir);

                    // Unix: npm 全局 bin 在 prefix/bin；Windows: 直接在 prefix 根
                    #[cfg(target_os = "windows")]
                    let npm_bin_dir = npm_global_dir.clone();
                    #[cfg(not(target_os = "windows"))]
                    let npm_bin_dir = npm_global_dir.join("bin");
                    let _ = std::fs::create_dir_all(&npm_bin_dir);

                    if node_bin_dir.exists() {
                        let sep = if cfg!(windows) { ";" } else { ":" };
                        let current_path = std::env::var("PATH").unwrap_or_default();
                        // npm-global/bin 放最前面，内置 node-runtime/bin 紧随具后
                        // 这样 npx -y xxx 下载的 CLI 也能被直接调用
                        let new_path = format!(
                            "{}{}{}{}{}",
                            npm_bin_dir.display(),
                            sep,
                            node_bin_dir.display(),
                            sep,
                            current_path
                        );
                        std::env::set_var("PATH", &new_path);

                        // 让 npm install -g 写入用户可写目录而非只读的 node-runtime
                        std::env::set_var("NPM_CONFIG_PREFIX", &npm_global_dir);

                        println!(
                            "[node-runtime] PATH injected: node={}, npm-global={}",
                            node_bin_dir.display(),
                            npm_bin_dir.display()
                        );
                    } else {
                        eprintln!(
                            "[node-runtime] bundled node not found at {}",
                            node_bin_dir.display()
                        );
                    }
                }
            }

            // 监听窗口事件：实时保存窗口状态到磁盘，并打印调试日志
            if let Some(window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                let window_clone = window.clone();

                // 恢复后打印当前窗口尺寸及所在显示器
                if let Ok(size) = window.inner_size() {
                    let pos = window.outer_position().unwrap_or_default();
                    let monitor_name = window
                        .current_monitor()
                        .ok()
                        .flatten()
                        .and_then(|m| m.name().map(|n| n.to_string()))
                        .unwrap_or_else(|| "Unknown".to_string());
                    println!(
                        "[window-state] restored: {}x{} @ ({}, {}) on monitor \"{}\"",
                        size.width, size.height, pos.x, pos.y, monitor_name
                    );
                }

                window_clone.on_window_event(move |e| match e {
                    WindowEvent::Resized(PhysicalSize { width, height }) => {
                        println!("[window-state] resized: {width}x{height}, saving...");
                        let _ = app_handle.save_window_state(StateFlags::all());
                    }
                    WindowEvent::Moved(pos) => {
                        let monitor_name = window
                            .current_monitor()
                            .ok()
                            .flatten()
                            .and_then(|m| m.name().map(|n| n.to_string()))
                            .unwrap_or_else(|| "Unknown".to_string());
                        println!(
                            "[window-state] moved: ({}, {}) on monitor \"{}\", saving...",
                            pos.x, pos.y, monitor_name
                        );
                        let _ = app_handle.save_window_state(StateFlags::all());
                    }
                    WindowEvent::CloseRequested { .. } => {
                        println!("[window-state] close requested, saving...");
                        let _ = app_handle.save_window_state(StateFlags::all());
                    }
                    _ => {}
                });
            }

            // 所有桌面平台开发期：注册所有 scheme 到当前可执行文件
            // macOS 也需要 register_all 来将 scheme 注册到 Launch Services
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            Ok(())
        })
        .manage(sidecar::SidecarState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            ensure_workspace_docs_dir,
            ensure_rabbit_specs_dir,
            read_text_file_unrestricted,
            open_notification_settings,
            send_desktop_notification,
            sidecar::start_sidecar,
            sidecar::send_to_sidecar,
            sidecar::stop_sidecar,
            sidecar::get_sidecar_status,
            db::db_load_all,
            db::db_save_all,
            db::db_has_data,
            network::diag_dns,
            network::diag_http,
            network::diag_ping,
            network::diag_marketplace,
            model_test::test_model_connection,
            gitnexus::gitnexus_install,
            gitnexus::gitnexus_uninstall,
            gitnexus::gitnexus_check,
            gitnexus::gitnexus_analyze,
            gitnexus::gitnexus_list,
            gitnexus::gitnexus_group_create,
            gitnexus::gitnexus_group_add,
            gitnexus::gitnexus_group_sync,
            gitnexus::gitnexus_group_status,
            ecc::ecc_check,
            ecc::ecc_install,
            ecc::ecc_uninstall,
            integration::github_device_code,
            integration::github_device_poll,
            integration::github_get_user,
            feedback::capture_app_window,
            feedback::collect_system_info,
            feedback::collect_performance_metrics,
            feedback::submit_feedback,
            auth::casdoor_complete_login,
            auth::casdoor_exchange_token,
            auth::casdoor_get_userinfo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
