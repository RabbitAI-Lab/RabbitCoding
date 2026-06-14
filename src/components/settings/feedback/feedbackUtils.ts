import type { ConfigSummary, WebviewMetrics, ModelConfig, McpServerConfig, ProxyConfig } from '../../../types';

/**
 * 从 localStorage 读取并组装配置摘要（脱敏）
 * 不包含 API Key 和具体代理地址
 */
export function buildConfigSummary(): ConfigSummary {
  // 读取模型配置
  let models: ConfigSummary['models'] = [];
  try {
    const raw = localStorage.getItem('model-configs');
    if (raw) {
      const configs = JSON.parse(raw) as ModelConfig[];
      models = configs.map(c => ({
        name: c.name,
        provider: c.provider,
        modelId: c.modelId,
        baseUrl: c.baseUrl,
        enabled: c.enabled,
      }));
    }
  } catch { /* ignore */ }

  // 读取 MCP 服务配置（仅启用项）
  let enabledMcpServers: ConfigSummary['enabledMcpServers'] = [];
  try {
    const raw = localStorage.getItem('mcp-server-configs');
    if (raw) {
      const servers = JSON.parse(raw) as McpServerConfig[];
      enabledMcpServers = servers
        .filter(s => s.enabled)
        .map(s => ({
          name: s.name,
          serverType: s.type,
          enabled: s.enabled,
        }));
    }
  } catch { /* ignore */ }

  // 读取代理配置（仅状态标志，不含地址）
  let proxy: ConfigSummary['proxy'] = {
    enabled: false,
    hasHttpProxy: false,
    hasHttpsProxy: false,
    hasSocksProxy: false,
  };
  try {
    const raw = localStorage.getItem('proxy-config');
    if (raw) {
      const cfg = JSON.parse(raw) as ProxyConfig;
      proxy = {
        enabled: cfg.enabled,
        hasHttpProxy: !!cfg.httpProxy,
        hasHttpsProxy: !!cfg.httpsProxy,
        hasSocksProxy: !!cfg.socksProxy,
      };
    }
  } catch { /* ignore */ }

  return { models, enabledMcpServers, proxy };
}

/**
 * 通过 JS performance API 采集 WebView 性能指标
 */
export function collectWebviewMetrics(): WebviewMetrics {
  const domElements = document.querySelectorAll('*').length;

  // performance.memory 仅在 Chromium 内核可用
  const memory = (performance as any).memory;
  const jsHeapUsedMb = memory ? memory.usedJSHeapSize / 1024 / 1024 : 0;
  const jsHeapTotalMb = memory ? memory.totalJSHeapSize / 1024 / 1024 : 0;

  // 使用 Navigation Timing API
  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const timingDomCompleteMs = navEntry ? navEntry.domComplete : 0;

  return {
    domElements,
    jsHeapUsedMb: Math.round(jsHeapUsedMb * 100) / 100,
    jsHeapTotalMb: Math.round(jsHeapTotalMb * 100) / 100,
    timingDomCompleteMs: Math.round(timingDomCompleteMs * 100) / 100,
  };
}

/**
 * 邮箱格式校验
 */
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 从 data URL 中提取纯 base64 字符串
 */
export function stripDataUrl(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex >= 0 ? dataUrl.substring(commaIndex + 1) : dataUrl;
}

/**
 * 将 datetime-local 输入值转换为 ISO 8601 字符串
 */
export function toISOString(localValue: string): string {
  try {
    return new Date(localValue).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * 获取当前时间，格式化为 datetime-local 默认值
 */
export function nowDatetimeLocal(): string {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  const local = new Date(now.getTime() - tzOffset);
  return local.toISOString().slice(0, 16);
}
