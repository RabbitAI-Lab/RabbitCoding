import { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, FolderOpen, Folder, Search } from 'lucide-react';
import type { Workspace } from '../../types';
import { useI18n } from '../../i18n/useI18n';

interface WorkspaceSwitcherProps {
  workspaces: Workspace[];
  selectedWorkspaceId: string;
  onSelect: (id: string) => void;
}

export default function WorkspaceSwitcher({ workspaces, selectedWorkspaceId, onSelect }: WorkspaceSwitcherProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = workspaces.find(w => w.id === selectedWorkspaceId);
  const currentName = current?.name || t('common.unnamedWorkspace');

  const filtered = workspaces.filter(w =>
    (w.name || t('common.unnamedWorkspace')).toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
    setSearch('');
  };

  // 打开时自动聚焦搜索框
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // 点击外部关闭
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
      triggerRef.current && !triggerRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
      setSearch('');
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, handleClickOutside]);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#646464] hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md transition-colors"
      >
        <span className="text-[#646464] dark:text-gray-400">{t('workspaceSwitcher.currentWorkspace')}</span>
        <FolderOpen size={13} />
        <span>{currentName}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 min-w-[200px] rounded-lg border border-gray-200 bg-[#F3F3F3] shadow-lg dark:border-gray-700 dark:bg-[#2a2a2a]"
          style={{
            left: triggerRef.current
              ? triggerRef.current.getBoundingClientRect().left
              : 0,
            top: triggerRef.current
              ? triggerRef.current.getBoundingClientRect().bottom + 4
              : 0,
          }}
        >
          {/* 搜索框 */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <Search size={12} className="text-gray-400 shrink-0 dark:text-gray-500" />
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('workspaceSwitcher.searchPlaceholder')}
              className="flex-1 text-xs text-[#141414] placeholder-gray-400 outline-none bg-transparent dark:text-gray-100 dark:placeholder-gray-500"
            />
          </div>
          <div className="h-px bg-gray-200 dark:bg-gray-700" />
          {/* 列表 */}
          <div className="max-h-[180px] overflow-y-auto py-0.5">
            {filtered.length > 0 ? (
              filtered.map(workspace => (
                <div
                  key={workspace.id}
                  onClick={() => handleSelect(workspace.id)}
                  className={`flex items-center justify-between px-2.5 py-1 text-xs cursor-pointer rounded transition-colors ${
                    workspace.id === selectedWorkspaceId
                      ? 'bg-[#DFDFDF] text-[#141414] dark:bg-gray-700 dark:text-gray-100 font-medium'
                      : 'text-[#141414] hover:bg-[#E3E3E3] dark:text-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Folder size={13} className="text-gray-500 dark:text-gray-400" />
                    <span>{workspace.name || t('common.unnamedWorkspace')}</span>
                  </div>
                  {workspace.id === selectedWorkspaceId && <Check size={12} className="text-gray-500 dark:text-gray-400" />}
                </div>
              ))
            ) : (
              <p className="px-2.5 py-1.5 text-[11px] text-gray-400 dark:text-gray-500">{t('workspaceSwitcher.noMatch')}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
