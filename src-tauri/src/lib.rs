mod sidecar;
mod db;
mod network;
mod model_test;
mod prompt_optimize;
mod gitnexus;
mod integration;
mod feedback;
mod ecc;
mod claude_mem;
mod auth;
mod wiki;
mod voice;
mod worktree;

use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::process::Command;
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

/// 确保工作区路径下存在 .rabbit/codewiki 目录（幂等）
#[tauri::command]
fn ensure_rabbit_codewiki_dir(path: String) -> Result<String, String> {
    let codewiki_dir = std::path::Path::new(&path).join(".rabbit").join("codewiki");
    std::fs::create_dir_all(&codewiki_dir)
        .map_err(|e| format!("Failed to create .rabbit/codewiki directory: {e}"))?;
    Ok(codewiki_dir.to_string_lossy().to_string())
}

#[derive(Default)]
struct CodeWikiStats {
    files: usize,
    dirs: usize,
    extensions: BTreeMap<String, usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeWikiEntry {
    name: String,
    path: String,
    is_directory: bool,
    children: Option<Vec<CodeWikiEntry>>,
}

fn read_codewiki_tree(dir: &std::path::Path) -> Result<Vec<CodeWikiEntry>, String> {
    let mut items = Vec::new();
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read Code Wiki directory '{}': {e}", dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read Code Wiki entry: {e}"))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == ".DS_Store" {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type for '{}': {e}", entry.path().display()))?;
        let is_directory = file_type.is_dir();
        let path = entry.path();
        let children = if is_directory {
            Some(read_codewiki_tree(&path)?)
        } else {
            None
        };

        items.push(CodeWikiEntry {
            name: file_name,
            path: path.to_string_lossy().to_string(),
            is_directory,
            children,
        });
    }

    items.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(items)
}

/// 列出工作区 .rabbit/codewiki 下的内容。目录不存在时返回空数组。
#[tauri::command]
fn list_rabbit_codewiki_files(path: String) -> Result<Vec<CodeWikiEntry>, String> {
    let codewiki_dir = std::path::Path::new(&path).join(".rabbit").join("codewiki");
    if !codewiki_dir.exists() {
        return Ok(Vec::new());
    }
    if !codewiki_dir.is_dir() {
        return Err(format!("Code Wiki path is not a directory: {}", codewiki_dir.display()));
    }
    read_codewiki_tree(&codewiki_dir)
}

fn codewiki_ignored_names() -> HashSet<&'static str> {
    HashSet::from([
        ".git",
        ".rabbit",
        ".DS_Store",
        "node_modules",
        "dist",
        "build",
        "target",
        ".next",
        ".nuxt",
        ".turbo",
        ".cache",
        ".gradle",
        "vendor",
        "__pycache__",
    ])
}

fn collect_codewiki_structure(
    dir: &std::path::Path,
    root: &std::path::Path,
    depth: usize,
    max_depth: usize,
    max_entries: usize,
    ignored: &HashSet<&'static str>,
    lines: &mut Vec<String>,
    stats: &mut CodeWikiStats,
) -> Result<(), String> {
    if lines.len() >= max_entries {
        return Ok(());
    }

    let mut entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to scan '{}': {e}", dir.display()))?
        .filter_map(Result::ok)
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            !ignored.contains(name.as_str())
        })
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().to_string_lossy().to_lowercase().cmp(
                &b.file_name().to_string_lossy().to_lowercase(),
            ),
        }
    });

    for entry in entries {
        if lines.len() >= max_entries {
            break;
        }

        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to read file type for '{}': {e}", path.display()))?;
        let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy();
        let indent = "  ".repeat(depth);

        if file_type.is_dir() {
            stats.dirs += 1;
            lines.push(format!("{indent}- {rel}/"));
            if depth < max_depth {
                collect_codewiki_structure(
                    &path,
                    root,
                    depth + 1,
                    max_depth,
                    max_entries,
                    ignored,
                    lines,
                    stats,
                )?;
            }
        } else if file_type.is_file() {
            stats.files += 1;
            if let Some(ext) = path.extension().and_then(|v| v.to_str()) {
                let key = ext.to_lowercase();
                *stats.extensions.entry(key).or_insert(0) += 1;
            }
            lines.push(format!("{indent}- {rel}"));
        }
    }

    Ok(())
}

