use serde::{Deserialize, Serialize};
use tauri::command;

// ============================================================
// 常量
// ============================================================

const CASDOOR_BASE_URL: &str = "https://auth.rabbitai-lab.com";
const CASDOOR_CLIENT_ID: &str = "1a2b435570a36765109d";
const REDIRECT_URI: &str = "rabbitcoding://auth/callback";

// ============================================================
// 返回结构（camelCase 对齐前端）
// ============================================================

/// token 交换返回结果
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CasdoorTokenResponse {
    pub access_token: String,
    pub token_type: Option<String>,
    pub expires_in: Option<u64>,
    pub refresh_token: Option<String>,
}

/// 用户信息
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CasdoorUserInfo {
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub avatar: String,
}

/// 完整登录结果（前端保存用）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CasdoorLoginResult {
    pub access_token: String,
    pub username: String,
    pub display_name: String,
    pub email: String,
    pub avatar: String,
}

// ============================================================
// 辅助：HTTP 请求（复用 integration.rs 模式）
// ============================================================

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("RabbitCoding")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))
}

// ============================================================
// 内部解析结构
// ============================================================

/// Casdoor token 接口原始响应
#[derive(Deserialize)]
struct RawTokenResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// /api/get-account 原始响应
#[derive(Deserialize)]
struct RawGetAccount {
    #[serde(default)]
    #[allow(dead_code)]
    status: Option<String>,
    #[serde(default)]
    data: Option<RawAccountData>,
    #[serde(default)]
    msg: Option<String>,
}

/// /api/get-account 中 data 字段
#[derive(Deserialize)]
#[allow(non_snake_case)]
struct RawAccountData {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    displayName: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    avatar: Option<String>,
}

// ============================================================
// Command: casdoor_exchange_token
// 用 authorization code + code_verifier 换取 access_token
// ============================================================

#[command]
pub async fn casdoor_exchange_token(
    code: String,
    code_verifier: String,
) -> Result<CasdoorTokenResponse, String> {
    let url = format!("{}/api/login/oauth/access_token", CASDOOR_BASE_URL);

    let params = [
        ("grant_type", "authorization_code"),
        ("client_id", CASDOOR_CLIENT_ID),
        ("code", code.as_str()),
        ("code_verifier", code_verifier.as_str()),
        ("redirect_uri", REDIRECT_URI),
    ];

    eprintln!("[auth] POST {} (token exchange)", url);

    let client = http_client()?;
    let response = client
        .post(&url)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Failed to execute POST: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    eprintln!(
        "[auth] token exchange response status={} (first 500 chars): {:.500}",
        status, text
    );

    let parsed: RawTokenResponse = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse token response: {} (raw: {})", e, text))?;

    if let Some(token) = parsed.access_token {
        return Ok(CasdoorTokenResponse {
            access_token: token,
            token_type: parsed.token_type,
            expires_in: parsed.expires_in,
            refresh_token: parsed.refresh_token,
        });
    }

    Err(format!(
        "Token exchange failed: {} ({})",
        parsed.error.unwrap_or_else(|| "unknown".to_string()),
        parsed.error_description.unwrap_or_default()
    ))
}

// ============================================================
// Command: casdoor_get_userinfo
// 用 access_token 获取用户信息
// ============================================================

#[command]
pub async fn casdoor_get_userinfo(access_token: String) -> Result<CasdoorUserInfo, String> {
    let url = format!("{}/api/get-account", CASDOOR_BASE_URL);

    eprintln!("[auth] GET {} (userinfo)", url);

    let client = http_client()?;
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to execute GET: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    eprintln!(
        "[auth] userinfo response status={} (first 500 chars): {:.500}",
        status, text
    );

    let parsed: RawGetAccount = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse userinfo response: {} (raw: {})", e, text))?;

    let data = parsed.data.ok_or_else(|| {
        format!(
            "Userinfo response missing data: {}",
            parsed.msg.unwrap_or_default()
        )
    })?;

    Ok(CasdoorUserInfo {
        username: data.name.unwrap_or_default(),
        display_name: data.displayName.unwrap_or_default(),
        email: data.email.unwrap_or_default(),
        avatar: data.avatar.unwrap_or_default(),
    })
}

// ============================================================
// Command: casdoor_complete_login（组合命令）
// 一次性完成 token 交换 + userinfo 获取，减少前端往返
// ============================================================

#[command]
pub async fn casdoor_complete_login(
    code: String,
    code_verifier: String,
) -> Result<CasdoorLoginResult, String> {
    // Step 1: 换取 token
    let token = casdoor_exchange_token(code, code_verifier).await?;

    // Step 2: 获取用户信息
    let userinfo = casdoor_get_userinfo(token.access_token.clone()).await?;

    Ok(CasdoorLoginResult {
        access_token: token.access_token,
        username: userinfo.username,
        display_name: userinfo.display_name,
        email: userinfo.email,
        avatar: userinfo.avatar,
    })
}
