import { useState, useEffect, lazy, Suspense, useMemo, useCallback } from 'react';
import {
  FileText,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronDown,
  Terminal,
  FolderOpen,
  BookOpen,
  GitCommitHorizontal,
  LayoutList,
  Maximize2,
  Minimize2,
  FolderGit2,
  Plus,
  Pencil,
  Trash2,
  Database,
  CircleDot,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  PlusCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Rabbit, AgentMessage, AssistantToolUseMessage, TodoItem, IndexItemStatus, Repo } from '../types';
import { getLatestTodoWriteTodos } from './agent/todoUtils';
import { useI18n } from '../i18n/useI18n';
import { useCodebaseIndex, docsKey, repoKey } from '../hooks/useCodebaseIndex';
import { invoke } from '@tauri-apps/api/core';
import { XMarkdown } from '@ant-design/x-markdown';
import { useTheme } from '../hooks/useTheme';

const TerminalTab = lazy(() => import('./terminal/TerminalTab'));
const FileExplorerTab = lazy(() => import('./files/FileExplorerTab'));

type TabKey = 'summary' | 'zsh' | 'files' | 'spec';

// ============================================================
// 索引状态徽章配置
// ============================================================

const INDEX_STATUS_CONFIG: Record<
  IndexItemStatus,
  { icon: LucideIcon; className: string; key: string }
> = {
  idle: {
    icon: CircleDot,
    className: 'text-gray-400 dark:text-gray-500',
    key: 'settings.codebaseIndex.status.idle',
  },
  indexing: {
    icon: Loader2,
    className: 'text-blue-500 dark:text-blue-400',
    key: 'settings.codebaseIndex.status.indexing',
  },
  indexed: {
    icon: CheckCircle2,
    className: 'text-green-500 dark:text-green-400',
    key: 'settings.codebaseIndex.status.indexed',
  },
  error: {
    icon: AlertCircle,
    className: 'text-red-500 dark:text-red-400',
    key: 'settings.codebaseIndex.status.error',
  },
  stale: {
    icon: AlertTriangle,
    className: 'text-orange-500 dark:text-orange-400',
    key: 'settings.codebaseIndex.status.stale',
  },
};

/** 精简版索引状态徽章 */
function IndexStatusBadge({ status }: { status: IndexItemStatus }) {
  const { t } = useI18n();
  const cfg = INDEX_STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`flex items-center gap-1 text-[11px] font-medium ${cfg.className}`}>
      <Icon
        size={11}
        className={status === 'indexing' ? 'animate-spin' : ''}
      />
      {t(cfg.key)}
    </span>
  );
}

// ============================================================
// 记忆操作提取
// ============================================================

interface MemoryOperation {
  id: string;
  type: 'search' | 'create' | 'update' | 'delete';
  title: string;
  depth?: string;
  keywords?: string;
  category?: string;
  index: number;
}

function extractMemoryOperations(messages: AgentMessage[]): MemoryOperation[] {
  const ops: MemoryOperation[] = [];
  messages.forEach((msg, index) => {
    if (msg.type !== 'assistant' || msg.subtype !== 'tool_use') return;
    const toolMsg = msg as AssistantToolUseMessage;

    if (toolMsg.toolName === 'SearchMemory') {
      ops.push({
        id: toolMsg.toolUseId,
        type: 'search',
        title: String(toolMsg.toolInput.query ?? ''),
        depth: String(toolMsg.toolInput.depth ?? ''),
        keywords: String(toolMsg.toolInput.keywords ?? ''),
        index,
      });
    } else if (toolMsg.toolName === 'UpdateMemory') {
      const action = String(toolMsg.toolInput.action ?? 'create');
      ops.push({
        id: toolMsg.toolUseId,
        type: action as 'create' | 'update' | 'delete',
        title: String(toolMsg.toolInput.title ?? ''),
        category: String(toolMsg.toolInput.category ?? ''),
        index,
      });
    }
  });
  return ops;
}

/** 从 Agent 消息列表中提取工具调用序列 */
function extractToolCalls(messages: AgentMessage[]) {
  return messages
    .filter((m): m is AssistantToolUseMessage => m.type === 'assistant' && m.subtype === 'tool_use');
}

