use serde::{Deserialize, Serialize};
use tauri::command;

// ============================================================
// GitHub OAuth Device Flow
// ============================================================

const GITHUB_CLIENT_ID: &str = "Ov23lip1E3P2UuEU5JIb";

// ============================================================
// 返回结构（camelCase 对齐前端）
// ============================================================

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenPollResponse {
    pub status: String, // "success" | "pending" | "slow_down" | "expired" | "error"
    pub access_token: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUserInfo {
    pub login: String,
    pub avatar_url: String,
    pub name: Option<String>,
}

// ============================================================
// 辅助：使用 reqwest 执行 HTTP 请求（跨平台）
// ============================================================

/// 创建带超时的 reqwest 客户端
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("RabbitCoding")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

/// POST JSON 请求
async fn http_post_json(url: &str, body: &serde_json::Value, accept_json: bool) -> Result<String, String> {
    eprintln!("[integration] POST {} body={}", url, body);

    let client = http_client()?;

    let mut req = client
        .post(url)
        .header("Content-Type", "application/json");

    if accept_json {
        req = req.header("Accept", "application/json");
    }

    let response = req
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Failed to execute POST: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    eprintln!("[integration] POST {} response status={} (first 500 chars): {:.500}", url, status, text);

    Ok(text)
}

/// GET 带 Auth 请求
async fn http_get_with_auth(url: &str, token: &str) -> Result<String, String> {
    eprintln!("[integration] GET {} (token length={})", url, token.len());

    let client = http_client()?;

    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to execute GET: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    eprintln!("[integration] GET {} response status={} (first 500 chars): {:.500}", url, status, text);

    Ok(text)
}

// ============================================================
// 内部解析结构（用于反序列化 GitHub 响应）
// ============================================================

#[derive(Deserialize)]
struct RawDeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct RawTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

#[derive(Deserialize)]
struct RawGitHubUser {
    login: String,
    avatar_url: String,
    name: Option<String>,
}

// ============================================================
// Command 1: github_device_code — 请求 Device Code
// ============================================================

#[command]
pub async fn github_device_code() -> Result<DeviceCodeResponse, String> {
    let body = serde_json::json!({
        "client_id": GITHUB_CLIENT_ID,
        "scope": "read:user repo"
    });

    let raw = http_post_json("https://github.com/login/device/code", &body, true).await?;

    let parsed: RawDeviceCode =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse device code response: {} (raw: {})", e, raw))?;

    Ok(DeviceCodeResponse {
        device_code: parsed.device_code,
        user_code: parsed.user_code,
        verification_uri: parsed.verification_uri,
        expires_in: parsed.expires_in,
        interval: parsed.interval,
    })
}

// ============================================================
// Command 2: github_device_poll — 轮询 Token
// ============================================================

#[command]
pub async fn github_device_poll(device_code: String) -> Result<TokenPollResponse, String> {
    let body = serde_json::json!({
        "client_id": GITHUB_CLIENT_ID,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
    });

    let raw = http_post_json(
        "https://github.com/login/oauth/access_token",
        &body,
        true,
    )
    .await?;

    let parsed: RawTokenResponse =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse token response: {} (raw: {})", e, raw))?;

    // 成功获取 token
    if let Some(token) = parsed.access_token {
        return Ok(TokenPollResponse {
            status: "success".to_string(),
            access_token: Some(token),
            error: None,
        });
    }

    // 处理错误类型
    let status = match parsed.error.as_deref() {
        Some("authorization_pending") => "pending",
        Some("slow_down") => "slow_down",
        Some("expired_token") => "expired",
        Some(other) => {
            return Ok(TokenPollResponse {
                status: "error".to_string(),
                access_token: None,
                error: Some(format!("{}: {}", other, parsed.error_description.unwrap_or_default())),
            });
        }
        None => "error",
    };

    Ok(TokenPollResponse {
        status: status.to_string(),
        access_token: None,
        error: parsed.error,
    })
}

// ============================================================
// Command 3: github_get_user — 获取用户信息
// ============================================================

#[command]
pub async fn github_get_user(token: String) -> Result<GitHubUserInfo, String> {
    let raw = http_get_with_auth("https://api.github.com/user", &token).await?;

    let parsed: RawGitHubUser =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse user response: {} (raw: {})", e, raw))?;

    Ok(GitHubUserInfo {
        login: parsed.login,
        avatar_url: parsed.avatar_url,
        name: parsed.name,
    })
}
