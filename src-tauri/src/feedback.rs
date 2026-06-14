use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use sysinfo::System;
use tauri::command;

// ============================================================
// 数据结构（camelCase 对齐前端字段名）
// ============================================================

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureResult {
    pub base64_png: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub app_version: String,
    pub app_identifier: String,
    pub cpu_brand: String,
    pub cpu_cores: usize,
    pub total_memory_mb: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummary {
    pub name: String,
    pub provider: String,
    pub model_id: String,
    pub base_url: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpSummary {
    pub name: String,
    pub server_type: String,
    pub enabled: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    pub enabled: bool,
    pub has_http_proxy: bool,
    pub has_https_proxy: bool,
    pub has_socks_proxy: bool,
}

#[derive(Serialize, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSummary {
    pub models: Vec<ModelSummary>,
    pub enabled_mcp_servers: Vec<McpSummary>,
    pub proxy: ProxyStatus,
}

#[derive(Serialize, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewMetrics {
    pub dom_elements: u32,
    pub js_heap_used_mb: f64,
    pub js_heap_total_mb: f64,
    pub timing_dom_complete_ms: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceMetrics {
    pub app_memory_mb: f64,
    pub app_cpu_percent: f64,
    pub system_memory_usage_percent: f64,
    pub system_cpu_usage_percent: f64,
    pub webview_metrics: WebviewMetrics,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSubmitResult {
    pub success: bool,
    pub message: String,
    pub ticket_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackDescription {
    pub steps: String,
    pub expected: String,
    pub occurred_at: String,
    pub email: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPayload {
    pub screenshots: Vec<String>,
    pub description: FeedbackDescription,
    pub system_info: SystemInfo,
    pub config_summary: ConfigSummary,
    pub performance_metrics: Option<PerformanceMetrics>,
}

// ============================================================
// Tauri 命令
// ============================================================

const APP_WINDOW_TITLE: &str = "RabbitCoding";
const FEEDBACK_API_URL: &str = "https://coding.rabbitai-lab.com/api/feedback";

/// 截取当前应用窗口，返回 base64 编码的 JPEG 图片
#[command]
pub async fn capture_app_window() -> Result<ScreenCaptureResult, String> {
    tokio::task::spawn_blocking(|| {
        let windows = xcap::Window::all().map_err(|e| format!("Failed to enumerate windows: {e}"))?;

        // 按标题匹配当前应用窗口
        let app_window = windows
            .iter()
            .find(|w| w.title().unwrap_or_default().contains(APP_WINDOW_TITLE))
            .ok_or_else(|| format!("Window '{APP_WINDOW_TITLE}' not found"))?;

        let image = app_window
            .capture_image()
            .map_err(|e| format!("Failed to capture window: {e}"))?;

        let width = image.width();
        let height = image.height();

        // RGBA8 转 RGB8（JPEG 不支持 Alpha 通道）
        let rgb_image = image::DynamicImage::ImageRgba8(image).to_rgb8();

        // 编码为 JPEG（quality=85）减小体积
        let mut jpeg_buf = std::io::Cursor::new(Vec::new());
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg_buf, 85);
        encoder
            .encode_image(&image::DynamicImage::ImageRgb8(rgb_image))
            .map_err(|e| format!("Failed to encode JPEG: {e}"))?;

        let base64_png = general_purpose::STANDARD.encode(jpeg_buf.into_inner());

        Ok(ScreenCaptureResult {
            base64_png,
            width,
            height,
        })
    })
    .await
    .map_err(|e| format!("Capture task failed: {e}"))?
}

/// 收集系统信息
#[command]
pub async fn collect_system_info(app: tauri::AppHandle) -> Result<SystemInfo, String> {
    let app_version = app.package_info().version.to_string();
    let app_identifier = app.config().identifier.clone();
    let arch = std::env::consts::ARCH.to_string();
    let os = std::env::consts::OS.to_string();

    let mut sys = System::new();
    sys.refresh_cpu_all();
    sys.refresh_memory();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_default();
    let cpu_cores = sys.cpus().len();
    let total_memory_mb = sys.total_memory() / 1024 / 1024;

    // OS 版本
    let os_version = sysinfo::System::long_os_version().unwrap_or_default();

    Ok(SystemInfo {
        os,
        os_version,
        arch,
        app_version,
        app_identifier,
        cpu_brand,
        cpu_cores,
        total_memory_mb,
    })
}

/// 收集性能指标（合并前端 WebView 指标与 Rust 进程指标）
#[command]
pub async fn collect_performance_metrics(
    _app: tauri::AppHandle,
    webview_metrics: WebviewMetrics,
) -> Result<PerformanceMetrics, String> {
    let app_pid = std::process::id();

    let mut sys = System::new_all();
    sys.refresh_all();

    // 查找当前应用进程
    let (app_memory_mb, app_cpu_percent) = sys
        .process(sysinfo::Pid::from_u32(app_pid))
        .map(|p| {
            (
                p.memory() as f64 / 1024.0 / 1024.0,
                p.cpu_usage() as f64,
            )
        })
        .unwrap_or((0.0, 0.0));

    let total_memory = sys.total_memory() as f64;
    let used_memory = sys.used_memory() as f64;
    let system_memory_usage_percent = if total_memory > 0.0 {
        (used_memory / total_memory) * 100.0
    } else {
        0.0
    };

    let system_cpu_usage_percent = sys.cpus().iter().map(|c| c.cpu_usage() as f64).sum::<f64>()
        / sys.cpus().len().max(1) as f64;

    Ok(PerformanceMetrics {
        app_memory_mb,
        app_cpu_percent,
        system_memory_usage_percent,
        system_cpu_usage_percent,
        webview_metrics,
    })
}

/// 提交反馈到服务端 API
#[command]
pub async fn submit_feedback(payload: FeedbackPayload) -> Result<FeedbackSubmitResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .post(FEEDBACK_API_URL)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to submit feedback: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if status.is_success() {
        // 尝试解析服务端返回的 ticketId
        let ticket_id = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("ticketId")
                    .or_else(|| v.get("ticket_id"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.to_string())
            });

        Ok(FeedbackSubmitResult {
            success: true,
            message: "Feedback submitted successfully".to_string(),
            ticket_id,
        })
    } else {
        Ok(FeedbackSubmitResult {
            success: false,
            message: format!("Server returned {}: {}", status.as_u16(), body),
            ticket_id: None,
        })
    }
}
