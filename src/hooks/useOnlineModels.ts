/**
 * useOnlineModels — 线上模型管理 hook
 *
 * 职责：
 * 1. 拉取 Portal 公开模型列表（onlineModels）
 * 2. 管理 AI 转发 Key 的缓存与按需获取（用 Casdoor accessToken 换取）
 *
 * 密钥说明：
 * - Casdoor accessToken 来自 useAuth（用户登录），用于调 Portal /api/me/* 接口
 * - AI 转发 Key 由本 hook 缓存，作为虚拟 ModelConfig 的 apiKey 传给 sidecar
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchOnlineModels,
  fetchAiForwardingKey,
  type OnlineModel,
  AIKEY_NOT_RETURNED,
  PORTAL_ENV_CHANGE_EVENT,
} from '../utils/portalClient';
import { useAuth } from './useAuth';

// localStorage keys
const AI_FORWARDING_KEY_STORAGE = 'ai-forwarding-key';
const AI_FORWARDING_KEY_PREFIX_STORAGE = 'ai-forwarding-key-prefix';

// 模型列表简易缓存：避免短时间内重复请求（30s）
const MODELS_CACHE_TTL_MS = 30_000;
let modelsCache: { models: OnlineModel[]; ts: number } | null = null;

/** 清空模型列表缓存（origin 切换等场景调用） */
export function clearModelsCache(): void {
  modelsCache = null;
}

export function useOnlineModels() {
  const { user } = useAuth();
  const casdoorToken = user?.accessToken;

  const [onlineModels, setOnlineModels] = useState<OnlineModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiForwardingKey, setAiForwardingKey] = useState<string>(
    () => localStorage.getItem(AI_FORWARDING_KEY_STORAGE) || '',
  );

  const fetchingModelsRef = useRef(false);
  const fetchingKeyRef = useRef(false);

  // ============================================================
  // 拉取模型列表
  // ============================================================
  const refreshModels = useCallback(async (force = false) => {
    // 命中缓存且未强制刷新 → 跳过
    if (!force && modelsCache && Date.now() - modelsCache.ts < MODELS_CACHE_TTL_MS) {
      setOnlineModels(modelsCache.models);
      return;
    }
    if (fetchingModelsRef.current) return;
    fetchingModelsRef.current = true;
    setLoading(true);
    try {
      const models = await fetchOnlineModels();
      modelsCache = { models, ts: Date.now() };
      setOnlineModels(models);
      console.debug('[useOnlineModels] models loaded:', models.length);
    } catch (err) {
      console.error('[useOnlineModels] refreshModels failed:', err);
    } finally {
      setLoading(false);
      fetchingModelsRef.current = false;
    }
  }, []);

  // ============================================================
  // 获取 AI 转发 Key（按需，用 Casdoor accessToken 换取）
  // ============================================================
  const ensureAiForwardingKey = useCallback(async (): Promise<string> => {
    // 已缓存直接返回
    const cached = localStorage.getItem(AI_FORWARDING_KEY_STORAGE) || '';
    if (cached) return cached;

    if (!casdoorToken) {
      throw new Error('NOT_LOGGED_IN');
    }
    if (fetchingKeyRef.current) {
      throw new Error('IN_PROGRESS');
    }
    fetchingKeyRef.current = true;
    try {
      const result = await fetchAiForwardingKey(casdoorToken);
      localStorage.setItem(AI_FORWARDING_KEY_STORAGE, result.key!);
      localStorage.setItem(AI_FORWARDING_KEY_PREFIX_STORAGE, result.keyPrefix);
      setAiForwardingKey(result.key!);
      console.debug('[useOnlineModels] AI forwarding key acquired (created:', result.created, ')');
      return result.key!;
    } catch (err) {
      const code = (err as Error & { code?: string }).code;
      if (code === AIKEY_NOT_RETURNED) {
        // Key 已存在但客户端未缓存 → 清掉旧值并提示需重新登录获取
        console.warn('[useOnlineModels] AI forwarding key exists but not returned, need re-login');
      }
      throw err;
    } finally {
      fetchingKeyRef.current = false;
    }
  }, [casdoorToken]);

  // ============================================================
  // 清除缓存的 AI 转发 Key（登出时调用）
  // ============================================================
  const clearAiForwardingKey = useCallback(() => {
    localStorage.removeItem(AI_FORWARDING_KEY_STORAGE);
    localStorage.removeItem(AI_FORWARDING_KEY_PREFIX_STORAGE);
    setAiForwardingKey('');
    console.debug('[useOnlineModels] AI forwarding key cleared');
  }, []);

  // 组件挂载时自动拉取一次模型列表
  useEffect(() => {
    void refreshModels();
  }, [refreshModels]);

  // 监听 Portal origin 切换：清除密钥与模型缓存后强制重新拉取
  useEffect(() => {
    const handler = () => {
      // 两套环境的 AI 转发 Key 不通用，必须清除重取
      clearAiForwardingKey();
      clearModelsCache();
      void refreshModels(true);
    };
    window.addEventListener(PORTAL_ENV_CHANGE_EVENT, handler);
    return () => window.removeEventListener(PORTAL_ENV_CHANGE_EVENT, handler);
  }, [clearAiForwardingKey, refreshModels]);

  return {
    onlineModels,
    loading,
    refreshModels,
    aiForwardingKey,
    ensureAiForwardingKey,
    clearAiForwardingKey,
    isLoggedIn: !!casdoorToken,
  };
}
