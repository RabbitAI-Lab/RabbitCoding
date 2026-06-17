//! 模型连接测试
//!
//! 向目标厂商的 anthropic 兼容端点发一次最小 Anthropic Messages 请求，
//! 验证 baseUrl / apiKey / modelId 是否配置正确。
//!
//! URL 拼接规则与 `@anthropic-ai/sdk` 保持一致：`{base_url 去尾斜杠}/v1/messages`，
//! 以保证「测试通过」等价于「sidecar 实际调用可用」。

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::command;

// ============================================================
// 常量
// ============================================================

/// Anthropic Messages API 协议版本头
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// 单次测试请求的超时时间（秒）
const REQUEST_TIMEOUT_SECS: u64 = 20;
/// 失败时附带的原始响应体最大字符数，避免前端展示过长
const ERROR_BODY_TRUNCATE: usize = 300;

// ============================================================
// 数据结构
// ============================================================

/// 模型连接测试结果（camelCase 对齐前端字段名）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestResult {
    /// 是否连通且鉴权通过、模型可用
    pub success: bool,
    /// HTTP 状态码（网络层失败时为 None）
    pub status_code: Option<u16>,
    /// 请求耗时（毫秒）
    pub latency_ms: Option<u64>,
    /// 服务端回显的 model 字段，用于确认 modelId 被接受
    pub model_echo: Option<String>,
    /// 友好错误描述（失败时填充）
    pub error: Option<String>,
}

/// 前端 invoke 传入的测试参数（与 start_sidecar 的 payload 模式一致，字段使用 snake_case）
#[derive(Deserialize)]
pub struct ModelTestPayload {
    pub base_url: String,
    pub api_key: String,
    pub model_id: String,
}

/// Anthropic Messages 最小响应体（仅解析关心的字段）
#[derive(Deserialize)]
struct MessagesResponse {
    model: Option<String>,
}

/// Anthropic 错误响应体
#[derive(Deserialize)]
struct ErrorResponse {
    error: Option<ErrorBody>,
}

#[derive(Deserialize)]
struct ErrorBody {
    message: Option<String>,
}

// ============================================================
// 命令实现
// ============================================================

/// 测试模型连接：向 `{base_url}/v1/messages` 发一次最小 Anthropic Messages 请求
///
/// 前端通过 `invoke('test_model_connection', { payload: { base_url, api_key, model_id } })` 调用。
/// 失败时返回 `Ok(ModelTestResult { success: false, ... })`，仅当命令自身执行异常才返回 `Err`，
/// 便于前端统一按 `result.success` 判定。
#[command]
pub async fn test_model_connection(
    payload: ModelTestPayload,
) -> Result<ModelTestResult, String> {
    let trimmed_base = payload.base_url.trim();
    let trimmed_key = payload.api_key.trim();
    let trimmed_model = payload.model_id.trim();

    if trimmed_base.is_empty() || trimmed_key.is_empty() || trimmed_model.is_empty() {
        return Ok(ModelTestResult {
            success: false,
            status_code: None,
            latency_ms: None,
            model_echo: None,
            error: Some("缺少必要参数：Base URL、API Key、模型 ID 不能为空".to_string()),
        });
    }

    let url = format!("{}/v1/messages", trimmed_base.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let body = serde_json::json!({
        "model": trimmed_model,
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": "hi" }],
    });

    let start = Instant::now();

    let response = client
        .post(&url)
        .header("x-api-key", trimmed_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await;

    let response = match response {
        Ok(r) => r,
        Err(e) => {
            // 区分超时、连接错误与其他失败，给出可读提示
            let msg = if e.is_timeout() {
                format!(
                    "请求超时（{}s 内未响应），请检查网络或 Base URL 是否正确",
                    REQUEST_TIMEOUT_SECS
                )
            } else if e.is_connect() {
                format!("无法连接到服务器，请检查 Base URL 是否正确: {e}")
            } else {
                format!("请求失败: {e}")
            };
            return Ok(ModelTestResult {
                success: false,
                status_code: None,
                latency_ms: Some(start.elapsed().as_millis() as u64),
                model_echo: None,
                error: Some(msg),
            });
        }
    };

    let status_code = response.status().as_u16();
    let latency_ms = start.elapsed().as_millis() as u64;

    // 成功：HTTP 2xx 且响应可解析
    if response.status().is_success() {
        let model_echo = response
            .json::<MessagesResponse>()
            .await
            .ok()
            .and_then(|r| r.model);

        return Ok(ModelTestResult {
            success: true,
            status_code: Some(status_code),
            latency_ms: Some(latency_ms),
            model_echo,
            error: None,
        });
    }

    // 失败：读取响应体用于诊断
    let text = response.text().await.unwrap_or_default();
    let server_msg = serde_json::from_str::<ErrorResponse>(&text)
        .ok()
        .and_then(|r| r.error)
        .and_then(|e| e.message);

    let friendly = match status_code {
        401 | 403 => format!("认证失败（HTTP {}）：API Key 错误或无访问权限", status_code),
        404 => format!(
            "端点不存在（HTTP 404）：Base URL 可能错误，实际请求地址 {}",
            url
        ),
        400 => format!(
            "请求被拒绝（HTTP 400）：{}",
            server_msg
                .clone()
                .unwrap_or_else(|| "modelId 不存在或参数非法".to_string())
        ),
        429 => "请求过于频繁（HTTP 429）：触发限流，请稍后重试".to_string(),
        code if (500..600).contains(&code) => format!("服务端错误（HTTP {}），请稍后重试", code),
        code => format!(
            "请求失败（HTTP {}）：{}",
            code,
            server_msg.clone().unwrap_or_else(|| "未知错误".to_string())
        ),
    };

    // 附上截断后的原始响应体，便于高级用户排查
    let detail = truncate(&text, ERROR_BODY_TRUNCATE);
    let error = if detail.is_empty() {
        friendly
    } else {
        format!("{}\n\n响应: {}", friendly, detail)
    };

    Ok(ModelTestResult {
        success: false,
        status_code: Some(status_code),
        latency_ms: Some(latency_ms),
        model_echo: None,
        error: Some(error),
    })
}

/// 按 char 边界截断字符串到最大字符数，避免 panic 并保留尾部省略号
fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.trim().to_string();
    }
    let result: String = s.chars().take(max_chars).collect();
    format!("{}…", result.trim())
}
