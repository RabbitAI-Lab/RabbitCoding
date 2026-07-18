use serde::Serialize;
use std::process::Command;
use crate::process_ext::CommandNoWindowExt;
use std::time::Instant;
use tauri::command;

// ============================================================
// 预设诊断目标
// ============================================================

const DNS_HOSTS: &[&str] = &[
    "center.qoder.sh",
    "qts2.qoder.sh",
    "openapi.qoder.sh",
    "repo2.qoder.sh",
    "api3.qoder.sh",
];

const HTTP_ENDPOINTS: &[&str] = &[
    "https://center.qoder.sh/algo/api/v1/ping",
    "https://qts2.qoder.sh/algo/api/v1/ping",
    "https://openapi.qoder.sh/algo/api/v1/ping",
];

const PING_TARGETS: &[&str] = &["center.qoder.sh", "openapi.qoder.sh"];

const MARKETPLACE_ENDPOINT: &str = "https://marketplace.qoder.sh";

// ============================================================
// 数据结构（camelCase 对齐前端字段名）
// ============================================================

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProxyInfo {
    pub enabled: bool,
    pub source: Option<String>,
    pub address: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DnsResult {
    pub host: String,
    pub proxy: ProxyInfo,
    pub server: Option<String>,
    pub resolved_ips: Vec<String>,
    pub resolution_ms: Option<u64>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HttpResult {
    pub endpoint: String,
    pub method: String,
    pub proxy: ProxyInfo,
    pub status_code: Option<u16>,
    pub http_version: Option<String>,
    pub tls_version: Option<String>,
    pub response_time_ms: Option<u64>,
    pub content_type: Option<String>,
    pub remote_ip: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PingResult {
    pub target: String,
    pub ip: Option<String>,
    pub packets_sent: Option<u32>,
    pub packets_received: Option<u32>,
    pub packet_loss_percent: Option<f64>,
    pub rtt_min_ms: Option<f64>,
    pub rtt_avg_ms: Option<f64>,
    pub rtt_max_ms: Option<f64>,
    pub status: String,
    pub error: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceResult {
    pub endpoint: String,
    pub proxy: ProxyInfo,
    pub connection_ok: bool,
    pub api_available: bool,
    pub status_code: Option<u16>,
    pub response_time_ms: Option<u64>,
    pub status: String,
    pub error: Option<String>,
}

// ============================================================
// 代理检测
// ============================================================

fn detect_proxy() -> ProxyInfo {
    // 1. 检查环境变量（跨平台通用）
    for var in &[
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "http_proxy",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        if let Ok(val) = std::env::var(var) {
            if !val.is_empty() {
                return ProxyInfo {
                    enabled: true,
                    source: Some(format!("env:{}", var)),
                    address: Some(val),
                };
            }
        }
    }

    // 2. 系统代理检测（平台特定）
    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 netsh winhttp show proxy
        if let Ok(output) = Command::new("netsh").args(["winhttp", "show", "proxy"]).no_window().output() {
            let text = String::from_utf8_lossy(&output.stdout);
            // 输出格式:
            //   Proxy Server(s) :  proxy.example.com:8080
            //   Bypass List     :  (none)
            // 或:
            //   Direct Access (no proxy server).
            for line in text.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("Proxy Server(s)") && !trimmed.contains("Direct Access") {
                    // 提取 : 后面的地址
                    if let Some(addr) = trimmed.split(':').nth(1) {
                        let addr = addr.trim();
                        if !addr.is_empty() {
                            return ProxyInfo {
                                enabled: true,
                                source: Some("system:netsh".to_string()),
                                address: Some(format!("http://{}", addr)),
                            };
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS / Linux: 使用 scutil --proxy（macOS）
        if let Ok(output) = Command::new("scutil").arg("--proxy").output() {
            let text = String::from_utf8_lossy(&output.stdout);

            // 检查 HTTPEnable 或 HTTPSEnable : 1
            let http_enabled = text.lines().any(|line| {
                let trimmed = line.trim();
                (trimmed.starts_with("HTTPEnable") || trimmed.starts_with("HTTPSEnable"))
                    && trimmed.ends_with(": 1")
            });

            if http_enabled {
                // 提取代理地址和端口
                let mut proxy_host: Option<String> = None;
                let mut proxy_port: Option<String> = None;

                for line in text.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("HTTPProxy") || trimmed.starts_with("HTTPSProxy") {
                        if let Some(host) = trimmed.split(':').nth(1) {
                            proxy_host = Some(host.trim().to_string());
                        }
                    }
                    if trimmed.starts_with("HTTPPort") || trimmed.starts_with("HTTPSPort") {
                        if let Some(port) = trimmed.split(':').nth(1) {
                            proxy_port = Some(port.trim().to_string());
                        }
                    }
                }

                if let Some(host) = proxy_host {
                    let port = proxy_port.unwrap_or_else(|| "0".to_string());
                    return ProxyInfo {
                        enabled: true,
                        source: Some("system:scutil".to_string()),
                        address: Some(format!("http://{}:{}", host, port)),
                    };
                }
            }
        }
    }

    // 3. 无代理
    ProxyInfo {
        enabled: false,
        source: None,
        address: None,
    }
}

// ============================================================
// DNS 诊断
// ============================================================

fn run_dig(host: &str, proxy: &ProxyInfo) -> DnsResult {
    let start = Instant::now();

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用 nslookup
        let output = Command::new("nslookup")
            .arg(host)
            .no_window()
            .output();

        let elapsed = start.elapsed().as_millis() as u64;

        let output = match output {
            Ok(o) => o,
            Err(e) => {
                return DnsResult {
                    host: host.to_string(),
                    proxy: proxy.clone(),
                    server: None,
                    resolved_ips: vec![],
                    resolution_ms: Some(elapsed),
                    status: "error".to_string(),
                    error: Some(format!("Failed to run nslookup: {}", e)),
                };
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout);

        // 从 nslookup 输出提取 IPv4 地址
        // 格式: "Name:    host\nAddress:  1.2.3.4\nAliases:  ..."
        let resolved_ips: Vec<String> = stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter_map(|l| {
                // 匹配 Address: x.x.x.x 或 Addresses: x.x.x.x
                if l.starts_with("Address") {
                    let parts: Vec<&str> = l.split(':').collect();
                    if parts.len() >= 2 {
                        let ip = parts[1].trim();
                        let octets: Vec<&str> = ip.split('.').collect();
                        if octets.len() == 4 && octets.iter().all(|p| p.parse::<u8>().is_ok()) {
                            return Some(ip.to_string());
                        }
                    }
                }
                None
            })
            .collect();

        // 尝试提取 DNS 服务器
        let server = stdout
            .lines()
            .find(|l| l.trim().starts_with("Server:"))
            .and_then(|l| l.split(':').nth(1))
            .map(|s| s.trim().to_string())
            .or_else(|| Some("system".to_string()));

        if resolved_ips.is_empty() {
            return DnsResult {
                host: host.to_string(),
                proxy: proxy.clone(),
                server,
                resolved_ips: vec![],
                resolution_ms: Some(elapsed),
                status: "error".to_string(),
                error: Some("No A records found".to_string()),
            };
        }

        DnsResult {
            host: host.to_string(),
            proxy: proxy.clone(),
            server,
            resolved_ips,
            resolution_ms: Some(elapsed),
            status: "ok".to_string(),
            error: None,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // macOS / Linux: 使用 dig +short
        let output = Command::new("dig")
            .arg("+short")
            .arg(host)
            .output();

        let elapsed = start.elapsed().as_millis() as u64;

        let output = match output {
            Ok(o) => o,
            Err(e) => {
                return DnsResult {
                    host: host.to_string(),
                    proxy: proxy.clone(),
                    server: None,
                    resolved_ips: vec![],
                    resolution_ms: Some(elapsed),
                    status: "error".to_string(),
                    error: Some(format!("Failed to run dig: {}", e)),
                };
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return DnsResult {
                host: host.to_string(),
                proxy: proxy.clone(),
                server: None,
                resolved_ips: vec![],
                resolution_ms: Some(elapsed),
                status: "error".to_string(),
                error: Some(format!("dig failed: {}", stderr.trim())),
            };
        }

        let stdout = String::from_utf8_lossy(&output.stdout);

        // 从 dig +short 输出中过滤出 IPv4 地址
        let resolved_ips: Vec<String> = stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| {
                // 匹配 IPv4 格式：x.x.x.x
                let parts: Vec<&str> = l.split('.').collect();
                parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok())
            })
            .collect();

        // 提取 DNS 服务器信息（用 dig 不带 +short 获取太复杂，用 system 占位）
        let server = Some("system".to_string());

        if resolved_ips.is_empty() {
            return DnsResult {
                host: host.to_string(),
                proxy: proxy.clone(),
                server,
                resolved_ips: vec![],
                resolution_ms: Some(elapsed),
                status: "error".to_string(),
                error: Some("No A records found".to_string()),
            };
        }

        DnsResult {
            host: host.to_string(),
            proxy: proxy.clone(),
            server,
            resolved_ips,
            resolution_ms: Some(elapsed),
            status: "ok".to_string(),
            error: None,
        }
    }
}

#[command]
pub async fn diag_dns() -> Result<Vec<DnsResult>, String> {
    tokio::task::spawn_blocking(|| {
        let proxy = detect_proxy();
        let results: Vec<DnsResult> = DNS_HOSTS.iter().map(|h| run_dig(h, &proxy)).collect();
        Ok(results)
    })
    .await
    .map_err(|e| format!("DNS diagnostic task failed: {}", e))?
}

// ============================================================
// HTTP 诊断
// ============================================================

fn format_http_version(raw: &str) -> String {
    match raw.trim() {
        "2" => "HTTP/2".to_string(),
        "1.1" => "HTTP/1.1".to_string(),
        "1.0" => "HTTP/1.0".to_string(),
        "3" => "HTTP/3".to_string(),
        other => format!("HTTP/{}", other),
    }
}

fn run_curl_http(endpoint: &str, proxy: &ProxyInfo) -> HttpResult {
    // 跨平台 null device 路径
    #[cfg(target_os = "windows")]
    let null_device = "NUL";
    #[cfg(not(target_os = "windows"))]
    let null_device = "/dev/null";

    let write_format = "%{http_code}|%{http_version}|%{time_total}|%{content_type}";

    // Pass 1: 用 -w 获取 metrics
    let metrics_output = Command::new("curl")
        .arg("-s")
        .arg("-o")
        .arg(null_device)
        .arg("-w")
        .arg(write_format)
        .arg("--max-time")
        .arg("10")
        .arg(endpoint)
        .no_window()
        .output();

    let (status_code, http_version, response_time_ms, content_type) = match metrics_output {
        Ok(o) if o.status.success() => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            let parts: Vec<&str> = stdout.split('|').collect();
            if parts.len() >= 4 {
                let code = parts[0].trim().parse::<u16>().ok();
                let version = format_http_version(parts[1]);
                let time_total: f64 = parts[2].trim().parse().unwrap_or(0.0);
                let resp_ms = (time_total * 1000.0).round() as u64;
                let ctype = {
                    let ct = parts[3].trim();
                    if ct.is_empty() {
                        None
                    } else {
                        Some(ct.to_string())
                    }
                };
                (code, Some(version), Some(resp_ms), ctype)
            } else {
                (None, None, None, None)
            }
        }
        _ => (None, None, None, None),
    };

    // Pass 2: 用 -v 从 stderr 获取 TLS 版本和远端 IP
    let (tls_version, remote_ip) = {
        let verbose_output = Command::new("curl")
            .arg("-v")
            .arg("-s")
            .arg("-o")
            .arg(null_device)
            .arg("--max-time")
            .arg("10")
            .arg(endpoint)
            .no_window()
            .output();

        let mut tls = None;
        let mut ip = None;

        if let Ok(o) = verbose_output {
            let stderr = String::from_utf8_lossy(&o.stderr);
            for line in stderr.lines() {
                let trimmed = line.trim();
                // * SSL connection using TLSv1.3 / ...
                if trimmed.contains("SSL connection using") || trimmed.contains("SSL: ") {
                    // 尝试提取 TLSvX.Y
                    if let Some(pos) = trimmed.find("TLSv") {
                        let rest = &trimmed[pos..];
                        // TLSv1.3 后面可能有空格或 /
                        let end = rest
                            .find(|c: char| c == ' ' || c == '/' || c == '\n')
                            .unwrap_or(rest.len());
                        let version = &rest[..end];
                        if !version.is_empty() {
                            tls = Some(version.to_string());
                        }
                    }
                }
                // * Connected to center.qoder.sh (8.212.124.35) port 443
                if trimmed.starts_with("* Connected to") {
                    if let Some(start) = trimmed.rfind('(') {
                        if let Some(end) = trimmed.rfind(')') {
                            if start < end {
                                ip = Some(trimmed[start + 1..end].to_string());
                            }
                        }
                    }
                }
            }
        }

        (tls, ip)
    };

    // 判断成功/失败
    if status_code.is_none() {
        // curl 可能完全失败了
        let error_msg = if let Ok(o) = Command::new("curl")
            .arg("-s")
            .arg("-o")
            .arg(null_device)
            .arg("--max-time")
            .arg("10")
            .arg(endpoint)
            .no_window()
            .output()
        {
            if !o.status.success() {
                Some(String::from_utf8_lossy(&o.stderr).trim().to_string())
            } else {
                Some("Unknown error".to_string())
            }
        } else {
            Some("Failed to execute curl".to_string())
        };

        return HttpResult {
            endpoint: endpoint.to_string(),
            method: "GET".to_string(),
            proxy: proxy.clone(),
            status_code: None,
            http_version: None,
            tls_version,
            response_time_ms,
            content_type: None,
            remote_ip,
            status: "error".to_string(),
            error: error_msg,
        };
    }

    HttpResult {
        endpoint: endpoint.to_string(),
        method: "GET".to_string(),
        proxy: proxy.clone(),
        status_code,
        http_version,
        tls_version,
        response_time_ms,
        content_type,
        remote_ip,
        status: "ok".to_string(),
        error: None,
    }
}

#[command]
pub async fn diag_http() -> Result<Vec<HttpResult>, String> {
    tokio::task::spawn_blocking(|| {
        let proxy = detect_proxy();
        let results: Vec<HttpResult> = HTTP_ENDPOINTS
            .iter()
            .map(|e| run_curl_http(e, &proxy))
            .collect();
        Ok(results)
    })
    .await
    .map_err(|e| format!("HTTP diagnostic task failed: {}", e))?
}

// ============================================================
// Ping 诊断
// ============================================================

fn run_ping(target: &str, _proxy: &ProxyInfo) -> PingResult {
    // 跨平台 ping 参数差异
    #[cfg(target_os = "windows")]
    let output = Command::new("ping")
        .arg("-n")
        .arg("4")
        .arg(target)
        .no_window()
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("ping")
        .arg("-c")
        .arg("4")
        .arg(target)
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            return PingResult {
                target: target.to_string(),
                ip: None,
                packets_sent: None,
                packets_received: None,
                packet_loss_percent: None,
                rtt_min_ms: None,
                rtt_avg_ms: None,
                rtt_max_ms: None,
                status: "error".to_string(),
                error: Some(format!("Failed to run ping: {}", e)),
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // 解析 IP
    #[cfg(target_os = "windows")]
    let ip = {
        // Windows 格式: Pinging xxx [8.212.124.35] with 32 bytes of data:
        stdout
            .lines()
            .next()
            .and_then(|first_line| {
                if let Some(start) = first_line.rfind('[') {
                    if let Some(end) = first_line.rfind(']') {
                        if start < end {
                            return Some(first_line[start + 1..end].to_string());
                        }
                    }
                }
                None
            })
    };

    #[cfg(not(target_os = "windows"))]
    let ip = {
        // macOS/Linux 格式: PING xxx (8.212.124.35): 56 data bytes
        stdout
            .lines()
            .next()
            .and_then(|first_line| {
                if let Some(start) = first_line.rfind('(') {
                    if let Some(end) = first_line.rfind(')') {
                        if start < end {
                            return Some(first_line[start + 1..end].to_string());
                        }
                    }
                }
                None
            })
    };

    // 解析丢包统计
    #[cfg(target_os = "windows")]
    let (packets_sent, packets_received, packet_loss_percent) = {
        // Windows 格式: Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)
        let mut sent = None;
        let mut recv = None;
        let mut loss = None;

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Packets:") {
                // Sent = 4, Received = 4, Lost = 0 (0% loss)
                if let Some(val) = trimmed.split("Sent =").nth(1) {
                    let val = val.split(',').next().unwrap_or("").trim();
                    sent = val.parse::<u32>().ok();
                }
                if let Some(val) = trimmed.split("Received =").nth(1) {
                    let val = val.split(',').next().unwrap_or("").trim();
                    recv = val.parse::<u32>().ok();
                }
                // 提取 (X% loss) 中的 X
                if let Some(open_paren) = trimmed.find('(') {
                    if let Some(close_paren) = trimmed[open_paren..].find(')') {
                        let inner = &trimmed[open_paren + 1..open_paren + close_paren];
                        if let Some(pct_str) = inner.split('%').next() {
                            loss = pct_str.trim().parse::<f64>().ok();
                        }
                    }
                }
                break;
            }
        }
        (sent, recv, loss)
    };

    #[cfg(not(target_os = "windows"))]
    let (packets_sent, packets_received, packet_loss_percent) = {
        // macOS/Linux: 4 packets transmitted, 4 packets received, 0.0% packet loss
        let mut sent = None;
        let mut recv = None;
        let mut loss = None;

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.contains("packets transmitted") {
                // 尝试解析数字
                let parts: Vec<&str> = trimmed.split(',').collect();
                for part in parts {
                    let part = part.trim();
                    if part.ends_with("packets transmitted") {
                        // "4 packets transmitted"
                        if let Some(num_str) = part.split_whitespace().next() {
                            sent = num_str.parse::<u32>().ok();
                        }
                    }
                    if part.ends_with("packets received") {
                        if let Some(num_str) = part.split_whitespace().next() {
                            recv = num_str.parse::<u32>().ok();
                        }
                    }
                    if part.contains("packet loss") {
                        // "0.0% packet loss"
                        if let Some(pct_str) = part.split('%').next() {
                            if let Some(num) = pct_str.split_whitespace().last() {
                                loss = num.parse::<f64>().ok();
                            }
                        }
                    }
                }
                break;
            }
        }
        (sent, recv, loss)
    };

    // 解析 RTT
    #[cfg(target_os = "windows")]
    let (rtt_min, rtt_avg, rtt_max) = {
        // Windows 格式: Minimum = 33ms, Maximum = 35ms, Average = 34ms
        let mut min_val = None;
        let mut avg_val = None;
        let mut max_val = None;

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.contains("Minimum") && trimmed.contains("Maximum") {
                // Minimum = 33ms, Maximum = 35ms, Average = 34ms
                if let Some(val) = trimmed.split("Minimum =").nth(1) {
                    let val = val.split(',').next().unwrap_or("");
                    let val = val.trim_end_matches("ms").trim();
                    min_val = val.parse::<f64>().ok();
                }
                if let Some(val) = trimmed.split("Maximum =").nth(1) {
                    let val = val.split(',').next().unwrap_or("");
                    let val = val.trim_end_matches("ms").trim();
                    max_val = val.parse::<f64>().ok();
                }
                if let Some(val) = trimmed.split("Average =").nth(1) {
                    let val = val.split(',').next().unwrap_or("");
                    let val = val.trim_end_matches("ms").trim();
                    avg_val = val.parse::<f64>().ok();
                }
                break;
            }
        }
        (min_val, avg_val, max_val)
    };

    #[cfg(not(target_os = "windows"))]
    let (rtt_min, rtt_avg, rtt_max) = {
        // macOS: round-trip min/avg/max/stddev = 33.461/34.020/34.914/0.542 ms
        // Linux: rtt min/avg/max/mdev = ...
        let mut min_val = None;
        let mut avg_val = None;
        let mut max_val = None;

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.contains("round-trip") && trimmed.contains("=") {
                if let Some(rhs) = trimmed.split('=').nth(1) {
                    let rhs = rhs.trim().trim_end_matches("ms").trim();
                    let parts: Vec<&str> = rhs.split('/').collect();
                    if parts.len() >= 3 {
                        min_val = parts[0].parse::<f64>().ok();
                        avg_val = parts[1].parse::<f64>().ok();
                        max_val = parts[2].parse::<f64>().ok();
                    }
                }
                break;
            }
            // Linux 格式: rtt min/avg/max/mdev = ...
            if trimmed.contains("rtt") && trimmed.contains("=") {
                if let Some(rhs) = trimmed.split('=').nth(1) {
                    let rhs = rhs.trim().trim_end_matches("ms").trim();
                    let parts: Vec<&str> = rhs.split('/').collect();
                    if parts.len() >= 3 {
                        min_val = parts[0].parse::<f64>().ok();
                        avg_val = parts[1].parse::<f64>().ok();
                        max_val = parts[2].parse::<f64>().ok();
                    }
                }
                break;
            }
        }
        (min_val, avg_val, max_val)
    };

    // 即使 100% 丢包也视为 ok（ping 成功执行了），只是无 RTT 数据
    let has_stats = packets_sent.is_some() || packets_received.is_some();

    if !has_stats && ip.is_none() {
        // 完全无法解析输出
        let stderr = String::from_utf8_lossy(&output.stderr);
        return PingResult {
            target: target.to_string(),
            ip: None,
            packets_sent: None,
            packets_received: None,
            packet_loss_percent: None,
            rtt_min_ms: None,
            rtt_avg_ms: None,
            rtt_max_ms: None,
            status: "error".to_string(),
            error: Some(format!("Failed to parse ping output: {}", stderr.trim())),
        };
    }

    PingResult {
        target: target.to_string(),
        ip,
        packets_sent,
        packets_received,
        packet_loss_percent,
        rtt_min_ms: rtt_min,
        rtt_avg_ms: rtt_avg,
        rtt_max_ms: rtt_max,
        status: "ok".to_string(),
        error: None,
    }
}

#[command]
pub async fn diag_ping() -> Result<Vec<PingResult>, String> {
    tokio::task::spawn_blocking(|| {
        let proxy = detect_proxy();
        let results: Vec<PingResult> = PING_TARGETS
            .iter()
            .map(|t| run_ping(t, &proxy))
            .collect();
        Ok(results)
    })
    .await
    .map_err(|e| format!("Ping diagnostic task failed: {}", e))?
}

// ============================================================
// Marketplace 诊断
// ============================================================

#[command]
pub async fn diag_marketplace() -> Result<MarketplaceResult, String> {
    tokio::task::spawn_blocking(|| {
        let proxy = detect_proxy();
        let http = run_curl_http(MARKETPLACE_ENDPOINT, &proxy);

        let connection_ok = http.status_code.is_some();
        let api_available = http.status_code == Some(200);

        if http.status == "error" {
            return Ok(MarketplaceResult {
                endpoint: MARKETPLACE_ENDPOINT.to_string(),
                proxy: http.proxy.clone(),
                connection_ok: false,
                api_available: false,
                status_code: http.status_code,
                response_time_ms: http.response_time_ms,
                status: "error".to_string(),
                error: http.error,
            });
        }

        Ok(MarketplaceResult {
            endpoint: MARKETPLACE_ENDPOINT.to_string(),
            proxy: http.proxy.clone(),
            connection_ok,
            api_available,
            status_code: http.status_code,
            response_time_ms: http.response_time_ms,
            status: "ok".to_string(),
            error: None,
        })
    })
    .await
    .map_err(|e| format!("Marketplace diagnostic task failed: {}", e))?
}
