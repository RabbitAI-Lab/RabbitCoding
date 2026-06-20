import { useRef, useEffect, useState, useCallback } from 'react';
import { Pin, MoreHorizontal, Pencil, PinOff, Trash2, Loader2 } from 'lucide-react';
import type { Rabbit } from '../../types';
import { formatRelativeTime } from '../../utils/time';
import { useI18n } from '../../i18n/useI18n';

interface RabbitItemProps {
  rabbit: Rabbit;
  isSelected: boolean;
  isEditing: boolean;
  onSelect: () => void;
  onToggleComplete: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onTogglePin: () => void;
}

export default function RabbitItem({
  rabbit,
  isSelected,
  isEditing,
  onSelect,
  onRename,
  onDelete,
  onStartEdit,
  onEndEdit,
  onTogglePin,
}: RabbitItemProps) {
  const { t, language } = useI18n();
  const editRef = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState(rabbit.title);
  const [dropdownMenu, setDropdownMenu] = useState<{ x: number; y: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing) {
      setEditValue(rabbit.title);
      requestAnimationFrame(() => {
        editRef.current?.focus();
        editRef.current?.select();
      });
    }
  }, [isEditing, rabbit.title]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = editValue.trim();
      if (trimmed) {
        onRename(trimmed);
      } else {
        onEndEdit();
      }
    } else if (e.key === 'Escape') {
      setEditValue(rabbit.title);
      onEndEdit();
    }
  }, [editValue, onRename, onEndEdit, rabbit.title]);

  const handleEditBlur = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== rabbit.title) {
      onRename(trimmed);
    } else {
      onEndEdit();
    }
  }, [editValue, onRename, onEndEdit, rabbit.title]);

  const handlePinClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePin();
  }, [onTogglePin]);

  const handleDropdownClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropdownMenu({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  useEffect(() => {
    if (!dropdownMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownMenu]);

  return (
    <div
      className={`group flex items-center gap-1 rounded-md -mx-1.5 px-1.5 h-[30px] cursor-pointer select-none ${
        isSelected ? 'bg-[#e7e7e3] text-[#141414] dark:bg-[#292926] dark:text-gray-100' : 'hover:bg-gray-200/40 text-[#646261] hover:text-[#141414] dark:hover:bg-gray-700/40 dark:text-gray-400 dark:hover:text-white'
      }`}
      onClick={onSelect}
    >
      {/* 圆点：running时显示转圈loading，否则pinned蓝色/灰色；hover时替换为Pin图标 */}
      <button
        className="flex h-4 w-4 shrink-0 items-center justify-center"
        onClick={handlePinClick}
      >
        {rabbit.status === 'running' ? (
          <Loader2 size={11} className="text-[#E8702A] dark:text-[#F5824C] animate-spin" />
        ) : (
          <>
            <div className={`h-1.5 w-1.5 rounded-full ${rabbit.pinned ? 'bg-blue-500' : rabbit.completed ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} group-hover:hidden`} />
            <Pin size={11} className="text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 hidden group-hover:block" />
          </>
        )}
      </button>

      {isEditing ? (
        <input
          ref={editRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={handleEditBlur}
          className="flex-1 rounded border border-blue-400 bg-white dark:bg-[#2a2a2a] px-1 py-0 text-xs outline-none"
        />
      ) : (
        <span className={`flex-1 truncate text-xs ${rabbit.completed ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}>
          {rabbit.title}
        </span>
      )}

      {/* 默认显示时间，hover 时显示 ... 按钮 */}
      {!isEditing && (
        <div className="relative shrink-0 h-4 flex items-center">
          <span className="whitespace-nowrap text-[10px] text-gray-400 group-hover:opacity-0 dark:text-gray-500">
            {formatRelativeTime(rabbit.createdAt, language)}
          </span>
          <button
            className="absolute right-0 flex items-center justify-center rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100"
            onClick={handleDropdownClick}
          >
            <MoreHorizontal size={14} />
          </button>
        </div>
      )}

      {/* Dropdown 菜单 */}
      {dropdownMenu && (
        <div
          ref={dropdownRef}
          className="fixed z-50 w-fit rounded-lg border border-gray-200 bg-[#F3F3F3] py-1 shadow-lg dark:border-gray-700 dark:bg-[#2a2a2a]"
          style={{ left: dropdownMenu.x, top: dropdownMenu.y }}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={(e) => { e.stopPropagation(); onStartEdit(); setDropdownMenu(null); }}
          >
            <Pencil size={13} />
            {t('sidebar.rabbitItem.rename')}
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700"
            onClick={(e) => { e.stopPropagation(); onTogglePin(); setDropdownMenu(null); }}
          >
            {rabbit.pinned ? <PinOff size={13} /> : <Pin size={13} />}
            {rabbit.pinned ? t('sidebar.rabbitItem.unpin') : t('sidebar.rabbitItem.pin')}
          </button>
          <div className="mx-2 my-1 border-t border-gray-300 dark:border-gray-600" />
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#EC5B56] hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            onClick={(e) => { e.stopPropagation(); onDelete(); setDropdownMenu(null); }}
          >
            <Trash2 size={13} />
            {t('common.delete')}
          </button>
        </div>
      )}

    </div>
  );
}
