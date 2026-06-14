import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  Workspace,
  IndexItemType,
  IndexItemState,
  SyncStatus,
  GitnexusCheckResult,
  GitnexusItem,
  GitnexusProgress,
} from '../types';

// ============================================================
// Context 类型定义
// ============================================================

/** 安装状态 */
export type InstallStatus = 'idle' | 'installing' | 'installed' | 'error';

interface CodebaseIndexContextValue {
  workspaces: Workspace[];
  gitnexusAvailable: GitnexusCheckResult | null;
  indexStates: Record<string, IndexItemState>;
  syncStates: Record<string, SyncStatus>;
  installStatus: InstallStatus;
  installMessage: string;
  triggerIndex: (
    wsId: string,
    itemType: IndexItemType,
    itemPath: string,
    label: string,
    repoId?: string,
  ) => Promise<void>;
  syncWorkspace: (wsId: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  installGitnexus: () => Promise<void>;
}

const CodebaseIndexContext = createContext<CodebaseIndexContextValue | null>(null);

// ============================================================
// 辅助函数
// ============================================================

/** 生成 docs 索引项的 key */
function docsKey(wsId: string): string {
  return `ws_${wsId}_docs`;
}

/** 生成 repo 索引项的 key */
function repoKey(wsId: string, repoId: string): string {
  return `ws_${wsId}_repo_${repoId}`;
}

/** 从目录路径提取 registryName */
function pathToName(path: string): string {
  const parts = path.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || path;
}

/** 从 workspace 名称生成 group name（保持合法字符） */
function workspaceGroupName(ws: Workspace): string {
  return ws.name.replace(/[^a-zA-Z0-9_-]/g, '_') || `ws_${ws.id.slice(0, 8)}`;
}

// ============================================================
// Provider 组件
// ============================================================

export function CodebaseIndexProvider({
  workspaces,
  children,
}: {
  workspaces: Workspace[];
  children: ReactNode;
}) {
  const [gitnexusAvailable, setGitnexusAvailable] = useState<GitnexusCheckResult | null>(null);
  const [indexStates, setIndexStates] = useState<Record<string, IndexItemState>>({});
  const [syncStates, setSyncStates] = useState<Record<string, SyncStatus>>({});
  const [installStatus, setInstallStatus] = useState<InstallStatus>('idle');
  const [installMessage, setInstallMessage] = useState('');

  // refs 避免闭包过期
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const indexStatesRef = useRef(indexStates);
  indexStatesRef.current = indexStates;
  const indexingRef = useRef<Set<string>>(new Set());

  // ============================================================
  // 初始化所有索引项的 idle 状态
  // ============================================================
  useEffect(() => {
    const next: Record<string, IndexItemState> = { ...indexStatesRef.current };

    for (const ws of workspaces) {
      // docs 项
      if (ws.path) {
        const docsPath = `${ws.path}/docs`;
        const key = docsKey(ws.id);
        if (!next[key]) {
          next[key] = {
            itemKey: key,
            itemType: 'docs',
            path: docsPath,
            label: 'docs',
            status: 'idle',
          };
        } else {
          next[key].path = docsPath;
        }
      }
      // repos 项
      for (const repo of ws.repos ?? []) {
        const key = repoKey(ws.id, repo.id);
        if (!next[key]) {
          next[key] = {
            itemKey: key,
            itemType: 'repo',
            path: repo.path,
            label: repo.name,
            status: 'idle',
          };
        } else {
          next[key].path = repo.path;
          next[key].label = repo.name;
        }
      }
    }

    setIndexStates(next);
  }, [workspaces]);

  // ============================================================
  // 初始化：检测 gitnexus + 加载已索引列表
  // ============================================================
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const check = await invoke<GitnexusCheckResult>('gitnexus_check');
        if (cancelled) return;
        setGitnexusAvailable(check);

        if (!check.installed) return;

        // 获取已索引仓库列表
        const list = await invoke<GitnexusItem[]>('gitnexus_list');
        if (cancelled) return;

        // 交叉比对，更新已索引的项
        setIndexStates(prev => {
          const next = { ...prev };
          // 构建路径 → name 的查找表
          const pathSet = new Set(list.map(item => item.path || item.name));
          const nameSet = new Set(list.map(item => item.name));

          for (const key of Object.keys(next)) {
            const item = next[key];
            const itemName = pathToName(item.path);
            const isIndexed =
              pathSet.has(item.path) || nameSet.has(itemName);
            if (isIndexed && item.status === 'idle') {
              next[key] = {
                ...item,
                status: 'indexed',
                indexedAt: Date.now(),
              };
            }
          }
          return next;
        });
      } catch (err) {
        console.error('[useCodebaseIndex] init failed:', err);
        if (!cancelled) {
          setGitnexusAvailable({ installed: false });
        }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ============================================================
  // 监听 gitnexus-progress 事件
  // ============================================================
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<GitnexusProgress>('gitnexus-progress', (event) => {
      const { itemKey, status, message } = event.payload;

      setIndexStates(prev => {
        const item = prev[itemKey];
        if (!item) return prev;

        const next = { ...prev };
        if (status === 'running') {
          next[itemKey] = {
            ...item,
            status: 'indexing',
            lastMessage: message,
          };
        } else if (status === 'done') {
          next[itemKey] = {
            ...item,
            status: 'indexed',
            lastMessage: message,
            indexedAt: Date.now(),
          };
        } else if (status === 'error') {
          next[itemKey] = {
            ...item,
            status: 'error',
            lastMessage: message,
          };
        }
        return next;
      });

      // group_sync 的 done/error 也要更新 syncStates
      if (itemKey.endsWith('_group_sync')) {
        const wsId = itemKey.replace('ws_', '').replace('_group_sync', '');
        setSyncStates(prev => {
          const next = { ...prev };
          if (status === 'done') {
            next[wsId] = 'synced';
          } else if (status === 'error') {
            next[wsId] = 'error';
          }
          return next;
        });
      }
    }).then(fn => { unlistenFn = fn; });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // ============================================================
  // 监听 gitnexus-install-progress 事件
  // ============================================================
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen<GitnexusProgress>('gitnexus-install-progress', (event) => {
      const { status, message } = event.payload;

      if (status === 'running') {
        setInstallStatus('installing');
        setInstallMessage(message);
      } else if (status === 'done') {
        setInstallStatus('installed');
        setInstallMessage(message);
      } else if (status === 'error') {
        setInstallStatus('error');
        setInstallMessage(message);
      }
    }).then(fn => { unlistenFn = fn; });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // ============================================================
  // installGitnexus: 一键安装
  // ============================================================
  const installGitnexus = useCallback(async () => {
    setInstallStatus('installing');
    setInstallMessage('');

    try {
      await invoke('gitnexus_install');
      // 安装成功后重新检测
      const check = await invoke<GitnexusCheckResult>('gitnexus_check');
      setGitnexusAvailable(check);

      // 如果已安装成功，再加载索引列表
      if (check.installed) {
        try {
          const list = await invoke<GitnexusItem[]>('gitnexus_list');
          const pathSet = new Set(list.map(item => item.path || ''));
          const nameSet = new Set(list.map(item => item.name));
          setIndexStates(prev => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
              const item = next[key];
              const itemName = pathToName(item.path);
              const isIndexed = pathSet.has(item.path) || nameSet.has(itemName);
              if (isIndexed && item.status === 'idle') {
                next[key] = { ...item, status: 'indexed', indexedAt: Date.now() };
              }
            }
            return next;
          });
        } catch {
          // list 失败不影响安装成功
        }
      }
    } catch (err) {
      setInstallStatus('error');
      setInstallMessage(String(err));
    }
  }, []);

  // ============================================================
  // triggerIndex: 手动触发单个索引项的索引
  // ============================================================
  const triggerIndex = useCallback(
    async (
      wsId: string,
      itemType: IndexItemType,
      itemPath: string,
      label: string,
      repoId?: string,
    ) => {
      const itemKey = itemType === 'docs' ? docsKey(wsId) : repoKey(wsId, repoId!);

      // 防重入
      if (indexingRef.current.has(itemKey)) return;
      indexingRef.current.add(itemKey);

      // 设置为 indexing 状态
      setIndexStates(prev => ({
        ...prev,
        [itemKey]: {
          ...prev[itemKey],
          itemKey,
          itemType,
          path: itemPath,
          label,
          status: 'indexing',
          lastMessage: undefined,
        },
      }));

      try {
        await invoke('gitnexus_analyze', {
          workspaceId: wsId,
          itemType,
          itemKey,
          path: itemPath,
          force: false,
        });
        // done 事件会通过 listen 更新状态，但这里也做一个保底
      } catch (err) {
        // 如果 progress 事件已设置了 error 状态和详细消息，不要覆盖
        setIndexStates(prev => {
          const existing = prev[itemKey];
          if (existing?.status === 'error' && existing.lastMessage) {
            // 事件已提供了更详细的错误信息
            return prev;
          }
          return {
            ...prev,
            [itemKey]: {
              ...existing,
              status: 'error',
              lastMessage: typeof err === 'string' ? err : String(err),
            },
          };
        });
      } finally {
        indexingRef.current.delete(itemKey);
      }
    },
    [],
  );

  // ============================================================
  // syncWorkspace: 创建 group → 添加所有项 → group sync
  // ============================================================
  const syncWorkspace = useCallback(async (wsId: string) => {
    const ws = workspacesRef.current.find(w => w.id === wsId);
    if (!ws || !ws.path) return;

    const groupName = workspaceGroupName(ws);

    setSyncStates(prev => ({ ...prev, [wsId]: 'syncing' }));

    try {
      // 1. 创建 group
      await invoke('gitnexus_group_create', { name: groupName });

      // 2. 添加 docs（如果已索引）
      const docsItem = indexStatesRef.current[docsKey(wsId)];
      if (docsItem && (docsItem.status === 'indexed' || docsItem.status === 'stale')) {
        const docsName = pathToName(docsItem.path);
        try {
          await invoke('gitnexus_group_add', {
            group: groupName,
            groupPath: 'docs',
            registryName: docsName,
          });
        } catch (err) {
          console.warn('[sync] group add docs failed:', err);
        }
      }

      // 3. 添加每个已索引的 repo
      for (const repo of ws.repos ?? []) {
        const repoItem = indexStatesRef.current[repoKey(wsId, repo.id)];
        if (repoItem && (repoItem.status === 'indexed' || repoItem.status === 'stale')) {
          const repoName = pathToName(repo.path);
          try {
            await invoke('gitnexus_group_add', {
              group: groupName,
              groupPath: `repos/${repo.name}`,
              registryName: repoName,
            });
          } catch (err) {
            console.warn(`[sync] group add repo ${repo.name} failed:`, err);
          }
        }
      }

      // 4. 执行 group sync
      await invoke('gitnexus_group_sync', {
        workspaceId: wsId,
        name: groupName,
      });

      // done/error 事件会更新 syncStates，这里做保底
      setSyncStates(prev => ({
        ...prev,
        [wsId]: prev[wsId] === 'syncing' ? 'synced' : prev[wsId],
      }));
    } catch (err) {
      console.error('[sync] failed:', err);
      setSyncStates(prev => ({ ...prev, [wsId]: 'error' }));
    }
  }, []);

  // ============================================================
  // refreshStatus: 重新检测 gitnexus + 加载索引列表
  // ============================================================
  const refreshStatus = useCallback(async () => {
    try {
      const check = await invoke<GitnexusCheckResult>('gitnexus_check');
      setGitnexusAvailable(check);
      if (!check.installed) return;

      const list = await invoke<GitnexusItem[]>('gitnexus_list');
      const pathSet = new Set(list.map(item => item.path || ''));
      const nameSet = new Set(list.map(item => item.name));

      setIndexStates(prev => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
          const item = next[key];
          if (item.status === 'indexing') continue; // 不干扰进行中的索引
          const itemName = pathToName(item.path);
          const isIndexed = pathSet.has(item.path) || nameSet.has(itemName);
          next[key] = {
            ...item,
            status: isIndexed ? 'indexed' : 'idle',
            indexedAt: isIndexed ? (item.indexedAt ?? Date.now()) : undefined,
          };
        }
        return next;
      });
    } catch (err) {
      console.error('[refresh] failed:', err);
    }
  }, []);

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <CodebaseIndexContext.Provider
      value={{
        workspaces,
        gitnexusAvailable,
        indexStates,
        syncStates,
        installStatus,
        installMessage,
        triggerIndex,
        syncWorkspace,
        refreshStatus,
        installGitnexus,
      }}
    >
      {children}
    </CodebaseIndexContext.Provider>
  );
}

// ============================================================
// 消费 hook
// ============================================================

export function useCodebaseIndex(): CodebaseIndexContextValue {
  const ctx = useContext(CodebaseIndexContext);
  if (!ctx) {
    throw new Error('useCodebaseIndex must be used within CodebaseIndexProvider');
  }
  return ctx;
}

// ============================================================
// 导出辅助函数供组件使用
// ============================================================

export { docsKey, repoKey };