/** 从工具调用中提取文件变更 */
function extractFileChanges(toolCalls: AssistantToolUseMessage[]) {
  const fileOps = toolCalls.filter(tc =>
    ['Edit', 'Write'].includes(tc.toolName)
  );
  const seen = new Map<string, { file: string; action: string }>();
  for (const tc of fileOps) {
    const filePath = String(tc.toolInput.file_path ?? tc.toolInput.filePath ?? '');
    if (!filePath) continue;
    const action = tc.toolName === 'Write' ? 'created' : 'modified';
    seen.set(filePath, { file: filePath, action });
  }
  return Array.from(seen.values());
}

/** Spec 文档渲染组件（支持多 spec 切换） */
function SpecTab({ specFilePaths }: { specFilePaths: string[] }) {
  const { t } = useI18n();
  const { resolvedTheme } = useTheme();
  const [activeSpec, setActiveSpec] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  // specFilePaths 变化时，默认指向最后一项（最新 spec）
  useEffect(() => {
    if (specFilePaths.length > 0) {
      setActiveSpec(specFilePaths[specFilePaths.length - 1]);
    } else {
      setActiveSpec('');
      setContent('');
    }
  }, [specFilePaths]);

  // 读取选中的 spec 文件内容
  useEffect(() => {
    if (!activeSpec) {
      setContent('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    // 使用自定义 Rust 命令读取文件，绕过 Tauri fs:scope 对 .rabbit 隐藏目录的限制
    invoke<string>('read_text_file_unrestricted', { path: activeSpec })
      .then(text => {
        if (!cancelled) {
          setContent(text);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[SpecTab] File read error:', err);
          setContent('');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [activeSpec]);

  if (specFilePaths.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
        <span className="text-xs">{t('rightPanel.noDocs')}</span>
      </div>
    );
  }

  const markdownClass = resolvedTheme === 'dark' ? 'x-markdown-dark' : 'x-markdown-light';

  return (
    <div className="flex h-full flex-col">
      {specFilePaths.length > 1 && (
        <div className="flex flex-wrap gap-1.5 p-2 border-b border-gray-100 dark:border-gray-800">
          {specFilePaths.map(p => {
            const name = p.split('/').pop() ?? p;
            const isActive = p === activeSpec;
            return (
              <button
                key={p}
                onClick={() => setActiveSpec(p)}
                className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                  isActive
                    ? 'bg-gray-200 dark:bg-gray-700 text-[#141414] dark:text-gray-100'
                    : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-750'
                }`}
                title={p}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        ) : content ? (
          <div className={`p-4 text-sm leading-relaxed ${markdownClass} text-[#141414] dark:text-gray-100`}>
            <XMarkdown content={content} openLinksInNewTab />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
            <span className="text-xs">{t('rightPanel.noDocs')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface RightPanelProps {
  maximized: boolean;
  onToggleMaximize: () => void;
  selectedRabbit?: Rabbit | null;
  workspacePath?: string;
  workspaceId?: string;
  specTabSignal?: number;
  onAddRepo?: () => void;
  onEditRepo?: (repo: Repo) => void;
  onDeleteRepo?: (repoId: string) => void;
}

export default function RightPanel({ maximized, onToggleMaximize, selectedRabbit, workspacePath, workspaceId, specTabSignal, onAddRepo, onEditRepo, onDeleteRepo }: RightPanelProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>('summary');
  const { indexStates, gitnexusAvailable, workspaces, triggerIndex } = useCodebaseIndex();

  // 切换到无 spec 的 Rabbit 时，若当前 tab 是 spec，回退到 summary
  useEffect(() => {
    if (activeTab === 'spec' && !selectedRabbit?.specFilePaths?.length) {
      setActiveTab('summary');
    }
  }, [activeTab, selectedRabbit?.specFilePaths]);

  // specTabSignal 变化时，自动切换到 spec tab
  useEffect(() => {
    if (specTabSignal && specTabSignal > 0) {
      setActiveTab('spec');
    }
  }, [specTabSignal]);

  const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'summary', label: t('rightPanel.summary'), icon: LayoutList },
    { key: 'zsh', label: 'zsh', icon: Terminal },
    { key: 'files', label: t('rightPanel.files'), icon: FolderOpen },
    ...(selectedRabbit?.specFilePaths?.length
      ? [{ key: 'spec' as TabKey, label: t('rightPanel.spec'), icon: FileText }]
      : []),
  ];
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({
    repos: false,
    progress: false,
    artifacts: false,
    references: false,
    indexStatus: false,
  });

  const toggleGroup = (key: string) => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // 从选中 Rabbit 的消息中提取动态数据
  const toolCalls = useMemo(() =>
    selectedRabbit ? extractToolCalls(selectedRabbit.messages) : []
  , [selectedRabbit]);

  // 从最后一次 TodoWrite 调用中提取 todos
  const latestTodos = useMemo((): TodoItem[] => {
    if (!selectedRabbit) return [];
    return getLatestTodoWriteTodos(selectedRabbit.messages);
  }, [selectedRabbit]);

  const fileChanges = useMemo(() =>
    selectedRabbit ? extractFileChanges(toolCalls) : []
  , [selectedRabbit, toolCalls]);

  // 提取被读取的文件作为引用
  const referencedFiles = useMemo(() =>
    toolCalls
      .filter(tc => tc.toolName === 'Read')
      .map(tc => String(tc.toolInput.file_path ?? tc.toolInput.filePath ?? ''))
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i) // dedupe
      .map(path => ({ id: path, name: path.split('/').pop() ?? path }))
  , [toolCalls]);

  // 记忆操作
  const memoryOps = useMemo(() =>
    selectedRabbit ? extractMemoryOperations(selectedRabbit.messages) : []
  , [selectedRabbit]);

  const memorySearchOps = useMemo(() =>
    memoryOps.filter(op => op.type === 'search')
  , [memoryOps]);

  const memoryUpdateOps = useMemo(() =>
    memoryOps.filter(op => op.type !== 'search')
  , [memoryOps]);

  // 派生当前工作区的索引项
  const currentWorkspace = useMemo(
    () => workspaces.find(w => w.id === workspaceId),
    [workspaces, workspaceId],
  );
  const docsItem = useMemo(
    () => workspaceId ? indexStates[docsKey(workspaceId)] : undefined,
    [indexStates, workspaceId],
  );
  const gitnexusInstalled = gitnexusAvailable?.installed ?? false;

  // 是否存在正在进行中的索引项（用于刷新按钮 spinning 动画）
  const isAnyIndexing = useMemo(() => {
    if (!workspaceId) return false;
    if (docsItem?.status === 'indexing') return true;
    return (currentWorkspace?.repos ?? []).some(repo => {
      const item = indexStates[repoKey(workspaceId, repo.id)];
      return item?.status === 'indexing';
    });
  }, [workspaceId, docsItem, currentWorkspace, indexStates]);

  // 一键批量触发当前工作区所有未索引/出错项的索引
  const handleTriggerAllIndex = useCallback(() => {
    if (!workspaceId || !currentWorkspace) return;
    // docs
    if (docsItem && (docsItem.status === 'idle' || docsItem.status === 'error')) {
      triggerIndex(workspaceId, 'docs', docsItem.path, 'docs');
    }
    // repos
    for (const repo of currentWorkspace.repos ?? []) {
      const item = indexStates[repoKey(workspaceId, repo.id)];
      if (item && (item.status === 'idle' || item.status === 'error')) {
        triggerIndex(workspaceId, 'repo', repo.path, repo.name, repo.id);
      }
    }
  }, [workspaceId, currentWorkspace, docsItem, indexStates, triggerIndex]);

  return (
    <div className="flex h-full flex-col">
      {/* Tab 栏 */}
      <div className="flex shrink-0 border-b border-gray-200 dark:border-gray-700 items-center">
        <div className="flex">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const showLabel = TABS.length <= 3;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs transition-colors ${
                  activeTab === tab.key
                    ? 'text-[#141414] dark:text-gray-100 border-b-2 border-[#141414] dark:border-gray-100'
                    : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
                }`}
              >
                <Icon size={14} />
                {showLabel && <span>{tab.label}</span>}
              </button>
            );
          })}
        </div>
        <button
          onClick={onToggleMaximize}
          className="ml-auto mr-2 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800 transition-colors"
        >
          {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-hidden relative">
        {/* summary Tab - 激活时用 z-index 覆盖 zsh 层 */}
        <div
          className="absolute inset-0 overflow-auto bg-white dark:bg-[#1e1e1e]"
          style={{ display: activeTab === 'summary' ? 'block' : 'none', zIndex: activeTab === 'summary' ? 2 : 0 }}
        >
          <div className="flex flex-col">
            {/* Group: 进展 */}
            <div className="p-3">
              <button
                onClick={() => toggleGroup('progress')}
                className="flex items-center justify-between w-full text-xs font-normal text-[#646261] dark:text-gray-400 mb-2"
              >
                <span>{t('rightPanel.progress')}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform text-gray-400 dark:text-gray-500 ${collapsed.progress ? '-rotate-90' : ''}`}
                />
              </button>
              {!collapsed.progress && (
                <div className="flex flex-col gap-1 pl-1">
                  {latestTodos.length > 0 ? (() => {
                    const sorted = [...latestTodos].sort((a, b) => {
                      const order = { in_progress: 0, pending: 1, completed: 2 };
                      return order[a.status] - order[b.status];
                    });
                    return sorted.map((todo, i) => {
                      const isCompleted = todo.status === 'completed';
                      const isInProgress = todo.status === 'in_progress';
                      return (
                        <div key={i} className="flex items-start gap-2">
                          {isCompleted ? (
                            <CheckCircle2 size={14} className="shrink-0 mt-px text-emerald-500" />
                          ) : isInProgress ? (
                            <Loader2 size={14} className="shrink-0 mt-px text-blue-500 animate-spin" />
                          ) : (
                            <Circle size={14} className="shrink-0 mt-px text-gray-300 dark:text-gray-600" />
                          )}
                          <span className={`text-xs leading-relaxed ${
                            isCompleted
                              ? 'text-gray-400 dark:text-gray-500 line-through'
                              : isInProgress
                                ? 'text-[#141414] dark:text-gray-100 font-medium'
                                : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            {isInProgress && todo.activeForm ? todo.activeForm : todo.content}
                          </span>
                        </div>
                      );
                    });
                  })() : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-2">{t('rightPanel.noProgress')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-200 dark:border-gray-700" />
            {/* Group: 产物 */}
            <div className="p-3">
              <button
                onClick={() => toggleGroup('artifacts')}
                className="flex items-center justify-between w-full text-xs font-normal text-[#646261] dark:text-gray-400 mb-2"
              >
                <span>{t('rightPanel.artifacts')}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform text-gray-400 dark:text-gray-500 ${collapsed.artifacts ? '-rotate-90' : ''}`}
                />
              </button>
              {!collapsed.artifacts && (
                <div className="flex flex-col gap-3 pl-1">
                  {/* Spec 文档 */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <FileText size={13} className="text-gray-400 dark:text-gray-500" />
                      <span className="text-xs text-[#9A9A9A] dark:text-gray-400 font-light">{t('rightPanel.specDoc')}</span>
                    </div>
                    <div className="flex flex-col gap-1 pl-4">
                      {selectedRabbit?.specFilePaths?.length ? (
                        selectedRabbit.specFilePaths.map((p, i) => {
                          const name = p.split('/').pop() ?? p;
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs text-[#141414] dark:text-gray-100">
                              <FileText size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
                              <span className="truncate" title={p}>{name}</span>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-xs text-gray-400 py-1">{t('rightPanel.noDocs')}</p>
                      )}
                    </div>
                  </div>
                  {/* 文件变更 */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <GitCommitHorizontal size={13} className="text-gray-400 dark:text-gray-500" />
                      <span className="text-xs text-[#9A9A9A] dark:text-gray-400 font-light">{t('rightPanel.fileChanges')}</span>
                    </div>
                    <div className="flex flex-col gap-1 pl-4">
                      {fileChanges.length > 0 ? fileChanges.map((change, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          <GitCommitHorizontal size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
                          <span className="text-[#141414] dark:text-gray-100 truncate">{change.file}</span>
                          <span className="text-gray-400 dark:text-gray-500 shrink-0">{change.action === 'created' ? t('rightPanel.fileCreated') : t('rightPanel.fileModified')}</span>
                        </div>
                      )) : (
                        <p className="text-xs text-gray-400 dark:text-gray-500 py-1">{t('rightPanel.noFileChanges')}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-200 dark:border-gray-700" />
            {/* Group: 引用 */}
            <div className="p-3">
              <button
                onClick={() => toggleGroup('references')}
                className="flex items-center justify-between w-full text-xs font-normal text-[#646261] dark:text-gray-400 mb-2"
              >
                <span>{t('rightPanel.references')}</span>
                <ChevronDown
                  size={14}
                  className={`transition-transform text-gray-400 dark:text-gray-500 ${collapsed.references ? '-rotate-90' : ''}`}
                />
              </button>
              {!collapsed.references && (
                <div className="flex flex-col gap-3 pl-1">
                  {/* 引用的记忆 (SearchMemory) */}
                  {memorySearchOps.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Search size={13} className="text-gray-400 dark:text-gray-500" />
                        <span className="text-xs text-[#9A9A9A] dark:text-gray-400 font-light">{t('rightPanel.memorySearch')}</span>
                      </div>
                      <div className="flex flex-col gap-1 pl-4">
                        {memorySearchOps.map(op => (
                          <div key={op.id} className="flex items-center gap-2 text-xs text-[#141414] dark:text-gray-100">
                            <BookOpen size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
                            <span className="truncate flex-1">{op.title}</span>
                            {op.depth && (
                              <span className="px-1 py-0.5 rounded text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 shrink-0">
                                {op.depth}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 新增/更新的记忆 (UpdateMemory) */}
                  {memoryUpdateOps.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <BookOpen size={13} className="text-gray-400 dark:text-gray-500" />
                        <span className="text-xs text-[#9A9A9A] dark:text-gray-400 font-light">{t('rightPanel.memoryUpdate')}</span>
                      </div>
                      <div className="flex flex-col gap-1 pl-4">
                        {memoryUpdateOps.map(op => {
                          const iconMap = {
                            create: { Icon: PlusCircle, cls: 'text-green-500' },
                            update: { Icon: RefreshCw, cls: 'text-blue-500' },
                            delete: { Icon: Trash2, cls: 'text-red-500' },
                          };
                          const { Icon: OpIcon, cls } = iconMap[op.type as keyof typeof iconMap] ?? iconMap.create;
                          return (
                            <div key={op.id} className="flex items-center gap-2 text-xs text-[#141414] dark:text-gray-100">
                              <OpIcon size={12} className={`${cls} shrink-0`} />
                              <span className="truncate">{op.title}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* 引用的文件 (Read) */}
                  {referencedFiles.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <FileText size={13} className="text-gray-400 dark:text-gray-500" />
                        <span className="text-xs text-[#9A9A9A] dark:text-gray-400 font-light">{t('rightPanel.referencedFiles')}</span>
                      </div>
                      <div className="flex flex-col gap-1 pl-4">
                        {referencedFiles.map(ref => (
                          <div key={ref.id} className="flex items-center gap-2 text-xs text-[#141414] dark:text-gray-100">
                            <FileText size={12} className="text-gray-300 dark:text-gray-600 shrink-0" />
                            <span className="truncate">{ref.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* 整体空态 */}
                  {memorySearchOps.length === 0 && memoryUpdateOps.length === 0 && referencedFiles.length === 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-1">{t('rightPanel.noReferences')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-200 dark:border-gray-700" />
            {/* Group: 代码库 */}
            <div className="p-3">
              <button
                onClick={() => toggleGroup('repos')}
                className="flex items-center justify-between w-full text-xs font-normal text-[#646261] dark:text-gray-400 mb-2"
              >
                <span>
                  {t('rightPanel.repos')}
                </span>
                <span className="flex items-center gap-2">
                  {onAddRepo && (
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); onAddRepo(); }}
                      className="flex items-center gap-0.5 text-[#646261] hover:text-[#141414] dark:text-gray-400 dark:hover:text-gray-100 transition-colors"
                    >
                      <Plus size={13} />
                      {t('common.add')}
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`transition-transform text-gray-400 dark:text-gray-500 ${collapsed.repos ? '-rotate-90' : ''}`}
                  />
                </span>
              </button>
              {!collapsed.repos && (
                <div className="flex flex-col gap-1 pl-0.5">
                  {(currentWorkspace?.repos ?? []).length > 0 ? (
                    (currentWorkspace?.repos ?? []).map(repo => (
                      <div
                        key={repo.id}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors group"
                      >
                        <span className="text-xs text-[#141414] dark:text-gray-100 shrink-0">{repo.name}</span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 flex-1 truncate">{repo.path}</span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          {onEditRepo && (
                            <button
                              onClick={() => onEditRepo(repo)}
                              className="text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
                            >
                              <Pencil size={12} />
                            </button>
                          )}
                          {onDeleteRepo && (
                            <button
                              onClick={() => onDeleteRepo(repo.id)}
                              className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-1.5 pl-1">{t('rightPanel.noRepos')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="border-t border-dashed border-gray-200 dark:border-gray-700" />
            {/* Group: 索引状态 */}
            <div className="p-3">
              <button
                onClick={() => toggleGroup('indexStatus')}
                className="flex items-center justify-between w-full text-xs font-normal text-[#646261] dark:text-gray-400 mb-2"
              >
                <span>{t('rightPanel.indexStatus')}</span>
                <span className="flex items-center gap-1">
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); handleTriggerAllIndex(); }}
                    title={t('rightPanel.indexAll')}
                    className={`flex items-center text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 transition-colors ${(!workspaceId || !gitnexusInstalled) ? 'pointer-events-none opacity-40' : ''}`}
                  >
                    <RefreshCw size={13} className={isAnyIndexing ? 'animate-spin' : ''} />
                  </span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform text-gray-400 dark:text-gray-500 ${collapsed.indexStatus ? '-rotate-90' : ''}`}
                  />
                </span>
              </button>
              {!collapsed.indexStatus && (
                <div className="flex flex-col gap-1 pl-1">
                  {!workspaceId ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-2">{t('rightPanel.indexStatusNoWorkspace')}</p>
                  ) : !gitnexusInstalled ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 py-2">{t('rightPanel.indexStatusNoGitnexus')}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {/* 文档索引 */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FileText size={13} className="text-gray-400 dark:text-gray-500" />
                          <span className="text-xs text-[#9A9A9A] dark:text-gray-400 font-light">{t('settings.codebaseIndex.docs')}</span>
                        </div>
                        <div className="flex flex-col gap-1 pl-4">
                          {docsItem ? (
                            <>
                              <div className="flex items-center gap-2 group">
                                <FileText size={12} className="shrink-0 text-blue-400 dark:text-blue-500" />
                                <span className="text-xs text-[#141414] dark:text-gray-100">docs</span>
                                <span className="ml-auto flex items-center gap-1.5">
                                  <IndexStatusBadge status={docsItem.status} />
                                  {(docsItem.status === 'idle' || docsItem.status === 'error') && (
                                    <button
                                      onClick={() => triggerIndex(workspaceId!, 'docs', docsItem.path, 'docs')}
                                      title={t('settings.codebaseIndex.indexNow')}
                                      className="shrink-0 text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
                                    >
                                      <Database size={13} />
                                    </button>
                                  )}
                                </span>
                              </div>
                              {docsItem.status === 'error' && docsItem.lastMessage && (
                                <div className="flex items-start gap-1">
                                  <AlertCircle size={11} className="shrink-0 mt-0.5 text-red-400 dark:text-red-500" />
                                  <span className="text-[11px] text-red-500 dark:text-red-400 break-all line-clamp-2">{docsItem.lastMessage}</span>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.codebaseIndex.noDocs')}</p>
                          )}
                        </div>
                      </div>

                      {/* 代码仓库索引 */}
                      <div>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <FolderGit2 size={13} className="text-gray-400 dark:text-gray-500" />
                          <span className="text-xs text-[#9A9A9A] dark:text-gray-400 font-light">{t('contentArea.repos')}</span>
                        </div>
                        <div className="flex flex-col gap-1 pl-4">
                          {currentWorkspace && (currentWorkspace.repos ?? []).length > 0
                            ? (currentWorkspace.repos ?? []).map(repo => {
                              const rKey = repoKey(workspaceId!, repo.id);
                              const repoItem = indexStates[rKey];
                              const repoStatus = repoItem?.status ?? 'idle';
                              return (
                                <div key={repo.id}>
                                  <div className="flex items-center gap-2 group">
                                    <FolderOpen size={12} className="shrink-0 text-gray-400 dark:text-gray-500" />
                                    <span className="text-xs text-[#141414] dark:text-gray-100 truncate">{repo.name}</span>
                                    <span className="ml-auto flex items-center gap-1.5">
                                      <IndexStatusBadge status={repoStatus} />
                                      {(repoStatus === 'idle' || repoStatus === 'error') && (
                                        <button
                                          onClick={() => triggerIndex(workspaceId!, 'repo', repo.path, repo.name, repo.id)}
                                          title={t('settings.codebaseIndex.indexNow')}
                                          className="shrink-0 text-gray-400 hover:text-blue-600 dark:text-gray-500 dark:hover:text-blue-400 transition-colors"
                                        >
                                          <Database size={13} />
                                        </button>
                                      )}
                                    </span>
                                  </div>
                                  {repoStatus === 'error' && repoItem?.lastMessage && (
                                    <div className="flex items-start gap-1">
                                      <AlertCircle size={11} className="shrink-0 mt-0.5 text-red-400 dark:text-red-500" />
                                      <span className="text-[11px] text-red-500 dark:text-red-400 break-all line-clamp-2">{repoItem.lastMessage}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                            : <p className="text-xs text-gray-400 dark:text-gray-500">{t('settings.codebaseIndex.noRepos')}</p>
                          }
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* zsh Tab - 始终挂载，用 visibility 隐藏以保持 xterm canvas 存活，避免重排闪烁 */}
        <div
          className="absolute inset-0"
          style={{
            visibility: activeTab === 'zsh' ? 'visible' : 'hidden',
            zIndex: activeTab === 'zsh' ? 2 : 0,
          }}
        >
          <Suspense fallback={(
            <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
              <div className="h-3 w-3 rounded-full border-2 border-gray-300 border-t-transparent dark:border-gray-600 animate-spin" />
              <span className="text-xs">{t('rightPanel.loadingTerminal')}</span>
            </div>
          )}>
            <TerminalTab visible={activeTab === 'zsh'} />
          </Suspense>
        </div>

        {/* files Tab - 文件浏览器 */}
        <div
          className="absolute inset-0 bg-white dark:bg-[#1e1e1e]"
          style={{ display: activeTab === 'files' ? 'block' : 'none', zIndex: activeTab === 'files' ? 2 : 0 }}
        >
          <Suspense fallback={(
            <div className="flex h-full items-center justify-center gap-2 text-gray-300 dark:text-gray-600">
              <div className="h-3 w-3 rounded-full border-2 border-gray-300 border-t-transparent dark:border-gray-600 animate-spin" />
              <span className="text-xs">{t('rightPanel.loadingFileBrowser')}</span>
            </div>
          )}>
            <FileExplorerTab workspacePath={workspacePath} />
          </Suspense>
        </div>

        {/* spec Tab - Spec 文档 */}
        {activeTab === 'spec' && (
          <div className="absolute inset-0 overflow-auto bg-white dark:bg-[#1e1e1e]" style={{ zIndex: 2 }}>
            <SpecTab specFilePaths={selectedRabbit?.specFilePaths ?? []} />
          </div>
        )}
      </div>
    </div>
  );
}
