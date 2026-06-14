import {
  Database,
  RefreshCw,
  FileText,
  FolderGit2,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  CircleDot,
  Zap,
  Download,
  type LucideIcon,
} from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useCodebaseIndex, docsKey, repoKey } from '../../hooks/useCodebaseIndex';
import type { IndexItemStatus, IndexItemState, SyncStatus } from '../../types';

// ============================================================
// 状态徽章
// ============================================================

const STATUS_CONFIG: Record<
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

function StatusBadge({ status }: { status: IndexItemStatus }) {
  const { t } = useI18n();
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`flex items-center gap-1 text-[11px] font-medium ${cfg.className}`}>
      <cfg.icon
        size={12}
        className={status === 'indexing' ? 'animate-spin' : ''}
      />
      {t(cfg.key)}
    </span>
  );
}

const SYNC_STATUS_CONFIG: Record<
  SyncStatus,
  { className: string; key: string }
> = {
  idle: {
    className: 'text-gray-400 dark:text-gray-500',
    key: 'settings.codebaseIndex.syncStatus.idle',
  },
  syncing: {
    className: 'text-blue-500 dark:text-blue-400',
    key: 'settings.codebaseIndex.syncStatus.syncing',
  },
  synced: {
    className: 'text-green-500 dark:text-green-400',
    key: 'settings.codebaseIndex.syncStatus.synced',
  },
  error: {
    className: 'text-red-500 dark:text-red-400',
    key: 'settings.codebaseIndex.syncStatus.error',
  },
};

function SyncBadge({ status }: { status: SyncStatus }) {
  const { t } = useI18n();
  const cfg = SYNC_STATUS_CONFIG[status];
  return (
    <span className={`flex items-center gap-1 text-[11px] font-medium ${cfg.className}`}>
      {status === 'syncing' && <Loader2 size={12} className="animate-spin" />}
      {t(cfg.key)}
    </span>
  );
}

// ============================================================
// 索引项行
// ============================================================

