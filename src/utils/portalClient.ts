/**
 * RabbitCodingPortal 客户端模块
 *
 * 封装与 Portal 后端的两类交互：
 * 1. 公开模型列表 GET /api/v1/models
 * 2. AI 转发 Key 获取 GET /api/me/api-key（需 Casdoor accessToken 鉴权）
 *
 * 密钥层级（严格区分）：
 * - Casdoor accessToken：用户登录获得，用于调 /api/me/* 接口（Header X-Casdoor-Token）
 * - AI 转发 Key：用 Casdoor accessToken 换取，用于鉴权 /anthropic/v1/* 转发接口（Header x-api-key）
 */

import type { ModelConfig } from '../types';

// ============================================================
// Portal origin
// ============================================================

/** dev 用本地 Portal，prod 用线上 */
export function getPortalOrigin(): string {
  return import.meta.env.DEV ? 'http://localhost:5173' : 'https://coding.rabbitai-lab.com';
}

/** anthropic 转发 baseUrl：sidecar 传给 Anthropic SDK 的 base_url */
export function getPortalAnthropicBaseUrl(): string {
  return `${getPortalOrigin()}/anthropic`;
}

// ============================================================
// 类型定义
// ============================================================

export interface OnlineModel {
  /** 模型标识符（如 claude-sonnet-4） */
  id: string;
  /** 展示名称 */
  displayName: string;
  /** 最大 tokens */
  maxTokens: number;
}

export interface AiForwardingKeyResult {
  /** 完整明文 key（仅 created:true 时有值） */
  key: string | null;
  id: number;
  keyPrefix: string;
  created: boolean;
}

/** AI 转发 Key 未返回（已存在但客户端未缓存）错误标记 */
export const AIKEY_NOT_RETURNED = 'AIKEY_NOT_RETURNED';
/** Casdoor accessToken 无效/过期错误标记 */
export const NOT_AUTHENTICATED = 'NOT_AUTHENTICATED';

// ============================================================
// fetch：公开模型列表
// ============================================================

/**
 * GET /api/v1/models（公开接口，无需鉴权）
 * 返回 Portal 活跃且有可用账号的模型列表
 */
export async function fetchOnlineModels(): Promise<OnlineModel[]> {
  const origin = getPortalOrigin();
  const url = `${origin}/api/v1/models`;
  console.debug('[portalClient] fetchOnlineModels:', url);

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`fetchOnlineModels failed: ${resp.status} ${text}`);
  }

  const json = await resp.json();
  const data: unknown = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  return (data as Array<Record<string, unknown>>).map((m) => ({
    id: String(m.id ?? ''),
    displayName: String(m.display_name ?? m.id ?? ''),
    maxTokens: typeof m.max_tokens === 'number' ? m.max_tokens : 0,
  }));
}

// ============================================================
// fetch：AI 转发 Key（用 Casdoor accessToken 换取）
// ============================================================

/**
 * GET /api/me/api-key
 *
 * 用 Casdoor accessToken 调用，获取（或首次创建）AI 转发 Key。
 * - created:true → key 返回完整明文（首次创建）
 * - created:false → key 为 null（已存在，客户端应使用首次缓存的完整 key）
 *
 * @param casdoorToken 用户登录后的 Casdoor accessToken
 */
export async function fetchAiForwardingKey(casdoorToken: string): Promise<AiForwardingKeyResult> {
  const origin = getPortalOrigin();
  const url = `${origin}/api/me/api-key`;
  console.debug('[portalClient] fetchAiForwardingKey:', url);

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Casdoor-Token': casdoorToken,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    const err = new Error(`fetchAiForwardingKey failed: ${resp.status} ${text}`);
    // 401 = Casdoor accessToken 无效或过期 → 调用方应弹出重新登录引导
    if (resp.status === 401) {
      (err as Error & { code?: string }).code = NOT_AUTHENTICATED;
    }
    throw err;
  }

  const json = (await resp.json()) as AiForwardingKeyResult;

  if (!json.key) {
    // key 已存在但未返回明文 → 调用方需提示用户重新登录或重置
    const err = new Error('AI forwarding key already exists but plaintext not returned');
    (err as Error & { code?: string }).code = AIKEY_NOT_RETURNED;
    throw err;
  }

  return json;
}

// ============================================================
// 构造虚拟 ModelConfig（线上模型）
// ============================================================

/** 线上模型 ID 前缀 */
export const ONLINE_MODEL_PREFIX = '__online__:';

/** 判断是否为线上虚拟模型 ID */
export function isOnlineModelId(id: string): boolean {
  return id.startsWith(ONLINE_MODEL_PREFIX);
}

/** 从线上虚拟模型 ID 提取原始 modelId */
export function extractModelIdFromOnline(onlineId: string): string {
  return onlineId.slice(ONLINE_MODEL_PREFIX.length);
}

/**
 * 构造线上模型的虚拟 ModelConfig
 *
 * 选中线上模型后，运行时派生一个虚拟配置，无缝复用现有 sidecar 流程。
 * baseUrl 指向 Portal anthropic 转发，apiKey 为 AI 转发 Key。
 */
export function buildOnlineModelConfig(model: OnlineModel, aiForwardingKey: string): ModelConfig {
  return {
    id: `${ONLINE_MODEL_PREFIX}${model.id}`,
    name: model.displayName || model.id,
    provider: 'anthropic',
    modelId: model.id,
    baseUrl: getPortalAnthropicBaseUrl(),
    apiKey: aiForwardingKey,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    envVars: {},
    enabled: true,
    createdAt: 0,
    maxContextTokens: model.maxTokens || 200000,
  };
}
