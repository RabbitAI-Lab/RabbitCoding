//! Wiki 生成模块 — 桌面通知

#[cfg(target_os = "windows")]
use crate::process_ext::CommandNoWindowExt;

/// 发送桌面通知（复用 osascript/PowerShell 底层逻辑）
pub(super) fn notify_wiki_status(
    kind: &str, // "wiki_done" | "wiki_error" | "wiki_paused"
    workspace_name: &str,
    error: &str,
    language: &str,
) {
    let (title, body) = match (kind, language) {
        ("wiki_done", "zh") => (
            "Wiki 生成完成".to_string(),
            format!("工作区「{}」的知识库已生成完成", workspace_name),
        ),
        ("wiki_done", _) => (
            "Wiki Generation Complete".to_string(),
            format!("Knowledge base for '{}' has been generated", workspace_name),
        ),
        ("wiki_error", "zh") => (
            "Wiki 生成失败".to_string(),
            format!("工作区「{}」生成失败：{}", workspace_name, error),
        ),
        ("wiki_error", _) => (
            "Wiki Generation Failed".to_string(),
            format!("Failed for '{}': {}", workspace_name, error),
        ),
        ("wiki_paused", "zh") => (
            "Wiki 生成已暂停".to_string(),
            format!("工作区「{}」连续多个文件失败，已暂停生成", workspace_name),
        ),
        ("wiki_paused", _) => (
            "Wiki Generation Paused".to_string(),
            format!("'{}' paused due to consecutive failures", workspace_name),
        ),
        _ => return,
    };
    let _ = send_notification_os(&title, &body);
}

/// 跨平台桌面通知底层实现
fn send_notification_os(title: &str, body: &str) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let escaped_body = body.replace('\\', "\\\\").replace('"', "\\\"");
        let escaped_title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!(
            "display notification \"{escaped_body}\" with title \"{escaped_title}\" sound name \"default\""
        );
        let output = std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("osascript failed: {e}"))?;
        if !output.status.success() {
            return Ok(false);
        }
        return Ok(true);
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; \
             $balloon = New-Object System.Windows.Forms.NotifyIcon; \
             $balloon.Icon = [System.Drawing.SystemIcons]::Information; \
             $balloon.BalloonTipTitle = '{}'; \
             $balloon.BalloonTipText = '{}'; \
             $balloon.Visible = $true; \
             $balloon.ShowBalloonTip(5000);",
            title.replace('\'', "''"),
            body.replace('\'', "''"),
        );
        let output = std::process::Command::new("powershell")
            .no_window()
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| format!("powershell failed: {e}"))?;
        return Ok(output.status.success());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (title, body);
        Ok(false)
    }
}