function IndexItemRow({
  item,
  icon,
  disabled,
  onTriggerIndex,
}: {
  item: IndexItemState;
  icon: 'docs' | 'repo';
  disabled: boolean;
  onTriggerIndex: () => void;
}) {
  const { t } = useI18n();
  const isIndexing = item.status === 'indexing';

  const Icon = icon === 'docs' ? FileText : FolderGit2;
  const iconClass =
    icon === 'docs'
      ? 'text-blue-400 dark:text-blue-500'
      : 'text-gray-400 dark:text-gray-500';

  return (
    <div className="flex items-center gap-2 py-2 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
      {/* 图标 */}
      <Icon size={14} className={`shrink-0 ${iconClass}`} />

      {/* 名称 + 路径 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#333333] dark:text-gray-200 truncate">
            {item.label}
          </span>
          <StatusBadge status={item.status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
            {item.path}
          </span>
          {item.lastMessage && isIndexing && (
            <span className="text-[11px] text-blue-400 dark:text-blue-500 truncate">
              {item.lastMessage}
            </span>
          )}
        </div>
        {item.status === 'error' && item.lastMessage && (
          <div className="flex items-start gap-1 mt-1">
            <AlertCircle size={11} className="shrink-0 mt-0.5 text-red-400 dark:text-red-500" />
            <span className="text-[11px] text-red-500 dark:text-red-400 break-all line-clamp-2">
              {item.lastMessage}
            </span>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <button
        onClick={onTriggerIndex}
        disabled={disabled || isIndexing}
        className={`flex items-center gap-1 shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors ${
          disabled || isIndexing
            ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
            : item.status === 'indexed'
              ? 'border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              : 'bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
        }`}
      >
        {isIndexing ? (
          <Loader2 size={12} className="animate-spin" />
        ) : item.status === 'indexed' ? (
          <RefreshCw size={12} />
        ) : (
          <Database size={12} />
        )}
        {item.status === 'indexed' ? t('settings.codebaseIndex.reindex') : t('settings.codebaseIndex.indexNow')}
      </button>
    </div>
  );
}

// ============================================================
// Workspace 卡片
// ============================================================

function WorkspaceCard({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const { t } = useI18n();
  const { workspaces, indexStates, syncStates, triggerIndex, syncWorkspace } =
    useCodebaseIndex();

  const workspace = workspaces.find(w => w.id === workspaceId);
  if (!workspace) return null;

  const hasPath = !!workspace.path;
  const docsK = docsKey(workspaceId);
  const docsItem = indexStates[docsK];

  const syncStatus = syncStates[workspaceId] ?? 'idle';
  const isSyncing = syncStatus === 'syncing';

  // 检查是否有任何项正在索引
  const anyIndexing = (workspace.repos ?? []).some(
    r => indexStates[repoKey(workspaceId, r.id)]?.status === 'indexing',
  ) || docsItem?.status === 'indexing';

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1e1e1e]">
      {/* 标题行 */}
      <div className="px-5 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-medium text-[#333333] dark:text-gray-100 truncate">
              {workspace.name || t('common.unnamedWorkspace')}
            </h3>
            {hasPath && (
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {workspace.path}
              </span>
            )}
          </div>

          {/* 同步组按钮 */}
          {hasPath && (
            <button
              onClick={() => syncWorkspace(workspaceId)}
              disabled={isSyncing || anyIndexing}
              className={`flex items-center gap-1 shrink-0 rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                isSyncing || anyIndexing
                  ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  : syncStatus === 'synced'
                    ? 'border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    : 'bg-green-600 text-white hover:bg-green-700 dark:bg-green-500 dark:hover:bg-green-600'
              }`}
            >
              {isSyncing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Zap size={12} />
              )}
              {isSyncing
                ? t('settings.codebaseIndex.syncing')
                : t('settings.codebaseIndex.syncGroup')}
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="px-3 pb-4">
        {!hasPath ? (
          <div className="py-4 text-center">
            <span className="text-xs text-gray-400 dark:text-gray-500">
              {t('settings.codebaseIndex.noPath')}
            </span>
          </div>
        ) : (
          <>
            {/* Docs 索引行 */}
            {docsItem ? (
              <IndexItemRow
                item={docsItem}
                icon="docs"
                disabled={false}
                onTriggerIndex={() =>
                  triggerIndex(workspaceId, 'docs', docsItem.path, 'docs')
                }
              />
            ) : (
              <div className="flex items-center gap-2 py-2 px-2">
                <FileText size={14} className="shrink-0 text-gray-300 dark:text-gray-600" />
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {t('settings.codebaseIndex.noDocs')}
                </span>
              </div>
            )}

            {/* Repos 索引行 */}
            {(workspace.repos ?? []).length > 0 ? (
              (workspace.repos ?? []).map(repo => {
                const rKey = repoKey(workspaceId, repo.id);
                const repoItem = indexStates[rKey];
                return (
                  <IndexItemRow
                    key={repo.id}
                    item={
                      repoItem || {
                        itemKey: rKey,
                        itemType: 'repo' as const,
                        path: repo.path,
                        label: repo.name,
                        status: 'idle' as const,
                      }
                    }
                    icon="repo"
                    disabled={false}
                    onTriggerIndex={() =>
                      triggerIndex(workspaceId, 'repo', repo.path, repo.name, repo.id)
                    }
                  />
                );
              })
            ) : (
              <div className="flex items-center gap-2 py-2 px-2">
                <FolderGit2 size={14} className="shrink-0 text-gray-300 dark:text-gray-600" />
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {t('settings.codebaseIndex.noRepos')}
                </span>
              </div>
            )}

            {/* Group 状态 */}
            {hasPath && (
              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/60">
                <div className="flex items-center justify-between px-2">
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    {t('settings.codebaseIndex.groupStatus')}
                  </span>
                  <SyncBadge status={syncStatus} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 主面板组件
// ============================================================

export default function CodebaseIndexPanel() {
  const { t } = useI18n();
  const {
    workspaces,
    gitnexusAvailable,
    refreshStatus,
    installStatus,
    installMessage,
    installGitnexus,
  } = useCodebaseIndex();

  const installed = gitnexusAvailable?.installed ?? false;
  const isInstalling = installStatus === 'installing';

  return (
    <div className="space-y-4">
      {/* 顶部标题 + 刷新 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('settings.codebaseIndex.description')}
          </p>
        </div>
        <button
          onClick={() => refreshStatus()}
          disabled={isInstalling}
          className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw size={12} className={isInstalling ? 'animate-spin' : ''} />
          {t('settings.codebaseIndex.refresh')}
        </button>
      </div>

      {/* GitNexus 检测状态 */}
      <div
        className={`rounded-xl border p-4 ${
          installed
            ? 'border-green-200 dark:border-green-700/50 bg-green-50 dark:bg-green-900/10'
            : isInstalling
              ? 'border-blue-200 dark:border-blue-700/50 bg-blue-50 dark:bg-blue-900/10'
              : 'border-orange-200 dark:border-orange-700/50 bg-orange-50 dark:bg-orange-900/10'
        }`}
      >
        <div className="flex items-center gap-2">
          {installed ? (
            <CheckCircle2 size={16} className="text-green-500 dark:text-green-400 shrink-0" />
          ) : isInstalling ? (
            <Loader2 size={16} className="text-blue-500 dark:text-blue-400 shrink-0 animate-spin" />
          ) : installStatus === 'error' ? (
            <AlertCircle size={16} className="text-red-500 dark:text-red-400 shrink-0" />
          ) : (
            <AlertTriangle size={16} className="text-orange-500 dark:text-orange-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {installed ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-green-700 dark:text-green-300">
                  GitNexus CLI
                </span>
                {gitnexusAvailable?.version && (
                  <span className="text-[11px] text-green-600 dark:text-green-400">
                    {gitnexusAvailable.version}
                  </span>
                )}
                {gitnexusAvailable?.path && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {gitnexusAvailable.path}
                  </span>
                )}
              </div>
            ) : isInstalling ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-blue-700 dark:text-blue-300">
                  {t('settings.codebaseIndex.installing')}
                </span>
                {installMessage && (
                  <span className="text-[11px] text-blue-500 dark:text-blue-400 truncate font-mono">
                    {installMessage}
                  </span>
                )}
              </div>
            ) : (
              <>
                <p className="text-xs font-medium text-orange-700 dark:text-orange-300">
                  {t('settings.codebaseIndex.notInstalled')}
                </p>
                {installStatus === 'error' && installMessage ? (
                  <p className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                    {t('settings.codebaseIndex.installFailed')}: {installMessage}
                  </p>
                ) : (
                  <p className="text-[11px] text-orange-600 dark:text-orange-400 mt-0.5">
                    {t('settings.codebaseIndex.notInstalledHint')}
                  </p>
                )}
              </>
            )}
          </div>

          {/* 一键安装按钮 */}
          {!installed && !isInstalling && (
            <button
              onClick={() => installGitnexus()}
              className="flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors"
            >
              <Download size={13} />
              {t('settings.codebaseIndex.install')}
            </button>
          )}
        </div>
      </div>

      {/* Workspace 列表 */}
      {workspaces.length === 0 ? (
        <div className="py-12 text-center">
          <Database size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-2" />
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t('settings.codebaseIndex.noWorkspace')}
          </span>
        </div>
      ) : (
        workspaces.map(ws => (
          <WorkspaceCard key={ws.id} workspaceId={ws.id} />
        ))
      )}
    </div>
  );
}
