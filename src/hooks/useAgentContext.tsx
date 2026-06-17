/**
 * AgentProvider Context
 *
 * 将 useAgent 的 listener 和 onMessage 回调提升到 App 层级，
 * 确保页面切换时不会因组件卸载而丢失流式消息。
 *
 * 参考 CodebaseIndexProvider 的模式。
 */

import { createContext, useContext, useCallback, useRef, type ReactNode } from 'react';
import { useAgent } from './useAgent';
import { notifyTaskResult } from '../utils/notify';
import type { useWorkspaces } from './useWorkspaces';
import type {
  AgentMessage,
  AgentQueryOptions,
  AssistantTextDeltaMessage,
  AssistantThinkingDeltaMessage,
  SidecarStatus,
} from '../types';

// ============================================================
// 类型定义
// ============================================================

interface StartSidecarOptions {
  apiKey: string;
  baseUrl?: string;
  envVars?: Record<string, string>;
}

interface AgentContextValue {
  sidecarStatus: SidecarStatus;
  startSidecar: (opts: StartSidecarOptions) => Promise<void>;
  stopSidecar: () => Promise<void>;
  checkStatus: () => Promise<boolean>;
  startQuery: (
    queryId: string,
    prompt: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => Promise<void>;
  resumeQuery: (
    queryId: string,
    sessionId: string,
    prompt: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => Promise<void>;
  /** 取消查询：同时标记为已取消（过滤后续 sidecar 消息）+ 发送取消命令 */
  cancelQuery: (queryId: string) => Promise<void>;
  /** 手动触发会话压缩 */
  compactQuery: (
    queryId: string,
    sessionId: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => Promise<void>;
  /** 响应 AskUserQuestion 提问 */
  respondToQuestion: (
    queryId: string,
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ) => Promise<void>;
  /** 取消 AskUserQuestion 提问 */
  cancelQuestion: (
    queryId: string,
    requestId: string,
  ) => Promise<void>;
}

// ============================================================
// Context
// ============================================================

const AgentContext = createContext<AgentContextValue | null>(null);

// ============================================================
// Provider
// ============================================================

interface AgentProviderProps {
  store: ReturnType<typeof useWorkspaces>;
  children: ReactNode;
}

export function AgentProvider({ store, children }: AgentProviderProps) {
  // 记录已取消的查询 ID，过滤 sidecar 后续消息
  const cancelledQueryIdsRef = useRef<Set<string>>(new Set());

  const agent = useAgent({
    onMessage: (queryId: string, message: AgentMessage) => {
      // 跳过 Spec 生成查询的消息（__spec__ 前缀的 queryId）
      if (queryId.startsWith('__spec__')) return;
      // 忽略已取消查询的所有后续消息（sidecar 可能发送多条 result/error）
      if (cancelledQueryIdsRef.current.has(queryId)) {
        return;
      }
      // queryId 就是 rabbitId
      const ws = store.workspaces.find(w => w.rabbits.some(r => r.id === queryId));
      if (!ws) return;

      switch (message.type) {
        case 'system':
          if (message.subtype === 'init') {
            store.updateRabbitAgent(ws.id, queryId, {
              sessionId: message.sessionId,
              status: 'running',
            });
          }
          break;
        case 'assistant':
          if (message.subtype === 'text_delta' || message.subtype === 'thinking_delta') {
            // 流式增量：追加到最后一条同类型消息
            store.appendDeltaToLastMessage(ws.id, queryId, message as AssistantTextDeltaMessage | AssistantThinkingDeltaMessage);
            store.updateRabbitAgent(ws.id, queryId, { status: 'running' });
          } else if (message.subtype === 'thinking_done') {
            // 思考结束：更新 durationMs
            store.updateThinkingDuration(ws.id, queryId, (message as any).durationMs);
          } else if (message.subtype === 'text_done') {
            // 流式结束信号：不需要额外处理
          } else {
            // text, thinking, tool_use 等完整消息
            store.appendRabbitMessage(ws.id, queryId, message);
            store.updateRabbitAgent(ws.id, queryId, { status: 'running' });
          }
          break;
        case 'tool_result':
          store.appendRabbitMessage(ws.id, queryId, message);
          break;
        case 'result':
          store.updateRabbitAgent(ws.id, queryId, {
            status: message.subtype === 'success' ? 'completed' : 'error',
            costUsd: message.totalCostUsd,
            durationMs: message.durationMs,
            error: message.error,
            tokenUsage: message.usage,
            numTurns: message.numTurns,
          });
          store.appendRabbitMessage(ws.id, queryId, message);
          {
            const rabbit = ws.rabbits.find(r => r.id === queryId);
            void notifyTaskResult(message.subtype === 'success', rabbit?.title);
          }
          break;
        case 'error':
          store.appendRabbitMessage(ws.id, queryId, message);
          store.updateRabbitAgent(ws.id, queryId, { status: 'error', error: message.message });
          break;
        case 'compaction': {
          // 更新压缩阶段状态；仅 'compacting' 和 'failed' 需要更新（done 已由 compaction_result 处理）
          const compMsg = message as import('../types').CompactionStatusMessage;
          if (compMsg.phase === 'compacting') {
            store.updateRabbitAgent(ws.id, queryId, { compactionPhase: 'compacting' });
          } else if (compMsg.phase === 'failed') {
            store.updateRabbitAgent(ws.id, queryId, { compactionPhase: 'failed' });
          }
          break;
        }
        case 'compaction_result': {
          // 将压缩结果作为消息追加到聊天流，并更新压缩阶段为 done
          const resultMsg = message as import('../types').CompactionResultMessage;
          store.appendRabbitMessage(ws.id, queryId, resultMsg);
          store.updateRabbitAgent(ws.id, queryId, { compactionPhase: 'done' });
          break;
        }
        case 'ask_user_question': {
          store.appendRabbitMessage(ws.id, queryId, message);
          break;
        }
        case 'usage_update': {
          // 实时更新当前 turn 的上下文占用（覆盖式更新）
          const usageMsg = message as import('../types').UsageUpdateMessage;
          store.updateRabbitAgent(ws.id, queryId, { currentUsage: usageMsg.usage });
          break;
        }
      }
    },
    onSidecarExit: (reason: string) => {
      // sidecar 进程退出：所有运行中的 query 都不可能再收到终态消息，统一收敛为 error，避免 UI 永久 loading
      store.resetAllRunningRabbits('error', `会话进程异常退出：${reason}`);
    },
    onQueryTimeout: (queryId: string) => {
      // 看门狗触发：某条 query 长时间无任何 sidecar 消息，判定为静默卡死
      const ws = store.workspaces.find(w => w.rabbits.some(r => r.id === queryId));
      if (!ws) return;
      store.updateRabbitAgent(ws.id, queryId, {
        status: 'error',
        error: '会话长时间无响应（超过 10 分钟未收到消息），已自动终止',
      });
    },
  });

  // 包装 cancelQuery：先标记再发送，延迟清理防止内存泄漏
  const cancelQuery = useCallback(async (queryId: string) => {
    cancelledQueryIdsRef.current.add(queryId);
    // 30 秒后移除标记，足够过滤所有 sidecar 后续消息
    setTimeout(() => cancelledQueryIdsRef.current.delete(queryId), 30_000);
    await agent.cancelQuery(queryId);
  }, [agent]);

  // 启动/恢复查询失败时，回滚对应 rabbit 状态为 error，避免 status 永久卡在 running
  // （调用方在发起查询前已将 status 置为 running，此处兜底收敛失败路径）
  const rollbackQueryToError = useCallback((queryId: string, err: unknown) => {
    const ws = store.workspaces.find(w => w.rabbits.some(r => r.id === queryId));
    if (!ws) return;
    store.updateRabbitAgent(ws.id, queryId, {
      status: 'error',
      error: `查询启动失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }, [store]);

  // 包装 startQuery：invoke 失败则回滚 status
  const startQuery = useCallback(async (
    queryId: string,
    prompt: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => {
    try {
      await agent.startQuery(queryId, prompt, cwd, agentOptions);
    } catch (err) {
      rollbackQueryToError(queryId, err);
    }
  }, [agent, rollbackQueryToError]);

  // 包装 resumeQuery：invoke 失败则回滚 status
  const resumeQuery = useCallback(async (
    queryId: string,
    sessionId: string,
    prompt: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => {
    try {
      await agent.resumeQuery(queryId, sessionId, prompt, cwd, agentOptions);
    } catch (err) {
      rollbackQueryToError(queryId, err);
    }
  }, [agent, rollbackQueryToError]);

  // 响应 AskUserQuestion 提问
  const respondToQuestion = useCallback(async (
    queryId: string,
    requestId: string,
    answers: Record<string, string>,
    response?: string,
  ) => {
    // 先更新前端状态为已回答
    const ws = store.workspaces.find(w => w.rabbits.some(r => r.id === queryId));
    if (ws) {
      store.updateAskUserQuestionStatus(ws.id, queryId, requestId, true, answers);
    }
    // 发送回复命令到 sidecar
    await agent.respondToolRequest(requestId, answers, response, false);
  }, [agent, store]);

  // 取消 AskUserQuestion 提问
  const cancelQuestion = useCallback(async (
    queryId: string,
    requestId: string,
  ) => {
    const ws = store.workspaces.find(w => w.rabbits.some(r => r.id === queryId));
    if (ws) {
      store.updateAskUserQuestionStatus(ws.id, queryId, requestId, true, {});
    }
    await agent.respondToolRequest(requestId, {}, undefined, true);
  }, [agent, store]);

  const value: AgentContextValue = {
    sidecarStatus: agent.sidecarStatus,
    startSidecar: agent.startSidecar,
    stopSidecar: agent.stopSidecar,
    checkStatus: agent.checkStatus,
    startQuery,
    resumeQuery,
    cancelQuery,
    compactQuery: agent.compactQuery,
    respondToQuestion,
    cancelQuestion,
  };

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

// ============================================================
// 消费 Hook
// ============================================================

export function useAgentContext(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) {
    throw new Error('useAgentContext must be used within AgentProvider');
  }
  return ctx;
}