fn render_codewiki_docs(
    workspace_path: &str,
    language: &str,
    lines: &[String],
    stats: &CodeWikiStats,
) -> (String, String) {
    let extension_rows = stats
        .extensions
        .iter()
        .rev()
        .take(12)
        .map(|(ext, count)| format!("- .{ext}: {count}"))
        .collect::<Vec<_>>()
        .join("\n");
    let tree = if lines.is_empty() {
        "(empty)".to_string()
    } else {
        lines.join("\n")
    };

    if language == "en" {
        let overview = format!(
            "# Code Wiki\n\n## Overview\n\n- Workspace: `{workspace_path}`\n- Files scanned: {}\n- Directories scanned: {}\n- Export path: `.rabbit/codewiki`\n\n## Top file types\n\n{}\n\n## Structure\n\nSee [Structure](./structure.md).\n",
            stats.files,
            stats.dirs,
            if extension_rows.is_empty() { "- No files".to_string() } else { extension_rows.clone() },
        );
        let structure = format!("# Code Structure\n\n```text\n{tree}\n```\n");
        (overview, structure)
    } else {
        let overview = format!(
            "# Code Wiki\n\n## 概览\n\n- 工作区: `{workspace_path}`\n- 已扫描文件: {}\n- 已扫描目录: {}\n- 导出路径: `.rabbit/codewiki`\n\n## 主要文件类型\n\n{}\n\n## 代码结构\n\n查看 [代码结构](./structure.md)。\n",
            stats.files,
            stats.dirs,
            if extension_rows.is_empty() { "- 暂无文件".to_string() } else { extension_rows },
        );
        let structure = format!("# 代码结构\n\n```text\n{tree}\n```\n");
        (overview, structure)
    }
}

/// 生成轻量 Code Wiki，并导出到 .rabbit/codewiki。
#[tauri::command]
fn generate_rabbit_codewiki(path: String, language: String) -> Result<String, String> {
    let workspace_path = std::path::Path::new(&path);
    if !workspace_path.is_dir() {
        return Err(format!("Workspace path is not a directory: {path}"));
    }

    let codewiki_dir = workspace_path.join(".rabbit").join("codewiki");
    std::fs::create_dir_all(&codewiki_dir)
        .map_err(|e| format!("Failed to create .rabbit/codewiki directory: {e}"))?;

    let ignored = codewiki_ignored_names();
    let mut lines = Vec::new();
    let mut stats = CodeWikiStats::default();
    collect_codewiki_structure(
        workspace_path,
        workspace_path,
        0,
        3,
        500,
        &ignored,
        &mut lines,
        &mut stats,
    )?;

    let (overview, structure) = render_codewiki_docs(&path, &language, &lines, &stats);
    std::fs::write(codewiki_dir.join("README.md"), overview)
        .map_err(|e| format!("Failed to write README.md: {e}"))?;
    std::fs::write(codewiki_dir.join("structure.md"), structure)
        .map_err(|e| format!("Failed to write structure.md: {e}"))?;

    Ok(codewiki_dir.to_string_lossy().to_string())
}

/// 读取文本文件内容（绕过 Tauri fs:scope 对隐藏目录的限制，用于读取 .rabbit 等目录中的文件）
#[tauri::command]
fn read_text_file_unrestricted(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read file '{path}': {e}"))
}

#[derive(Serialize)]
struct GitInfo {
    branch: Option<String>,
    commit_id: Option<String>,
}

/// 获取指定路径的 git 分支名和短 commit ID
#[tauri::command]
fn get_git_info(path: String) -> Result<GitInfo, String> {
    let dir = std::path::Path::new(&path);
    // branch
    let branch = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(dir)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });
    // short commit id
    let commit_id = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(dir)
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });
    Ok(GitInfo { branch, commit_id })
}

/// 获取文件最后修改时间（unix ms）
#[tauri::command]
fn get_file_modified(path: String) -> Result<u64, String> {
    let meta = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to get metadata for '{path}': {e}"))?;
    let modified = meta.modified()
        .map_err(|e| format!("Failed to get modified time: {e}"))?;
    let ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(ms)
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

/// 激活主窗口：show + setFocus + macOS 应用级激活（跨应用置顶，多屏幕兼容）
#[tauri::command]
fn activate_main_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let main_window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    main_window
        .show()
        .map_err(|e| format!("show failed: {e}"))?;
    main_window
        .set_focus()
        .map_err(|e| format!("set_focus failed: {e}"))?;

    // macOS：调用 NSApplication activateIgnoringOtherApps:YES
    // 让窗口跨应用置顶，不受其他应用遮挡
    #[cfg(target_os = "macos")]
    {
        macos_activate_app();
    }

    // Windows：使用 SetForegroundWindow 跨应用置顶
    #[cfg(target_os = "windows")]
    {
        windows_activate_window(&main_window);
    }

    Ok(())
}

