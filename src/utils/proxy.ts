import type { ProxyConfig } from '../types';

/** ProxyConfig 默认值 */
export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  enabled: false,
  httpProxy: '',
  httpsProxy: '',
  socksProxy: '',
  noProxy: 'localhost,127.0.0.1',
};

/**
 * 将 ProxyConfig 转换为环境变量键值对
 * 仅在 enabled=true 且对应字段非空时生成
 * 同时设置大写和小写变量以保证兼容性
 */
export function proxyConfigToEnvVars(config: ProxyConfig): Record<string, string> {
  if (!config.enabled) return {};

  const envVars: Record<string, string> = {};

  const http = config.httpProxy.trim();
  if (http) {
    envVars['HTTP_PROXY'] = http;
    envVars['http_proxy'] = http;
  }

  const https = config.httpsProxy.trim();
  if (https) {
    envVars['HTTPS_PROXY'] = https;
    envVars['https_proxy'] = https;
  }

  const socks = config.socksProxy.trim();
  if (socks) {
    envVars['ALL_PROXY'] = socks;
    envVars['all_proxy'] = socks;
  }

  const noProxy = config.noProxy.trim();
  if (noProxy) {
    envVars['NO_PROXY'] = noProxy;
    envVars['no_proxy'] = noProxy;
  }

  return envVars;
}

/**
 * 生成 ProxyConfig 的指纹（用于检测变更）
 * 返回一个字符串，配置变化时字符串变化
 */
export function proxyConfigFingerprint(config: ProxyConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    httpProxy: config.httpProxy.trim(),
    httpsProxy: config.httpsProxy.trim(),
    socksProxy: config.socksProxy.trim(),
    noProxy: config.noProxy.trim(),
  });
}
