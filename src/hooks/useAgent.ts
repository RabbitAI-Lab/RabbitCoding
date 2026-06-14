/**
 * useAgent Hook
 *
 * 管理与 Claude Agent SDK Sidecar 的通信。
 * 通过 Tauri Commands 发送命令，通过 Tauri Events 接收流式消息。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  AgentEvent,
  AgentEventPayload,
  AgentMessage,
  AgentQueryOptions,
  SidecarStatus,
} from '../types';

interface UseAgentOptions {
  onMessage?: (queryId: string, message: AgentMessage) => void;
  onSidecarExit?: (reason: string) => void;
}

/** startSidecar 参数 */
interface StartSidecarOptions {
  apiKey: string;
  baseUrl?: string;
  envVars?: Record<string, string>;
}

export function useAgent(options?: UseAgentOptions) {
  const [sidecarStatus, setSidecarStatus] = useState<SidecarStatus>('stopped');
  const statusRef = useRef(sidecarStatus);
  statusRef.current = sidecarStatus;

  // 用 ref 存回调，避免 useEffect 因 options 引用变化重复注册 listener
  const onMessageRef = useRef(options?.onMessage);
  onMessageRef.current = options?.onMessage;
  const onSidecarExitRef = useRef(options?.onSidecarExit);
  onSidecarExitRef.current = options?.onSidecarExit;

  /**
   * 启动 Sidecar 进程
   */
  const startSidecar = useCallback(async (opts: StartSidecarOptions) => {
    setSidecarStatus('starting');
    try {
      const result = await invoke<{ success: boolean; error?: string }>('start_sidecar', {
        payload: {
          api_key: opts.apiKey,
          base_url: opts.baseUrl,
          env_vars: opts.envVars,
        },
      });
      if (result.success) {
        setSidecarStatus('running');
      } else {
        setSidecarStatus('error');
        throw new Error(result.error ?? 'Failed to start sidecar');
      }
    } catch (err) {
      setSidecarStatus('error');
      throw err;
    }
  }, []);

  /**
   * 停止 Sidecar 进程
   */
  const stopSidecar = useCallback(async () => {
    try {
      await invoke('stop_sidecar');
    } finally {
      setSidecarStatus('stopped');
    }
  }, []);

  /**
   * 获取 Sidecar 状态
   */
  const checkStatus = useCallback(async () => {
    try {
      const result = await invoke<{ running: boolean }>('get_sidecar_status');
      setSidecarStatus(result.running ? 'running' : 'stopped');
      return result.running;
    } catch {
      setSidecarStatus('error');
      return false;
    }
  }, []);

  /**
   * 发送启动查询命令到 Sidecar
   */
  const startQuery = useCallback(async (
    queryId: string,
    prompt: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => {
    const command = {
      type: 'start_query',
      id: queryId,
      prompt,
      cwd,
      options: {
        model: agentOptions.model,
        allowedTools: agentOptions.allowedTools,
        permissionMode: agentOptions.permissionMode,
        maxTurns: agentOptions.maxTurns,
        maxBudgetUsd: agentOptions.maxBudgetUsd,
      },
    };
    await invoke('send_to_sidecar', { payload: { message: JSON.stringify(command) } });
  }, []);

  /**
   * 恢复已有会话
   */
  const resumeQuery = useCallback(async (
    queryId: string,
    sessionId: string,
    prompt: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => {
    const command = {
      type: 'resume_query',
      id: queryId,
      sessionId,
      prompt,
      cwd,
      options: {
        model: agentOptions.model,
        allowedTools: agentOptions.allowedTools,
        permissionMode: agentOptions.permissionMode,
        maxTurns: agentOptions.maxTurns,
        maxBudgetUsd: agentOptions.maxBudgetUsd,
      },
    };
    await invoke('send_to_sidecar', { payload: { message: JSON.stringify(command) } });
  }, []);

  /**
   * 取消查询
   */
  const cancelQuery = useCallback(async (queryId: string) => {
    const command = { type: 'cancel_query', id: queryId };
    await invoke('send_to_sidecar', { payload: { message: JSON.stringify(command) } });
  }, []);

  /**
   * 手动触发会话压缩
   * 通过发送 /compact prompt 恢复会话，SDK 会自动触发压缩
   */
  const compactQuery = useCallback(async (
    queryId: string,
    sessionId: string,
    cwd: string,
    agentOptions: AgentQueryOptions,
  ) => {
    const command = {
      type: 'compact_query',
      id: queryId,
      sessionId,
      cwd,
      options: {
        model: agentOptions.model,
        allowedTools: agentOptions.allowedTools,
        permissionMode: agentOptions.permissionMode,
        maxTurns: agentOptions.maxTurns,
        maxBudgetUsd: agentOptions.maxBudgetUsd,
      },
    };
    await invoke('send_to_sidecar', { payload: { message: JSON.stringify(command) } });
  }, []);

  /**
   * 响应 AskUserQuestion 提问
   */
  const respondToolRequest = useCallback(async (
    requestId: string,
    answers: Record<string, string>,
    response?: string,
    cancelled?: boolean,
  ) => {
    const command = { type: 'respond_tool_request', requestId, answers, response, cancelled };
    await invoke('send_to_sidecar', { payload: { message: JSON.stringify(command) } });
  }, []);

  /**
   * 监听 Agent 消息事件（通过 ref 调用最新回调）
   * 使用 cancelled 标志防止 StrictMode async 竞态导致 listener 泄漏
   */
  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      const [unlistenMsg, unlistenExit] = await Promise.all([
        listen<AgentEventPayload>('agent:message', (event) => {
          try {
            const agentEvent: AgentEvent = JSON.parse(event.payload.data);
            const { queryId, payload } = agentEvent;
            onMessageRef.current?.(queryId, payload);
          } catch (err) {
            console.error('[useAgent] Failed to parse agent message:', err);
          }
        }),
        listen<{ reason: string }>('agent:sidecar-exit', (event) => {
          setSidecarStatus('stopped');
          onSidecarExitRef.current?.(event.payload.reason);
        }),
      ]);

      // 如果组件在 await 期间被卸载（StrictMode 会触发），立即清理
      if (cancelled) {
        unlistenMsg();
        unlistenExit();
        return;
      }

      // 存储 unlisten 到闭包，供 cleanup 使用
      // 由于 React 保证 cleanup 在下一次 effect 前同步调用，
      // 而我们已经在 cancelled 检查后才赋值，所以这里安全
      cleanupFns.push(unlistenMsg, unlistenExit);
    };

    const cleanupFns: (() => void)[] = [];
    setup();

    return () => {
      cancelled = true;
      cleanupFns.forEach(fn => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    sidecarStatus,
    startSidecar,
    stopSidecar,
    checkStatus,
    startQuery,
    resumeQuery,
    cancelQuery,
    compactQuery,
    respondToolRequest,
  };
}
