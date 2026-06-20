//! Wiki 生成模块 — AI 调用循环（Anthropic Messages API tool_use）

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::tools::{execute_tool, build_tool_definitions, ToolContext};
use super::types::WikiProgress;

/// 安全截取字符串到指定字节长度，自动回退到 UTF-8 字符边界
fn safe_truncate(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

// ============================================================
// AI API 请求/响应结构
// ============================================================

#[derive(Serialize)]
struct AiRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: Vec<serde_json::Value>,
    tools: Vec<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
struct AiResponse {
    #[serde(default)]
    stop_reason: Option<String>,
    #[serde(default)]
    content: Vec<ContentBlock>,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    #[serde(other)]
    Other,
}

// ============================================================
// AI 调用主循环
// ============================================================

/// AI 调用主循环
pub(super) async fn run_ai_loop(
    base_url: &str,
    api_key: &str,
    model_id: &str,
    system_prompt: &str,
    user_message: &str,
    tool_ctx: &ToolContext<'_>,
    app_handle: &AppHandle,
    progress: &WikiProgress,
    cancel_flag: &AtomicBool,
) -> Result<(), String> {
    let url = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(super::AI_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let tools = build_tool_definitions();

    // messages 初始只有 user message
    let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
        "role": "user",
        "content": user_message,
    })];

    let mut iterations = 0;
    let max_iterations = 30; // 安全限制

    loop {
        iterations += 1;
        if iterations > max_iterations {
            return Err("AI loop exceeded maximum iterations".to_string());
        }

        // 检查取消
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("cancelled".to_string());
        }

        let req_body = AiRequest {
            model: model_id,
            max_tokens: super::AI_MAX_TOKENS,
            system: system_prompt,
            messages: messages.clone(),
            tools: tools.clone(),
        };

        eprintln!(
            "[wiki] AI request iteration {iterations}, model={model_id}, messages={}",
            messages.len()
        );

        let response = client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", super::ANTHROPIC_VERSION)
            .header("content-type", "application/json")
            .json(&req_body)
            .send()
            .await
            .map_err(|e| {
                if e.is_timeout() {
                    format!("API timeout after {}s", super::AI_REQUEST_TIMEOUT_SECS)
                } else if e.is_connect() {
                    format!("Connection failed: {e}")
                } else {
                    format!("Request failed: {e}")
                }
            })?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let code = status.as_u16();
            let msg = match code {
                400 => format!("Bad request (400): {body}"),
                401 | 403 => format!("Auth failed ({code}): API Key invalid"),
                404 => format!("Endpoint not found (404): {url}"),
                429 => "Rate limited (429): too many requests".to_string(),
                c if (500..600).contains(&c) => format!("Server error ({c})"),
                _ => format!("HTTP {code}: {body}"),
            };
            return Err(msg);
        }

        let ai_response: AiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {e}"))?;

        let stop_reason = ai_response.stop_reason.as_deref().unwrap_or("");

        // 将 assistant 的 response 加入 messages
        let assistant_content: Vec<serde_json::Value> = ai_response
            .content
            .iter()
            .map(|block| match block {
                ContentBlock::Text { text } => serde_json::json!({
                    "type": "text",
                    "text": text,
                }),
                ContentBlock::ToolUse { id, name, input } => serde_json::json!({
                    "type": "tool_use",
                    "id": id,
                    "name": name,
                    "input": input,
                }),
                ContentBlock::Other => serde_json::json!({ "type": "text", "text": "" }),
            })
            .collect();
        messages.push(serde_json::json!({
            "role": "assistant",
            "content": assistant_content,
        }));

        // stop_reason 为 max_tokens 时，AI 输出被截断，需要继续对话
        if stop_reason == "max_tokens" {
            eprintln!("[wiki] AI output truncated (max_tokens), continuing conversation...");
            // 追加一条 user message 提示 AI 继续输出
            messages.push(serde_json::json!({
                "role": "user",
                "content": "Your previous response was truncated due to max_tokens. Please continue where you left off and complete the document by calling write_doc."
            }));
            continue;
        }

        // 如果 stop_reason 不是 tool_use，则循环结束
        if stop_reason != "tool_use" {
            eprintln!("[wiki] AI loop completed (stop_reason={stop_reason})");
            break;
        }

        // 执行工具调用
        let mut tool_results: Vec<serde_json::Value> = Vec::new();
        for block in &ai_response.content {
            if let ContentBlock::ToolUse { id, name, input } = block {
                let (result, is_error) = execute_tool(name, input, tool_ctx);
                eprintln!(
                    "[wiki] Tool: {name} -> {} (error={})",
                    safe_truncate(&result, 100),
                    is_error
                );
                tool_results.push(serde_json::json!({
                    "type": "tool_result",
                    "tool_use_id": id,
                    "content": result,
                    "is_error": is_error,
                }));
            }
        }

        // 将工具结果作为 user message
        messages.push(serde_json::json!({
            "role": "user",
            "content": tool_results,
        }));

        // 推进度（工具执行次数）
        let _ = app_handle.emit(
            "wiki-progress",
            WikiProgress {
                phase: format!("{}_tool", progress.phase),
                message: format!("AI iteration {iterations}"),
                ..progress.clone()
            },
        );
    }

    Ok(())
}

/// 带重试的 AI 调用包装
pub(super) async fn run_ai_loop_with_retry(
    base_url: &str,
    api_key: &str,
    model_id: &str,
    system_prompt: &str,
    user_message: &str,
    tool_ctx: &ToolContext<'_>,
    app_handle: &AppHandle,
    progress: &WikiProgress,
    cancel_flag: &AtomicBool,
    max_retries: u32,
) -> Result<(), String> {
    let mut last_err = String::new();
    for attempt in 0..max_retries {
        // 检查取消
        if cancel_flag.load(Ordering::SeqCst) {
            return Err("cancelled".to_string());
        }

        match run_ai_loop(
            base_url,
            api_key,
            model_id,
            system_prompt,
            user_message,
            tool_ctx,
            app_handle,
            progress,
            cancel_flag,
        )
        .await
        {
            Ok(()) => return Ok(()),
            Err(e) if e == "cancelled" => return Err(e),
            Err(e) => {
                last_err = e.clone();
                // 推送重试进度
                let _ = app_handle.emit(
                    "wiki-progress",
                    WikiProgress {
                        phase: format!("{}_retry", progress.phase),
                        message: format!(
                            "Retry {}/{}, error: {}",
                            attempt + 1,
                            max_retries,
                            safe_truncate(&e, 120)
                        ),
                        current: Some(attempt as i32 + 1),
                        total: Some(max_retries as i32),
                        ..progress.clone()
                    },
                );
                eprintln!("[wiki] Retry {}/{}: {}", attempt + 1, max_retries, e);
                if attempt + 1 < max_retries {
                    // 指数退避 2s, 4s, 8s
                    let delay_secs = 2u64.pow(attempt + 1);
                    tokio::time::sleep(Duration::from_secs(delay_secs)).await;
                }
            }
        }
    }
    Err(format!("Retry {max_retries} times failed: {last_err}"))
}
