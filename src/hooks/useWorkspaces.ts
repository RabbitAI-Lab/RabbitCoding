import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLocalStorage } from './useLocalStorage';
import { generateId } from '../utils/id';
import type { Workspace, Rabbit, Repo, AgentMessage, AssistantTextDeltaMessage, AssistantThinkingDeltaMessage } from '../types';

/**
 * 重启后不可能存在活跃 query 进程，收敛所有「进行中」持久化状态，避免 UI 永久卡在 loading / 转圈。
 * 仅在持久化数据加载时调用一次：
 * - status: running → idle（无活跃进程）
 * - compactionPhase: compacting → null（压缩中断，恢复无压缩态）
 * - messages: 移除 spec_generating（瞬时占位消息；spec 已完成则由 confirmation 独立展示，中断则应消失）
 */
function cleanupInflightState(workspaces: Workspace[]): Workspace[] {
  return workspaces.map(w => ({
    ...w,
    rabbits: w.rabbits.map(r => ({
      ...r,
      status: r.status === 'running' ? 'idle' as const : r.status,
      compactionPhase: r.compactionPhase === 'compacting' ? null : r.compactionPhase,
      messages: r.messages
        .filter(m => m.type !== 'spec_generating')
        .map(m => m.type === 'ask_user_question' && !m.answered ? { ...m, expired: true } : m),
    })),
  }));
}

