use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use tauri::{command, AppHandle, Emitter};

// ============================================================
// 常量
// ============================================================

const CASDOOR_BASE_URL: &str = "https://auth.rabbitai-lab.com";
const CASDOOR_CLIENT_ID: &str = "1a2b435570a36765109d";
// OAuth 回调走 loopback HTTP 服务：浏览器在 Casdoor 登录后被重定向到
// http://127.0.0.1:{AUTH_CALLBACK_PORT}/callback?code=&state=，由本地服务捕获 code/state，
// 再通过 Tauri 事件 `auth-callback` 通知前端。无需注册自定义 scheme / .app bundle，
// tauri dev 与生产 .app 行为一致。
const AUTH_CALLBACK_PORT: u16 = 17331;
const REDIRECT_URI: &str = "http://127.0.0.1:17331/callback";
const AUTH_CALLBACK_EVENT: &str = "auth-callback";

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

// ============================================================
// 本地 OAuth 回调 HTTP 服务（loopback）
// ============================================================

/// 启动 loopback 回调服务。应在应用启动时调用一次。
///
/// 监听 127.0.0.1:AUTH_CALLBACK_PORT，收到 `GET /callback?code=&state=` 后：
///   1. 通过 Tauri 事件 `auth-callback`（payload: { code, state }）通知前端；
///   2. 向浏览器返回「登录成功」提示页面。
///
/// 使用 std::net + 独立线程实现，不引入额外依赖。
pub fn start_auth_callback_server(app: AppHandle) {
    std::thread::spawn(move || {
        let listener = match std::net::TcpListener::bind(("127.0.0.1", AUTH_CALLBACK_PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!(
                    "[auth] callback server: bind 127.0.0.1:{} failed: {e}",
                    AUTH_CALLBACK_PORT
                );
                return;
            }
        };
        eprintln!(
            "[auth] callback server listening on http://127.0.0.1:{}/callback",
            AUTH_CALLBACK_PORT
        );

        for incoming in listener.incoming() {
            let mut stream = match incoming {
                Ok(s) => s,
                Err(_) => continue,
            };
            let app = app.clone();
            std::thread::spawn(move || handle_callback_connection(&mut stream, &app));
        }
    });
}

/// 处理单次回调连接：解析请求行，提取 code/state/error，发事件并返回响应页面。
fn handle_callback_connection(stream: &mut std::net::TcpStream, app: &AppHandle) {
    let mut buf = [0u8; 8192];
    let n = match stream.read(&mut buf) {
        Ok(n) if n > 0 => n,
        _ => return,
    };
    let req = String::from_utf8_lossy(&buf[..n]);

    // 解析请求行: GET /callback?code=...&state=... HTTP/1.1
    let req_line = req.lines().next().unwrap_or("");
    let path = req_line.split_whitespace().nth(1).unwrap_or("");
    let (loc, query) = path.split_once('?').unwrap_or((path, ""));

    let mut code = String::new();
    let mut state = String::new();
    let mut error = String::new();
    for kv in query.split('&') {
        if let Some((k, v)) = kv.split_once('=') {
            match k {
                "code" => code = percent_decode(v),
                "state" => state = percent_decode(v),
                "error" => error = percent_decode(v),
                _ => {}
            }
        }
    }

    let (status, title, message): (&str, &str, String) = if loc == "/callback" {
        if !code.is_empty() {
            let _ = app.emit(
                AUTH_CALLBACK_EVENT,
                serde_json::json!({ "code": code, "state": state }),
            );
            (
                "200 OK",
                "登录成功",
                "登录成功，可以关闭此页面并返回应用。".to_string(),
            )
        } else {
            (
                "400 Bad Request",
                "登录失败",
                format!(
                    "登录失败：{}",
                    if error.is_empty() { "未知错误" } else { &error }
                ),
            )
        }
    } else {
        ("404 Not Found", "未找到", "Not Found".to_string())
    };

    let html = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>{title}</title></head>\
         <body style=\"font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:60px\">\
         <h2>{title}</h2><p>{message}</p></body></html>"
    );
    let resp = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {len}\r\n\r\n{html}",
        len = html.len()
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

/// 简易 percent-decode（处理 %XX 与 +），用于 OAuth 回调参数（code/state/error 均为 ASCII）。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(' '),
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b as char);
                    i += 3;
                    continue;
                } else {
                    out.push('%');
                }
            }
            c => out.push(c as char),
        }
        i += 1;
    }
    out
}
