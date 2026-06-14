/**
 * useAgentConfigs Hook
 *
 * 管理智能体配置的增删改查，数据持久化到 localStorage('agent-configs')。
 */

import { useCallback } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { generateId } from '../utils/id';
import { BUILTIN_AGENT_META, createDefaultBuiltinAgent, createDefaultScopeConfig, createDefaultCustomAgent } from '../components/settings/agents/agentConstants';
import type {
  AgentScopeConfig,
  BuiltinAgentConfig,
  CustomAgentConfig,
} from '../types';

export function useAgentConfigs() {
  const [configs, setConfigs] = useLocalStorage<Record<string, AgentScopeConfig>>('agent-configs', {});

  /**
   * 读取某个 scope 的配置。
   * 不存在时返回默认配置（不写入 localStorage）。
   * 旧数据兼容：如果内置角色不齐全，自动补全。
   */
  const getScopeConfig = useCallback((scope: string): AgentScopeConfig => {
    const existing = configs[scope];
    if (!existing) {
      return createDefaultScopeConfig(scope);
    }
    // 容错：补全缺失的内置角色
    const existingRoles = new Set(existing.builtinAgents.map((a) => a.role));
    const missing = BUILTIN_AGENT_META.filter((m) => !existingRoles.has(m.role));
    if (missing.length === 0) return existing;
    return {
      ...existing,
      builtinAgents: [...existing.builtinAgents, ...missing.map((m) => createDefaultBuiltinAgent(m.role))],
    };
  }, [configs]);

  /** 确保 scope 存在（如果不存在则写入默认值），返回写入后的 configs */
  const ensureScope = useCallback((
    prev: Record<string, AgentScopeConfig>,
    scope: string,
  ): Record<string, AgentScopeConfig> => {
    if (prev[scope]) return prev;
    return { ...prev, [scope]: createDefaultScopeConfig(scope) };
  }, []);

  /** 更新内置子智能体（按 role 匹配） */
  const updateBuiltinAgent = useCallback((scope: string, updated: BuiltinAgentConfig) => {
    setConfigs((prev) => {
      const ensured = ensureScope(prev, scope);
      const scopeConfig = ensured[scope];
      return {
        ...ensured,
        [scope]: {
          ...scopeConfig,
          builtinAgents: scopeConfig.builtinAgents.map((a) =>
            a.role === updated.role ? updated : a,
          ),
        },
      };
    });
  }, [setConfigs, ensureScope]);

  /** 新增自定义智能体，返回新 id */
  const addCustomAgent = useCallback((scope: string): string => {
    const id = generateId();
    const defaults = createDefaultCustomAgent();
    setConfigs((prev) => {
      const ensured = ensureScope(prev, scope);
      const scopeConfig = ensured[scope];
      const newAgent: CustomAgentConfig = {
        ...defaults,
        id,
        createdAt: Date.now(),
      };
      return {
        ...ensured,
        [scope]: {
          ...scopeConfig,
          customAgents: [...scopeConfig.customAgents, newAgent],
        },
      };
    });
    return id;
  }, [setConfigs, ensureScope]);

  /** 更新自定义智能体（按 id 匹配） */
  const updateCustomAgent = useCallback((scope: string, updated: CustomAgentConfig) => {
    setConfigs((prev) => {
      const ensured = ensureScope(prev, scope);
      const scopeConfig = ensured[scope];
      return {
        ...ensured,
        [scope]: {
          ...scopeConfig,
          customAgents: scopeConfig.customAgents.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      };
    });
  }, [setConfigs, ensureScope]);

  /** 删除自定义智能体（按 id 匹配） */
  const deleteCustomAgent = useCallback((scope: string, agentId: string) => {
    setConfigs((prev) => {
      const ensured = ensureScope(prev, scope);
      const scopeConfig = ensured[scope];
      return {
        ...ensured,
        [scope]: {
          ...scopeConfig,
          customAgents: scopeConfig.customAgents.filter((a) => a.id !== agentId),
        },
      };
    });
  }, [setConfigs, ensureScope]);

  return {
    configs,
    getScopeConfig,
    updateBuiltinAgent,
    addCustomAgent,
    updateCustomAgent,
    deleteCustomAgent,
  };
}
