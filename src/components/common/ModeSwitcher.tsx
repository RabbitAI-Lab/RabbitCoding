import { useRef, useState, useEffect, useCallback } from 'react';
import { ChevronDown, Check, GitBranch } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';

export type WorktreeMode = 'local' | 'worktree';

interface ModeSwitcherProps {
  mode: WorktreeMode;
  onChange: (mode: WorktreeMode) => void;
  /** 是否有 repos（无 repos 时禁用 worktree 选项） */
  hasRepos: boolean;
}

export default function ModeSwitcher({ mode, onChange, hasRepos }: ModeSwitcherProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
      triggerRef.current && !triggerRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, handleClickOutside]);

  const options: { value: WorktreeMode; label: string; icon: typeof GitBranch; disabled?: boolean }[] = [
    { value: 'local', label: t('modeSwitcher.local'), icon: GitBranch },
    { value: 'worktree', label: t('modeSwitcher.worktree'), icon: GitBranch, disabled: !hasRepos },
  ];

  const current = options.find(o => o.value === mode) ?? options[0];
  const CurrentIcon = current.icon;

  const handleSelect = (value: WorktreeMode) => {
    const opt = options.find(o => o.value === value);
    if (opt?.disabled) return;
    onChange(value);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(prev => !prev)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#646464] hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-md transition-colors"
      >
        <CurrentIcon size={13} />
        <span>{current.label}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          ref={dropdownRef}
          className="fixed z-50 min-w-[160px] rounded-lg border border-gray-200 bg-[#F3F3F3] shadow-lg dark:border-gray-700 dark:bg-[#2a2a2a]"
          style={{
            left: triggerRef.current
              ? triggerRef.current.getBoundingClientRect().left
              : 0,
            top: triggerRef.current
              ? triggerRef.current.getBoundingClientRect().bottom + 4
              : 0,
          }}
        >
          <div className="py-0.5">
            {options.map(opt => {
              const Icon = opt.icon;
              const isActive = opt.value === mode;
              return (
                <div
                  key={opt.value}
                  onClick={() => handleSelect(opt.value)}
                  className={`flex items-center justify-between px-2.5 py-1 text-xs cursor-pointer rounded transition-colors ${
                    opt.disabled
                      ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                      : isActive
                        ? 'bg-[#DFDFDF] text-[#141414] dark:bg-gray-700 dark:text-gray-100 font-medium'
                        : 'text-[#141414] hover:bg-[#E3E3E3] dark:text-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={13} className={opt.disabled ? 'text-gray-300 dark:text-gray-600' : 'text-gray-500 dark:text-gray-400'} />
                    <span>{opt.label}</span>
                  </div>
                  {isActive && <Check size={12} className="text-gray-500 dark:text-gray-400" />}
                </div>
              );
            })}
          </div>
          {!hasRepos && (
            <div className="px-2.5 py-1 text-[10px] text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700">
              {t('modeSwitcher.worktreeNoRepos')}
            </div>
          )}
        </div>
      )}
    </>
  );
}