export function useWorkspaces() {
  // selected IDs 保持 localStorage（小数据，同步读取）
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useLocalStorage<string | null>('rabbit-selected-workspace', null);
  const [selectedRabbitId, setSelectedRabbitId] = useState<string | null>(null);

  // workspaces 改为 useState + 异步加载（主数据源切换到 SQLite）
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dbReady, setDbReady] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingRabbitWorkspaceId, setAddingRabbitWorkspaceId] = useState<string | null>(null);

  // ref 追踪最新 workspaces，供防抖定时器读取
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;

  // ============================================================
  // 异步加载 + 自动迁移（仅首次 mount 执行一次）
  // ============================================================
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // 1. 检查 DB 是否已有数据
        const hasData = await invoke<boolean>('db_has_data');
        if (!hasData) {
          // 2. 首次启动：尝试从 localStorage 迁移
          try {
            const localRaw = localStorage.getItem('rabbit-workspaces');
            if (localRaw) {
              await invoke('db_save_all', { json: localRaw });
              console.log('[useWorkspaces] Migrated data from localStorage to SQLite');
            }
          } catch (migrateErr) {
            console.error('[useWorkspaces] Migration failed:', migrateErr);
          }
        }
        // 3. 从 DB 加载全部数据
        const json = await invoke<string>('db_load_all');
        const loaded: Workspace[] = json ? JSON.parse(json) : [];
        if (mounted) {
          setWorkspaces(cleanupInflightState(loaded));
          setDbReady(true);
          setIsLoading(false);
        }
      } catch {
        // 4. 降级：DB 不可用，回退到 localStorage
        console.error('[useWorkspaces] DB unavailable, falling back to localStorage');
        try {
          const localRaw = localStorage.getItem('rabbit-workspaces');
          const loaded: Workspace[] = localRaw ? JSON.parse(localRaw) : [];
          if (mounted) {
            setWorkspaces(cleanupInflightState(loaded));
            setDbReady(false);
            setIsLoading(false);
          }
        } catch {
          if (mounted) {
            setWorkspaces([]);
            setDbReady(false);
            setIsLoading(false);
          }
        }
      }
    })();
    return () => { mounted = false; };
  }, []);

  // ============================================================
  // 双层防抖保存
  // ============================================================

  // 防抖层：状态变更后 500ms 触发保存
  useEffect(() => {
    if (!dbReady) return;
    const timer = setTimeout(() => {
      invoke('db_save_all', { json: JSON.stringify(workspacesRef.current) }).catch(err => {
        console.error('[useWorkspaces] Debounced save failed:', err);
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [workspaces, dbReady]);

  // 周期层：每 3s 强制保存（覆盖连续流式输出）
  useEffect(() => {
    if (!dbReady) return;
    const interval = setInterval(() => {
      invoke('db_save_all', { json: JSON.stringify(workspacesRef.current) }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [dbReady]);

  // 降级层：DB 不可用时写 localStorage
  useEffect(() => {
    if (dbReady || isLoading) return;
    try {
      localStorage.setItem('rabbit-workspaces', JSON.stringify(workspaces));
    } catch {
      // localStorage full or unavailable
    }
  }, [workspaces, dbReady, isLoading]);

  // 旧数据兼容：确保 repos 和 rabbits.agent 字段始终存在
  const normalizedWorkspaces = workspaces.map(w => ({
    ...w,
    repos: w.repos ?? [],
    rabbits: (w.rabbits ?? []).map(r => {
      const migrated = r as any;
      const specFilePaths: string[] = migrated.specFilePaths
        ?? (migrated.specFilePath ? [migrated.specFilePath] : []);
      return {
        ...r,
        status: r.status ?? 'idle',
        messages: r.messages ?? [],
        model: r.model ?? '',
        specFilePaths,
      };
    }),
  }));

  const addWorkspace = useCallback(() => {
    const id = generateId();
    const newWorkspace: Workspace = {
      id,
      name: '',
      rabbits: [],
      repos: [],
      collapsed: false,
      createdAt: Date.now(),
    };
    setWorkspaces(prev => [newWorkspace, ...prev]);
    setSelectedWorkspaceId(id);
    setEditingId(id);
  }, [setWorkspaces, setSelectedWorkspaceId]);

  const addWorkspaceWithName = useCallback((name: string, path?: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const trimmedPath = path?.trim();
    const id = generateId();
    const newWorkspace: Workspace = {
      id,
      name: trimmed,
      path: trimmedPath || undefined,
      rabbits: [],
      repos: [],
      collapsed: false,
      createdAt: Date.now(),
    };
    setWorkspaces(prev => [newWorkspace, ...prev]);
    setSelectedWorkspaceId(id);

    // 如果指定了路径，自动创建 docs 目录
    if (trimmedPath) {
      invoke('ensure_workspace_docs_dir', { path: trimmedPath })
        .catch(err => console.error('[useWorkspaces] Failed to create docs dir:', err));
    }
  }, [setWorkspaces, setSelectedWorkspaceId]);

  const deleteWorkspace = useCallback((id: string) => {
    setWorkspaces(prev => prev.filter(p => p.id !== id));
    setSelectedWorkspaceId(prev => prev === id ? null : prev);
    setSelectedRabbitId(prev => {
      if (!prev) return null;
      const workspace = workspaces.find(p => p.id === id);
      if (workspace?.rabbits.some(t => t.id === prev)) return null;
      return prev;
    });
  }, [setWorkspaces, setSelectedWorkspaceId, setSelectedRabbitId, workspaces]);

  const renameWorkspace = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWorkspaces(prev => prev.map(p => p.id === id ? { ...p, name: trimmed } : p));
  }, [setWorkspaces]);

  const toggleCollapse = useCallback((id: string) => {
    setWorkspaces(prev => prev.map(p => p.id === id ? { ...p, collapsed: !p.collapsed } : p));
  }, [setWorkspaces]);

  const addRabbit = useCallback((workspaceId: string, title: string, model: string = ''): string => {
    const trimmed = title.trim();
    const rabbitTitle = trimmed || '未命名Rabbit';
    const id = generateId();
    const newRabbit: Rabbit = {
      id,
      title: rabbitTitle,
      completed: false,
      createdAt: Date.now(),
      status: 'idle',
      messages: [],
      model,
    };
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId ? { ...p, rabbits: [newRabbit, ...p.rabbits] } : p
    ));
    if (!trimmed) {
      setEditingId(id);
    }
    setSelectedRabbitId(id);
    return id;
  }, [setWorkspaces, setSelectedRabbitId]);

  const deleteRabbit = useCallback((workspaceId: string, rabbitId: string) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId ? { ...p, rabbits: p.rabbits.filter(t => t.id !== rabbitId) } : p
    ));
    setSelectedRabbitId(prev => prev === rabbitId ? null : prev);
  }, [setWorkspaces, setSelectedRabbitId]);

  const renameRabbit = useCallback((workspaceId: string, rabbitId: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? { ...p, rabbits: p.rabbits.map(t => t.id === rabbitId ? { ...t, title: trimmed } : t) }
        : p
    ));
  }, [setWorkspaces]);

  const toggleRabbitComplete = useCallback((workspaceId: string, rabbitId: string) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? { ...p, rabbits: p.rabbits.map(t => t.id === rabbitId ? { ...t, completed: !t.completed } : t) }
        : p
    ));
  }, [setWorkspaces]);

  const togglePin = useCallback((workspaceId: string, rabbitId: string) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? { ...p, rabbits: p.rabbits.map(t => t.id === rabbitId ? { ...t, pinned: !t.pinned } : t) }
        : p
    ));
  }, [setWorkspaces]);

  const updateWorkspacePath = useCallback((workspaceId: string, path: string) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId ? { ...p, path } : p
    ));

    // 自动创建 docs 目录
    if (path.trim()) {
      invoke('ensure_workspace_docs_dir', { path })
        .catch(err => console.error('[useWorkspaces] Failed to create docs dir:', err));
    }
  }, [setWorkspaces]);

  const addRepo = useCallback((workspaceId: string, name: string, path: string) => {
    const id = generateId();
    const newRepo: Repo = { id, name, path, createdAt: Date.now() };
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId ? { ...p, repos: [...(p.repos ?? []), newRepo] } : p
    ));
  }, [setWorkspaces]);

  const deleteRepo = useCallback((workspaceId: string, repoId: string) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId ? { ...p, repos: (p.repos ?? []).filter(r => r.id !== repoId) } : p
    ));
  }, [setWorkspaces]);

  const updateRepo = useCallback((workspaceId: string, repoId: string, updates: Partial<Pick<Repo, 'name' | 'path'>>) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? { ...p, repos: (p.repos ?? []).map(r => r.id === repoId ? { ...r, ...updates } : r) }
        : p
    ));
  }, [setWorkspaces]);

  const selectWorkspace = useCallback((id: string | null) => {
    setSelectedWorkspaceId(id);
    if (id) setSelectedRabbitId(null);
  }, [setSelectedWorkspaceId, setSelectedRabbitId]);

  const selectRabbit = useCallback((rabbitId: string | null) => {
    setSelectedRabbitId(rabbitId || null);
    // 同步更新 selectedWorkspaceId：确保 selectedRabbit 能在 ContentArea 中被正确查找
    if (rabbitId) {
      const ws = workspacesRef.current.find(w => w.rabbits.some(r => r.id === rabbitId));
      if (ws) {
        setSelectedWorkspaceId(ws.id);
      }
    }
  }, [setSelectedRabbitId, setSelectedWorkspaceId]);

  const startEdit = useCallback((id: string) => {
    setEditingId(id);
  }, []);

  const endEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const startAddRabbit = useCallback((workspaceId: string) => {
    setAddingRabbitWorkspaceId(workspaceId);
  }, []);

  const cancelAddRabbit = useCallback(() => {
    setAddingRabbitWorkspaceId(null);
  }, []);

  // 更新 Rabbit 的 Agent 相关字段（消息追加、状态更新等）
  const updateRabbitAgent = useCallback((
    workspaceId: string,
    rabbitId: string,
    updates: Partial<Pick<Rabbit, 'sessionId' | 'status' | 'messages' | 'costUsd' | 'durationMs' | 'error' | 'tokenUsage' | 'currentUsage' | 'numTurns' | 'specFilePaths' | 'compactionPhase' | 'worktree'>>,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t =>
              t.id === rabbitId ? { ...t, ...updates } : t
            ),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 批量收敛所有 status==='running' 的 rabbit 到目标状态（sidecar 退出/超时兜底用）
  const resetAllRunningRabbits = useCallback((
    status: 'idle' | 'error',
    error?: string,
  ) => {
    setWorkspaces(prev => prev.map(w => ({
      ...w,
      rabbits: w.rabbits.map(r =>
        r.status === 'running'
          ? { ...r, status, ...(error !== undefined ? { error } : {}) }
          : r,
      ),
    })));
  }, [setWorkspaces]);

  // 向 Rabbit 追加一个 Spec 文件路径（函数式更新，去重）
  const appendSpecPath = useCallback((
    workspaceId: string,
    rabbitId: string,
    specPath: string,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              const existing = t.specFilePaths ?? [];
              return existing.includes(specPath)
                ? t
                : { ...t, specFilePaths: [...existing, specPath] };
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 向 Rabbit 追加一条 Agent 消息
  // result 类型消息只保留最后一条（避免重复显示）
  const appendRabbitMessage = useCallback((
    workspaceId: string,
    rabbitId: string,
    message: AgentMessage,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              // 对 result 类型去重：如果已有 result，替换而非追加
              if (message.type === 'result') {
                const filtered = t.messages.filter(m => m.type !== 'result');
                return { ...t, messages: [...filtered, message] };
              }
              return { ...t, messages: [...t.messages, message] };
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 向最后一条同类型消息追加增量文本（流式输出）
  const appendDeltaToLastMessage = useCallback((
    workspaceId: string,
    rabbitId: string,
    delta: AssistantTextDeltaMessage | AssistantThinkingDeltaMessage,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              const msgs = t.messages;
              if (msgs.length === 0) {
                // 没有消息时，创建初始消息
                if (delta.subtype === 'text_delta') {
                  return { ...t, messages: [{ type: 'assistant', subtype: 'text', text: delta.delta } as const] };
                } else {
                  return { ...t, messages: [{ type: 'assistant', subtype: 'thinking', thinking: delta.delta, durationMs: 0 } as const] };
                }
              }
              const last = msgs[msgs.length - 1];
              const targetSubtype = delta.subtype === 'text_delta' ? 'text' : 'thinking';

              if (last.type === 'assistant' && last.subtype === targetSubtype) {
                // 追加到同类型最后一条消息
                const updated = [...msgs];
                if (targetSubtype === 'text') {
                  updated[updated.length - 1] = { ...(last as any), text: (last as any).text + delta.delta } as AgentMessage;
                } else {
                  updated[updated.length - 1] = { ...(last as any), thinking: (last as any).thinking + delta.delta } as AgentMessage;
                }
                return { ...t, messages: updated };
              } else {
                // 创建新的消息
                if (targetSubtype === 'text') {
                  return { ...t, messages: [...msgs, { type: 'assistant', subtype: 'text', text: delta.delta } as const] };
                } else {
                  return { ...t, messages: [...msgs, { type: 'assistant', subtype: 'thinking', thinking: delta.delta, durationMs: 0 } as const] };
                }
              }
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 更新 AskUserQuestion 消息的已回答状态
  const updateAskUserQuestionStatus = useCallback((
    workspaceId: string,
    rabbitId: string,
    requestId: string,
    answered: boolean,
    userAnswers?: Record<string, string>,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              const msgs = t.messages.map(m => {
                if (m.type === 'ask_user_question' && (m as any).requestId === requestId) {
                  return { ...m, answered, ...(userAnswers ? { userAnswers } : {}) } as any;
                }
                return m;
              });
              return { ...t, messages: msgs };
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 清除 Rabbit 的 worktree 信息（置空 rabbit.worktree）
  const clearWorktree = useCallback((
    workspaceId: string,
    rabbitId: string,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t =>
              t.id === rabbitId ? { ...t, worktree: undefined } : t
            ),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 更新最后一条 thinking 消息的 durationMs
  const updateThinkingDuration = useCallback((
    workspaceId: string,
    rabbitId: string,
    durationMs: number,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              const msgs = [...t.messages];
              for (let i = msgs.length - 1; i >= 0; i--) {
                const m = msgs[i];
                if (m.type === 'assistant' && 'subtype' in m && m.subtype === 'thinking') {
                  msgs[i] = { ...m, durationMs } as AgentMessage;
                  break;
                }
              }
              return { ...t, messages: msgs };
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 更新最后一条 UserMessage 的 userMessageId（SDK 分配的 uuid）
  const updateUserMessageId = useCallback((
    workspaceId: string,
    rabbitId: string,
    sdkUuid: string,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              const msgs = [...t.messages];
              // 从后往前找最后一条 user 消息
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].type === 'user') {
                  msgs[i] = { ...msgs[i], userMessageId: sdkUuid } as any;
                  break;
                }
              }
              return { ...t, messages: msgs };
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 回滚到指定 checkpoint：截断该 user message 之后的所有消息，重置 sessionId
  const rewindToCheckpoint = useCallback((
    workspaceId: string,
    rabbitId: string,
    userMessageId: string,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              // 找到目标 user message 的索引
              const targetIdx = t.messages.findIndex(
                m => m.type === 'user' && (m as any).userMessageId === userMessageId
              );
              if (targetIdx === -1) return t;
              // 截断：保留到目标 user message（含），删除之后的所有消息
              const truncatedMessages = t.messages.slice(0, targetIdx + 1);
              return {
                ...t,
                messages: truncatedMessages,
                sessionId: undefined, // 重置 sessionId，后续 prompt 作为新会话发送
                status: 'idle' as const,
                error: undefined,
              };
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // 截断从指定 user message 开始（含）的所有消息，重置 sessionId
  // 用于点击 user 消息编辑重发：删除该消息及之后的所有消息
  const truncateFromMessage = useCallback((
    workspaceId: string,
    rabbitId: string,
    userMessageId: string,
  ) => {
    setWorkspaces(prev => prev.map(p =>
      p.id === workspaceId
        ? {
            ...p,
            rabbits: p.rabbits.map(t => {
              if (t.id !== rabbitId) return t;
              const targetIdx = t.messages.findIndex(
                m => m.type === 'user' && (m as any).userMessageId === userMessageId
              );
              if (targetIdx === -1) return t;
              // 截断：删除目标消息及之后的所有消息
              const truncatedMessages = t.messages.slice(0, targetIdx);
              return {
                ...t,
                messages: truncatedMessages,
                sessionId: undefined,
                status: 'idle' as const,
                error: undefined,
              };
            }),
          }
        : p
    ));
  }, [setWorkspaces]);

  // Workspace 拖拽排序：sourceId 插入到 targetId 的 before/after 位置
  const reorderWorkspace = useCallback((sourceId: string, targetId: string, insertBefore: boolean) => {
    setWorkspaces(prev => {
      const sourceIdx = prev.findIndex(w => w.id === sourceId);
      const targetIdx = prev.findIndex(w => w.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return prev;

      const next = [...prev];
      const [removed] = next.splice(sourceIdx, 1);
      const newTargetIdx = next.findIndex(w => w.id === targetId);
      next.splice(insertBefore ? newTargetIdx : newTargetIdx + 1, 0, removed);
      return next;
    });
  }, [setWorkspaces]);

  return {
    workspaces: normalizedWorkspaces,
    isLoading,
    selectedWorkspaceId,
    selectedRabbitId,
    editingId,
    addingRabbitWorkspaceId,
    addWorkspace,
    addWorkspaceWithName,
    deleteWorkspace,
    renameWorkspace,
    toggleCollapse,
    addRabbit,
    deleteRabbit,
    renameRabbit,
    toggleRabbitComplete,
    selectWorkspace,
    selectRabbit,
    startEdit,
    endEdit,
    startAddRabbit,
    cancelAddRabbit,
    togglePin,
    updateWorkspacePath,
    addRepo,
    deleteRepo,
    updateRepo,
    updateRabbitAgent,
    resetAllRunningRabbits,
    appendSpecPath,
    appendRabbitMessage,
    appendDeltaToLastMessage,
    updateThinkingDuration,
    updateAskUserQuestionStatus,
    clearWorktree,
    updateUserMessageId,
    rewindToCheckpoint,
    truncateFromMessage,
    reorderWorkspace,
  };
}