/// macOS FFI：激活当前应用为前台应用（跨应用置顶）
#[cfg(target_os = "macos")]
fn macos_activate_app() {
    use std::ffi::c_void;
    use std::os::raw::{c_char, c_int};

    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn objc_msgSend(obj: *mut c_void, sel: *mut c_void, ...) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
    }

    unsafe {
        let app: *mut c_void = {
            let cls_name = b"NSApplication\0".as_ptr() as *const c_char;
            let sel_name = b"sharedApplication\0".as_ptr() as *const c_char;
            let cls = objc_getClass(cls_name);
            objc_msgSend(cls, sel_registerName(sel_name))
        };
        if app.is_null() {
            eprintln!("[activate] NSApplication is null");
            return;
        }

        // [NSApp activateIgnoringOtherApps:YES]
        let sel_name = b"activateIgnoringOtherApps:\0".as_ptr() as *const c_char;
        let sel = sel_registerName(sel_name);
        let yes: c_int = 1;
        objc_msgSend(app, sel, yes);
    }
}

/// Windows FFI：跨应用将主窗口置顶（SetForegroundWindow + AttachThreadInput 绕过前台锁定）
#[cfg(target_os = "windows")]
fn windows_activate_window(window: &tauri::WebviewWindow) {
    use std::ffi::c_void;
    use std::os::raw::{c_int, c_ulong};

    extern "system" {
        fn GetForegroundWindow() -> *mut c_void;
        fn GetWindowThreadProcessId(hwnd: *mut c_void, lpdwProcessId: *mut c_ulong) -> c_ulong;
        fn GetCurrentThreadId() -> c_ulong;
        fn AttachThreadInput(idAttach: c_ulong, idAttachTo: c_ulong, fAttach: c_int) -> c_int;
        fn SetForegroundWindow(hwnd: *mut c_void) -> c_int;
    }

    // 获取窗口句柄
    let hwnd = window.hwnd().ok();
    let hwnd = match hwnd {
        Some(h) => h,
        None => {
            eprintln!("[activate] failed to get HWND");
            return;
        }
    };

    unsafe {
        let hwnd_ptr = hwnd.0 as *mut c_void;

        // SetForegroundWindow 在 Windows 上有前台锁定限制（只有当前前台窗口的进程才能设置前台）
        // 通过 AttachThreadInput 将当前线程的输入队列附加到前台线程，绕过该限制
        let fg_hwnd = GetForegroundWindow();
        let fg_thread = if fg_hwnd.is_null() {
            GetCurrentThreadId()
        } else {
            GetWindowThreadProcessId(fg_hwnd, std::ptr::null_mut())
        };
        let cur_thread = GetCurrentThreadId();

        if fg_thread != cur_thread {
            AttachThreadInput(cur_thread, fg_thread, 1);
        }

        SetForegroundWindow(hwnd_ptr);

        if fg_thread != cur_thread {
            AttachThreadInput(cur_thread, fg_thread, 0);
        }
    }
}

/// macOS FFI：通过 CGEventGetLocation 获取全局鼠标位置（points 单位，不需要权限）
#[cfg(target_os = "macos")]
mod pet_cursor_ffi {
    #[repr(C)]
    struct CGPoint {
        x: f64,
        y: f64,
    }
    type CGEventSourceRef = *mut std::ffi::c_void;
    type CGEventRef = *mut std::ffi::c_void;

    extern "C" {
        fn CGEventSourceCreate(state_id: u32) -> CGEventSourceRef;
        fn CGEventCreate(source: CGEventSourceRef) -> CGEventRef;
        fn CGEventGetLocation(event: CGEventRef) -> CGPoint;
        fn CFRelease(cf: *mut std::ffi::c_void);
    }

    /// kCGEventSourceStateCombinedSessionState
    const COMBINED_SESSION_STATE: u32 = 0;

    pub fn global_mouse_position() -> Option<(f64, f64)> {
        unsafe {
            let source = CGEventSourceCreate(COMBINED_SESSION_STATE);
            if source.is_null() {
                return None;
            }
            let event = CGEventCreate(source);
            CFRelease(source);
            if event.is_null() {
                return None;
            }
            let point = CGEventGetLocation(event);
            CFRelease(event);
            Some((point.x, point.y))
        }
    }
}

/// Windows FFI：通过 GetCursorPos 获取全局鼠标位置（物理像素，不需要权限）
#[cfg(target_os = "windows")]
mod pet_cursor_ffi {
    #[repr(C)]
    struct POINT {
        x: i32,
        y: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(lppoint: *mut POINT) -> i32;
    }

    pub fn global_mouse_position() -> Option<(f64, f64)> {
        unsafe {
            let mut point = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut point) == 0 {
                return None;
            }
            Some((point.x as f64, point.y as f64))
        }
    }
}

