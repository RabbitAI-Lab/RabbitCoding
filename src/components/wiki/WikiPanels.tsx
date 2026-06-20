import { AlertCircle, FileText, Loader2, X, Zap } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import type { QueueStatus, WikiProgress, FailedDocItem } from './wikiTypes';

// ---- 进度面板 ----

interface WikiProgressPanelProps {
  generating: boolean;
  progress: WikiProgress | null;
  queueStatus: QueueStatus;
  onCancelTask: (taskId: string) => void;
  onClearQueue: () => void;
}

export function WikiProgressPanel({
  generating,
  progress,
  queueStatus,
  onCancelTask,
  onClearQueue,
}: WikiProgressPanelProps) {
  const { t } = useI18n();

  if (!generating && !queueStatus.current && queueStatus.queued.length === 0) return null;

  return (
    <div className="shrink-0 border-b border-gray-200 bg-blue-50/50 dark:border-gray-700 dark:bg-blue-950/20">
      {/* 当前任务进度 */}
      {progress && (
        <div className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin text-blue-600 dark:text-blue-400" />
            <span className="text-[11px] text-blue-600 dark:text-blue-400 truncate">
              {progress.message}
            </span>
          </div>
          {progress.current != null && progress.total != null && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/30">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          )}
          {progress.consecutiveFailures != null && progress.maxConsecutiveFailures != null && progress.consecutiveFailures > 0 && (
            <div className={`mt-0.5 text-[10px] ${progress.consecutiveFailures >= 3 ? 'text-orange-500 dark:text-orange-400' : 'text-gray-400'}`}>
              {t('knowledgeBase.consecutiveFailures')}: {progress.consecutiveFailures}/{progress.maxConsecutiveFailures}
            </div>
          )}
        </div>
      )}

      {/* 队列状态 */}
      {(queueStatus.current || queueStatus.queued.length > 0) && (
        <div className="flex items-center gap-2 border-t border-blue-100 px-2 py-1 dark:border-blue-900/30">
          <span className="text-[10px] text-gray-400 dark:text-gray-500">
            {t('knowledgeBase.queue')}:
          </span>
          {queueStatus.current && (
            <span className="flex items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
              <Loader2 size={9} className="animate-spin" />
              {queueStatus.current.workspaceName}
            </span>
          )}
          {queueStatus.queued.map(task => (
            <span key={task.taskId} className="flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {task.workspaceName}
              <button
                onClick={() => onCancelTask(task.taskId)}
                className="text-gray-300 hover:text-red-500 dark:text-gray-600"
              >
                <X size={9} />
              </button>
            </span>
          ))}
          {queueStatus.queued.length > 0 && (
            <button
              onClick={onClearQueue}
              className="ml-auto text-[10px] text-gray-400 hover:text-red-500 dark:text-gray-500"
            >
              {t('knowledgeBase.clearQueue')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 失败项面板 ----

interface WikiFailedPanelProps {
  allFailedDocs: FailedDocItem[];
  generating: boolean;
  onRetry: (docPaths?: string[], repoName?: string) => void;
}

export function WikiFailedPanel({ allFailedDocs, generating, onRetry }: WikiFailedPanelProps) {
  const { t } = useI18n();

  if (allFailedDocs.length === 0 || generating) return null;

  return (
    <div className="shrink-0 border-b border-orange-200 bg-orange-50/50 dark:border-orange-800/50 dark:bg-orange-950/20">
      <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1">
          <AlertCircle size={11} className="text-orange-500 dark:text-orange-400" />
          <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400">
            {t('knowledgeBase.failedDocs')} ({allFailedDocs.length})
          </span>
        </div>
        <button
          onClick={() => onRetry()}
          className="flex items-center gap-1 rounded bg-orange-500 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-orange-600"
        >
          <Zap size={9} />
          {t('knowledgeBase.retryAll')}
        </button>
      </div>
      <div className="max-h-[120px] overflow-auto pb-1">
        {allFailedDocs.map((item, i) => (
          <div key={i} className="flex items-center gap-1 px-2 py-0.5">
            <FileText size={10} className="shrink-0 text-orange-400" />
            <span className="truncate text-[10px] text-gray-500 dark:text-gray-400">
              {item.repoName ? `[${item.repoName}] ` : ''}{item.doc.path}
            </span>
            <button
              onClick={() => onRetry([item.doc.path], item.repoName)}
              className="shrink-0 text-[10px] text-blue-600 hover:underline dark:text-blue-400"
            >
              {t('knowledgeBase.retryOne')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- 熔断警告 ----

interface PausedWarningProps {
  status: string | undefined;
}

export function PausedWarning({ status }: PausedWarningProps) {
  const { t } = useI18n();

  if (status !== 'paused') return null;

  return (
    <div className="shrink-0 border-b border-red-200 bg-red-50/50 px-2 py-1 dark:border-red-800/50 dark:bg-red-950/20">
      <div className="flex items-center gap-1">
        <AlertCircle size={11} className="text-red-500 dark:text-red-400" />
        <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
          {t('knowledgeBase.paused')}
        </span>
      </div>
    </div>
  );
}
