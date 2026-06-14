/**
 * useUsage Hook
 *
 * 从所有 workspaces 的 rabbits 中聚合 Token 用量、对话次数、费用等统计。
 */

import { useMemo } from 'react';
import type { Workspace, TokenUsage } from '../types';

export interface UsageStats {
  /** 总对话次数 = 有 result 消息的 rabbit 数量 */
  totalConversations: number;
  /** 总轮次数（所有 rabbit 的 numTurns 之和） */
  totalTurns: number;
  /** 累计 Token 用量 */
  totalTokens: TokenUsage;
  /** 总花费（美元） */
  totalCostUsd: number;
  /** 总时长（毫秒） */
  totalDurationMs: number;
}

/**
 * 从所有 workspaces 的 rabbits 中聚合 Token 用量统计
 */
export function useUsage(workspaces: Workspace[]): UsageStats {
  return useMemo(() => {
    let totalConversations = 0;
    let totalTurns = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationInputTokens = 0;
    let cacheReadInputTokens = 0;
    let totalCostUsd = 0;
    let totalDurationMs = 0;

    for (const ws of workspaces) {
      for (const rabbit of ws.rabbits ?? []) {
        // 有 result 消息 = 完成了至少一次对话
        const hasResult = rabbit.messages?.some(m => m.type === 'result');
        if (hasResult) {
          totalConversations++;
        }

        // 累加 token
        const usage = rabbit.tokenUsage;
        if (usage) {
          inputTokens += usage.inputTokens ?? 0;
          outputTokens += usage.outputTokens ?? 0;
          cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0;
          cacheReadInputTokens += usage.cacheReadInputTokens ?? 0;
        }

        totalTurns += rabbit.numTurns ?? 0;
        totalCostUsd += rabbit.costUsd ?? 0;
        totalDurationMs += rabbit.durationMs ?? 0;
      }
    }

    return {
      totalConversations,
      totalTurns,
      totalTokens: {
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      },
      totalCostUsd,
      totalDurationMs,
    };
  }, [workspaces]);
}

/** 格式化 Token 数量（如 1.2K, 3.5M） */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 格式化时长（如 2m 30s） */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}m ${sec}s`;
  return `${sec}s`;
}
