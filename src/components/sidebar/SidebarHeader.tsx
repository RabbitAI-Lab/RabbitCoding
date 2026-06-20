import { useState, useCallback, useRef, useEffect } from 'react';
import { Plus, FolderPlus } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import Tooltip from '../common/Tooltip';
import Modal from '../common/Modal';
import type { useWorkspaces } from '../../hooks/useWorkspaces';
import { useI18n } from '../../i18n/useI18n';
import { isMac } from '../../utils/platform';

interface SidebarHeaderProps {
  store: ReturnType<typeof useWorkspaces>;
}

export default function SidebarHeader({ store }: SidebarHeaderProps) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (modalOpen) {
      setWorkspaceName('');
      setWorkspacePath('');
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [modalOpen]);

  const handleOpenModal = useCallback(() => {
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
    setWorkspaceName('');
    setWorkspacePath('');
  }, []);

  const handleCreate = useCallback(() => {
    const trimmed = workspaceName.trim();
    if (!trimmed) return;
    store.addWorkspaceWithName(trimmed, workspacePath.trim() || undefined);
    handleCloseModal();
  }, [workspaceName, workspacePath, store, handleCloseModal]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      handleCreate();
    }
  }, [handleCreate]);

  const handleCreateRabbit = useCallback(() => {
    // 校验当前选中 workspace 是否仍有效
    const currentValid = store.selectedWorkspaceId
      && store.workspaces.some(w => w.id === store.selectedWorkspaceId);
    // 无效则回退到第一个 workspace；无 workspace 则为 null
    const fallbackId = currentValid
      ? store.selectedWorkspaceId!
      : (store.workspaces[0]?.id ?? null);
    // selectWorkspace 内部：设置 workspaceId + 清除 rabbitId + 切换 main 视图
    store.selectWorkspace(fallbackId);
  }, [store]);

  const canCreate = workspaceName.trim().length > 0;

  return (
    <div className="flex flex-col gap-1 px-3 pt-2 pb-1 select-none">
      <button
        onClick={handleCreateRabbit}
        className="flex w-full h-8 items-center gap-1.5 rounded-md border border-[#E6E6E6] bg-[#FFFFFF] px-2 text-sm text-gray-700 hover:bg-[var(--brand-soft-bg)] hover:text-[var(--brand-primary)] dark:border-gray-700 dark:bg-[#2a2a2a] dark:text-gray-300 dark:hover:bg-[var(--brand-soft-bg)] dark:hover:text-[var(--brand-primary)] transition-colors"
      >
        <Plus size={14} />
        <span className="text-xs text-[#141414] dark:text-gray-100">{t('sidebar.header.createRabbit')}</span>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {isMac ? '⌘ N' : 'Win + N'}
        </span>
      </button>

      <div className="flex items-center mt-2 px-0.5">
        <span className="text-xs text-[#919191] dark:text-gray-400">Rabbits</span>
        <Tooltip content={t('sidebar.header.createWorkspace')} className="ml-auto">
          <button
            className="rounded p-0.5 text-[#919191] dark:text-gray-400 hover:text-[var(--brand-primary)] transition-colors"
            onClick={handleOpenModal}
          >
            <FolderPlus size={14} />
          </button>
        </Tooltip>
      </div>

      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        title={t('sidebar.header.createWorkspace')}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('sidebar.header.workspaceName')}</label>
            <input
              ref={inputRef}
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('sidebar.header.workspaceNamePlaceholder')}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 dark:border-gray-600 dark:bg-[#2a2a2a] dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-blue-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{t('sidebar.header.workspaceDir')}</label>
            <div className="flex gap-2">
              <input
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('sidebar.header.workspaceDirPlaceholder')}
                className="flex-1 min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition-colors placeholder:text-gray-400 focus:border-blue-400 dark:border-gray-600 dark:bg-[#2a2a2a] dark:text-gray-200 dark:placeholder:text-gray-500 dark:focus:border-blue-500"
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await open({
                      directory: true,
                      multiple: false,
                      title: t('sidebar.header.selectWorkspaceDir'),
                    });
                    if (selected) {
                      setWorkspacePath(selected);
                    }
                  } catch {
                    // 用户取消或环境不支持，静默忽略
                  }
                }}
                className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-400 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:border-gray-500 transition-colors"
              >
                {t('common.browse')}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleCloseModal}
              className="rounded-lg px-4 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs text-white transition-colors hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 dark:hover:bg-blue-500 dark:disabled:bg-gray-700 dark:disabled:text-gray-500"
            >
              {t('common.create')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
