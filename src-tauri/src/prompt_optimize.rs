//! 提示词优化
//!
//! 向目标厂商的 anthropic 兼容端点发一次 Anthropic Messages 请求，
//! 把用户的原始需求改写为清晰、结构化、可执行的提示词。
//!
//! 复用 model_test 已验证的请求模式，但走更长超时（60s）并解析 content 数组。

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::command;

// ============================================================
// 常量
// ============================================================

/// Anthropic Messages API 协议版本头
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// 单次优化请求的超时时间（秒），优化可能生成长文本
const REQUEST_TIMEOUT_SECS: u64 = 60;
/// 失败时附带的原始响应体最大字符数，避免前端展示过长
const ERROR_BODY_TRUNCATE: usize = 300;

/// 内置优化 system prompt：智能保持原文语言，输出结构化提示词正文
const OPTIMIZE_SYSTEM_PROMPT: &str = "You are a prompt engineering expert. Rewrite the user's raw request into a clear, structured, executable prompt.\n\nRules:\n1. Detect the language of the original request and output in the SAME language (Chinese in → Chinese out, English in → English out).\n2. Structure the prompt to include: goal, key constraints, expected output, and boundary conditions when applicable.\n3. Preserve the user's original intent. Do NOT invent technical details, libraries, or requirements that are not present in the original.\n4. Be concise but complete — expand vague parts with reasonable assumptions stated explicitly.\n5. Output ONLY the rewritten prompt body. No explanations, no preamble, no suffix, no Markdown code fence.";

// ============================================================
// 数据结构
// ============================================================

/// 提示词优化结果（camelCase 对齐前端字段名）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OptimizePromptResult {
    /// 是否优化成功
    pub success: bool,
    /// 优化后的提示词（成功时填充）
    pub optimized_prompt: Option<String>,
    /// 请求耗时（毫秒）
    pub latency_ms: Option<u64>,
    /// 友好错误描述（失败时填充）
    pub error: Option<String>,
}

/// 前端 invoke 传入的优化参数（snake_case）
#[derive(Deserialize)]
pub struct OptimizePromptPayload {
    pub base_url: String,
    pub api_key: String,
    pub model_id: String,
    pub prompt: String,
}

/// Anthropic Messages 响应体（content 为文本块数组）
#[derive(Deserialize)]
struct MessagesResponse {
    content: Option<Vec<ContentBlock>>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
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

/// 优化提示词：向 `{base_url}/v1/messages` 发一次 Anthropic Messages 请求
///
/// 前端通过 `invoke('optimize_prompt', { payload: { base_url, api_key, model_id, prompt } })` 调用。
/// 失败时返回 `Ok(OptimizePromptResult { success: false, ... })`，仅当命令自身执行异常才返回 `Err`。
#[command]
pub async fn optimize_prompt(
    payload: OptimizePromptPayload,
) -> Result<OptimizePromptResult, String> {
    let trimmed_base = payload.base_url.trim();
    let trimmed_key = payload.api_key.trim();
    let trimmed_model = payload.model_id.trim();
    let trimmed_prompt = payload.prompt.trim();

    if trimmed_base.is_empty() || trimmed_key.is_empty() || trimmed_model.is_empty() {
        return Ok(OptimizePromptResult {
            success: false,
            optimized_prompt: None,
            latency_ms: None,
            error: Some("缺少必要参数：Base URL、API Key、模型 ID 不能为空".to_string()),
        });
    }
    if trimmed_prompt.is_empty() {
        return Ok(OptimizePromptResult {
            success: false,
            optimized_prompt: None,
            latency_ms: None,
            error: Some("提示词内容不能为空".to_string()),
        });
    }

    let url = format!("{}/v1/messages", trimmed_base.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let body = serde_json::json!({
        "model": trimmed_model,
        "max_tokens": 2048,
        "system": OPTIMIZE_SYSTEM_PROMPT,
        "messages": [{ "role": "user", "content": trimmed_prompt }],
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
            let msg = if e.is_timeout() {
                format!(
                    "请求超时（{}s 内未响应），请检查网络或重试",
                    REQUEST_TIMEOUT_SECS
                )
            } else if e.is_connect() {
                format!("无法连接到服务器，请检查 Base URL 是否正确: {e}")
            } else {
                format!("请求失败: {e}")
            };
            return Ok(OptimizePromptResult {
                success: false,
                optimized_prompt: None,
                latency_ms: Some(start.elapsed().as_millis() as u64),
                error: Some(msg),
            });
        }
    };

    let status_code = response.status().as_u16();
    let latency_ms = start.elapsed().as_millis() as u64;

    // 成功：HTTP 2xx 且响应可解析
    if response.status().is_success() {
        let parsed = response.json::<MessagesResponse>().await;

        let optimized = match parsed {
            Ok(r) => r
                .content
                .unwrap_or_default()
                .into_iter()
                .filter(|b| b.block_type == "text")
                .filter_map(|b| b.text)
                .collect::<Vec<String>>()
                .join(""),
            Err(_) => String::new(),
        };

        if optimized.trim().is_empty() {
            return Ok(OptimizePromptResult {
                success: false,
                optimized_prompt: None,
                latency_ms: Some(latency_ms),
                error: Some("模型返回空内容，请重试".to_string()),
            });
        }

        return Ok(OptimizePromptResult {
            success: true,
            optimized_prompt: Some(optimized.trim().to_string()),
            latency_ms: Some(latency_ms),
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

    let detail = truncate(&text, ERROR_BODY_TRUNCATE);
    let error = if detail.is_empty() {
        friendly
    } else {
        format!("{}\n\n响应: {}", friendly, detail)
    };

    Ok(OptimizePromptResult {
        success: false,
        optimized_prompt: None,
        latency_ms: Some(latency_ms),
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
