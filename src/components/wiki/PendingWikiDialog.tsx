import { AlertTriangle, FolderOpen, ChevronRight } from 'lucide-react';
import Modal from '../common/Modal';
import { useI18n } from '../../i18n/useI18n';

export interface PendingWikiInfo {
  workspaceId: string;
  workspaceName: string;
  status: string;
  completedCount: number;
  failedCount: number;
  catalogDone: boolean;
}

interface PendingWikiDialogProps {
  pendingList: PendingWikiInfo[];
  onContinue: (workspaceId: string) => void;
  onDismiss: () => void;
}

export default function PendingWikiDialog({
  pendingList,
  onContinue,
  onDismiss,
}: PendingWikiDialogProps) {
  const { t } = useI18n();

  const statusLabel = (status: string): { label: string; color: string } => {
    switch (status) {
      case 'paused':
        return {
          label: t('knowledgeBase.pendingWikiStatusPaused'),
          color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
        };
      case 'partial':
        return {
          label: t('knowledgeBase.pendingWikiStatusPartial'),
          color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
        };
      case 'error':
        return {
          label: t('knowledgeBase.pendingWikiStatusError'),
          color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
        };
      default:
        return {
          label: t('knowledgeBase.pendingWikiStatusPartial'),
          color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
        };
    }
  };

  return (
    <Modal
      open={true}
      onClose={onDismiss}
      title={t('knowledgeBase.pendingWikiTitle')}
      widthClassName="w-[480px]"
    >
      {/* 描述 */}
      <div className="flex items-start gap-2 mb-4">
        <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-500" />
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          {t('knowledgeBase.pendingWikiDesc')}
        </p>
      </div>

      {/* Workspace 列表 */}
      <div className="flex flex-col gap-2">
        {pendingList.map((item) => {
          const st = statusLabel(item.status);
          return (
            <div
              key={item.workspaceId}
              className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#2a2a2a] px-3 py-2.5"
            >
              <FolderOpen size={18} className="shrink-0 text-gray-400 dark:text-gray-500" />

              {/* 中间信息 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {item.workspaceName}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${st.color}`}>
                    {st.label}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  <span>
                    {t('knowledgeBase.pendingWikiCompleted')}: {item.completedCount}
                  </span>
                  {item.failedCount > 0 && (
                    <span>
                      {t('knowledgeBase.pendingWikiFailed')}: {item.failedCount}
                    </span>
                  )}
                </div>
              </div>

              {/* 继续按钮 */}
              <button
                onClick={() => onContinue(item.workspaceId)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
              >
                {t('knowledgeBase.pendingWikiContinue')}
                <ChevronRight size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* 底部关闭按钮 */}
      <div className="flex justify-end mt-5 pt-3 border-t border-gray-100 dark:border-gray-800">
        <button
          onClick={onDismiss}
          className="rounded-md px-4 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          {t('knowledgeBase.pendingWikiDismiss')}
        </button>
      </div>
    </Modal>
  );
}