/// 判断宠物窗口是否应该忽略鼠标事件（穿透）。
/// 返回 true = 透明区域穿透；false = 图标区域可交互。
fn compute_pet_cursor_ignore(pet_window: &tauri::WebviewWindow) -> Option<bool> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let (mouse_x, mouse_y) = pet_cursor_ffi::global_mouse_position()?;

        let scale = pet_window.scale_factor().unwrap_or(1.0);
        let win_pos = pet_window.outer_position().ok()?;
        let win_size = pet_window.outer_size().ok()?;

        // 转换为逻辑像素
        // macOS: CGEvent 返回 points（逻辑像素），窗口物理坐标需 /scale 对齐
        // Windows: GetCursorPos 返回物理像素，窗口也是物理像素，两者 /scale 后统一为逻辑像素
        let win_x = win_pos.x as f64 / scale;
        let win_y = win_pos.y as f64 / scale;
        let win_w = win_size.width as f64 / scale;
        let win_h = win_size.height as f64 / scale;

        // macOS: CGEvent 坐标已经是 points，直接使用
        // Windows: GetCursorPos 返回物理像素，需 /scale 转逻辑像素
        #[cfg(target_os = "windows")]
        let (mouse_x, mouse_y) = (mouse_x / scale, mouse_y / scale);

        let rel_x = mouse_x - win_x;
        let rel_y = mouse_y - win_y;

        // 图标区域（逻辑像素）：CSS 布局 stage padding 14px/14px/16px, flex justify-end align-center
        let icon_w = 92.0;
        let icon_h = 118.0;
        let icon_left = 14.0 + (win_w - 28.0 - icon_w) / 2.0;
        let icon_top = win_h - 16.0 - icon_h;

        let in_icon = rel_x >= icon_left
            && rel_x <= icon_left + icon_w
            && rel_y >= icon_top
            && rel_y <= icon_top + icon_h;

        Some(!in_icon)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = pet_window; // 避免 unused 警告
        None // Linux 暂不支持穿透
    }
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
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            // 启动本地 OAuth 回调 HTTP 服务（loopback，127.0.0.1:17331/callback）
            auth::start_auth_callback_server(app.handle().clone());

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

            // DevTools 默认不在启动时自动打开（避免开发期每次启动弹出）。
            // 需要调试时按 F12 手动切换；release 构建同样支持（devtools feature 已在 Cargo.toml 中启用）。

            // 所有桌面平台开发期：注册所有 scheme 到当前可执行文件
            // macOS 也需要 register_all 来将 scheme 注册到 Launch Services
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Wiki 全局队列 worker（mpsc channel + 单 worker，并发=1）
            let wiki_state = wiki::create_wiki_queue_and_worker(app.handle().clone());
            app.manage(wiki_state);

            // 宠物窗口：动态点击穿透（仅图标区域可交互，透明区域穿透到桌面）
            if let Some(pet_window) = app.get_webview_window("pet") {
                eprintln!("[pet-cursor] pet window found, starting cursor ignore polling");
                let pet_window = pet_window.clone();
                tauri::async_runtime::spawn(async move {
                    let mut last_ignore = false;
                    loop {
                        let should_ignore = compute_pet_cursor_ignore(&pet_window).unwrap_or(false);
                        if should_ignore != last_ignore {
                            eprintln!("[pet-cursor] ignore={} ({}→{})",
                                should_ignore, last_ignore, should_ignore);
                            let _ = pet_window.set_ignore_cursor_events(should_ignore);
                            last_ignore = should_ignore;
                        }
                        // 50ms 轮询（20fps）：鼠标穿透不需要高帧率，降低 CPU 开销
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    }
                });
            } else {
                eprintln!("[pet-cursor] WARNING: pet window not found, click-through disabled");
            }

            Ok(())
        })
        .manage(sidecar::SidecarState::new())
        .manage(voice::VoiceState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            activate_main_window,
            ensure_workspace_docs_dir,
            ensure_rabbit_specs_dir,
            ensure_rabbit_codewiki_dir,
            list_rabbit_codewiki_files,
            generate_rabbit_codewiki,
            read_text_file_unrestricted,
            get_git_info,
            get_file_modified,
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
            prompt_optimize::optimize_prompt,
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
            claude_mem::claude_mem_check,
            claude_mem::claude_mem_install,
            claude_mem::claude_mem_uninstall,
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
            wiki::generate_ai_wiki,
            wiki::wiki_cancel,
            wiki::wiki_queue_status,
            wiki::wiki_clear_queue,
            wiki::wiki_retry_failed,
            wiki::wiki_meta_status,
            wiki::list_codewiki_tree,
            wiki::list_codewiki_catalogs,
            wiki::wiki_check_pending,
            voice::voice_supported,
            voice::asr_status,
            voice::asr_ensure_model,
            voice::asr_start,
            voice::asr_feed_chunk,
            voice::asr_stop,
            voice::asr_list_models,
            voice::asr_get_config,
            voice::asr_set_config,
            voice::asr_redownload_model,
            worktree::create_worktree,
            worktree::remove_worktree,
            worktree::list_worktrees,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
