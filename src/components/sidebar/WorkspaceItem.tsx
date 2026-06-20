import { useRef, useEffect, useState, useCallback } from 'react';
import { Folder, ChevronRight, ChevronDown, Plus, MoreHorizontal, BookOpen, Trash2 } from 'lucide-react';
import type { Workspace } from '../../types';
import RabbitItem from './RabbitItem';
import AddRabbitForm from './AddRabbitForm';
import ContextMenu from '../common/ContextMenu';
import Tooltip from '../common/Tooltip';
import type { ContextMenuAction } from '../../types';
import { useI18n } from '../../i18n/useI18n';

interface WorkspaceItemProps {
  workspace: Workspace;
  isSelected: boolean;
  isEditing: boolean;
  isAddingRabbit: boolean;
  selectedRabbitId: string | null;
  editingRabbitId: string | null;
  onSelect: () => void;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onStartAddRabbit: () => void;
  onAddRabbit: (title: string) => void;
  onCancelAddRabbit: () => void;
  onRenameRabbit: (rabbitId: string, name: string) => void;
  onDeleteRabbit: (rabbitId: string) => void;
  onSelectRabbit: (rabbitId: string) => void;
  onToggleRabbitComplete: (rabbitId: string) => void;
  onStartEditRabbit: (rabbitId: string) => void;
  onTogglePin: (rabbitId: string) => void;
  onOpenKnowledgeBase: () => void;
  // 拖拽视觉状态（拖拽逻辑由外层处理）
  isDragging?: boolean;
  isDragOver?: boolean;
  dragOverPosition?: 'before' | 'after';
  isDragDisabled?: boolean;
}

const MAX_VISIBLE_RABBITS = 5;

export default function WorkspaceItem(props: WorkspaceItemProps) {
  const { t } = useI18n();
  const {
    workspace,
    isEditing,
    isAddingRabbit,
    selectedRabbitId,
    editingRabbitId,
    onToggleCollapse,
    onSelect,
    onRename,
    onDelete,
    onStartEdit,
    onEndEdit,
    onStartAddRabbit,
    onAddRabbit,
    onCancelAddRabbit,
    onRenameRabbit,
    onDeleteRabbit,
    onSelectRabbit,
    onToggleRabbitComplete,
    onStartEditRabbit,
    onTogglePin,
    onOpenKnowledgeBase,
    isDragging,
    isDragOver,
    dragOverPosition,
  } = props;
  const editRef = useRef<HTMLInputElement>(null);
  const [editValue, setEditValue] = useState(workspace.name);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropdownMenu, setDropdownMenu] = useState<{ x: number; y: number } | null>(null);
  const [showAllRabbits, setShowAllRabbits] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setEditValue(workspace.name);
      requestAnimationFrame(() => {
        editRef.current?.focus();
        editRef.current?.select();
      });
    }
  }, [isEditing, workspace.name]);

  const dropdownRef = useRef<HTMLDivElement>(null);

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

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      const trimmed = editValue.trim();
      if (trimmed) {
        onRename(trimmed);
      } else {
        onEndEdit();
      }
    } else if (e.key === 'Escape') {
      setEditValue(workspace.name);
      onEndEdit();
    }
  }, [editValue, onRename, onEndEdit, workspace.name]);

  const handleEditBlur = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== workspace.name) {
      onRename(trimmed);
    } else if (!trimmed) {
      if (!workspace.name) {
        onRename(t('common.unnamedWorkspace'));
      }
      onEndEdit();
    } else {
      onEndEdit();
    }
  }, [editValue, onRename, onEndEdit, workspace.name]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const contextMenuItems: ContextMenuAction[] = [
    { label: t('sidebar.workspaceItem.rename'), action: () => { onStartEdit(); setContextMenu(null); } },
    { label: t('sidebar.workspaceItem.createRabbit'), action: () => { onToggleCollapse(); onStartAddRabbit(); setContextMenu(null); }, dividerBelow: true },
    { label: t('sidebar.workspaceItem.deleteWorkspace'), action: () => { onDelete(); setContextMenu(null); }, danger: true },
  ];

  const handleIconClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse();
  }, [onToggleCollapse]);

  const handleDropdownClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropdownMenu({ x: rect.left, y: rect.bottom + 4 });
  }, []);

  const dropdownMenuItems: ContextMenuAction[] = [
    { label: t('sidebar.workspaceItem.knowledgeBase'), action: () => { setDropdownMenu(null); onOpenKnowledgeBase(); }, icon: 'knowledgeBase' },
    { label: t('sidebar.workspaceItem.deleteWorkspace'), action: () => { onDelete(); setDropdownMenu(null); }, danger: true, icon: 'delete' },
  ];

  const handleAddClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (workspace.collapsed) {
      onToggleCollapse();
    }
    onSelect();
  }, [workspace.collapsed, onToggleCollapse, onSelect]);

  // 排序：pinned优先，然后按创建时间倒序（新创建的排前面）
  const sortedRabbits = [...workspace.rabbits].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.createdAt - a.createdAt;
  });

  const visibleRabbits = showAllRabbits ? sortedRabbits : sortedRabbits.slice(0, MAX_VISIBLE_RABBITS);
  const hasMoreRabbits = sortedRabbits.length > MAX_VISIBLE_RABBITS;

  const dragOverLineClass = isDragOver
    ? dragOverPosition === 'before'
      ? 'border-t-2 border-[var(--brand-primary)]'
      : 'border-b-2 border-[var(--brand-primary)]'
    : '';

  return (
    <div
      className={`mb-0.5 relative ${dragOverLineClass} ${isDragging ? 'opacity-40' : 'opacity-100'}`}
      style={isDragging ? { pointerEvents: 'none' } : undefined}
    >
      <div
        className="group flex items-center gap-1 rounded-md px-0 py-1.5 cursor-pointer text-gray-700 dark:text-gray-300"
        onClick={() => { onToggleCollapse(); }}
        onContextMenu={handleContextMenu}
      >
        {/* Icon area: folder by default, chevron on hover */}
        <button
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
          onClick={handleIconClick}
        >
          <Folder size={13} className="text-gray-500 dark:text-gray-400 block group-hover:hidden" />
          {workspace.collapsed ? (
            <ChevronRight size={13} className="text-gray-500 dark:text-gray-400 hidden group-hover:block" />
          ) : (
            <ChevronDown size={13} className="text-gray-500 dark:text-gray-400 hidden group-hover:block" />
          )}
        </button>

        {/* Name or edit input */}
        {isEditing ? (
          <input
            ref={editRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={handleEditBlur}
            className="flex-1 rounded border border-blue-400 bg-white dark:bg-[#2a2a2a] px-1 py-0 text-sm outline-none"
            placeholder={t('sidebar.header.workspaceName')}
          />
        ) : (
          <span className="flex-1 truncate text-xs text-[#919191] dark:text-gray-400">
            {workspace.name || t('common.unnamedWorkspace')}
          </span>
        )}

        {/* Action buttons (visible on hover) */}
        {!isEditing && (
          <div className="flex shrink-0 justify-end gap-0.5">
            <Tooltip content={t('sidebar.workspaceItem.knowledgeBase')}>
              <button
                className="flex items-center justify-center rounded p-0.5 text-gray-400 hover:text-[var(--brand-primary)] opacity-0 group-hover:opacity-100"
                onClick={(e) => { e.stopPropagation(); onOpenKnowledgeBase(); }}
              >
                <BookOpen size={12} />
              </button>
            </Tooltip>
            <Tooltip content={t('common.more')}>
              <button
                className="flex items-center justify-center rounded p-0.5 text-gray-400 hover:text-[var(--brand-primary)] opacity-0 group-hover:opacity-100"
                onClick={handleDropdownClick}
              >
                <MoreHorizontal size={12} />
              </button>
            </Tooltip>
            <Tooltip content={t('sidebar.workspaceItem.createRabbit')}>
              <button
                className="flex items-center justify-center rounded p-0.5 text-gray-400 hover:text-[var(--brand-primary)] opacity-0 group-hover:opacity-100"
                onClick={handleAddClick}
              >
                <Plus size={12} />
              </button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Rabbits list (visible when expanded) - 无竖线 */}
      {!workspace.collapsed && (
        <div className="mb-3">
          {sortedRabbits.length === 0 && !isAddingRabbit && (
            <span className="block ml-5 py-1.5 text-xs text-gray-400 dark:text-gray-500">{t('sidebar.workspaceItem.noRabbits')}</span>
          )}
          {isAddingRabbit && (
            <AddRabbitForm
              onSubmit={(title) => { onAddRabbit(title); }}
              onCancel={onCancelAddRabbit}
            />
          )}
          {visibleRabbits.map(rabbit => (
            <RabbitItem
              key={rabbit.id}
              rabbit={rabbit}
              isSelected={selectedRabbitId === rabbit.id}
              isEditing={editingRabbitId === rabbit.id}
              onSelect={() => onSelectRabbit(rabbit.id)}
              onToggleComplete={() => onToggleRabbitComplete(rabbit.id)}
              onRename={(name) => onRenameRabbit(rabbit.id, name)}
              onDelete={() => onDeleteRabbit(rabbit.id)}
              onStartEdit={() => onStartEditRabbit(rabbit.id)}
              onEndEdit={onEndEdit}
              onTogglePin={() => onTogglePin(rabbit.id)}
            />
          ))}
          {hasMoreRabbits && !showAllRabbits && (
            <button
              className="flex items-center gap-1 rounded-md px-0 py-1.5 text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setShowAllRabbits(true);
              }}
            >
              <MoreHorizontal size={12} />
              <span>{t('sidebar.workspaceItem.showMore')}</span>
            </button>
          )}
        </div>
      )}

      {/* Dropdown menu */}
      {dropdownMenu && (
        <div
          ref={dropdownRef}
          className="fixed z-50 w-fit rounded-lg border border-gray-200 bg-[#F3F3F3] py-1 shadow-lg dark:border-gray-700 dark:bg-[#2a2a2a]"
          style={{ left: dropdownMenu.x, top: dropdownMenu.y }}
        >
          {dropdownMenuItems.map((item, index) => (
            <div key={index}>
              {item.danger && (
                <div className="mx-2 my-1 border-t border-gray-300 dark:border-gray-600" />
              )}
              <button
                className={`flex w-full items-center justify-start gap-2 px-3 py-1.5 text-xs ${
                  item.danger
                    ? 'text-[#EC5B56] hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                    : 'text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  item.action();
                }}
              >
                {item.icon === 'knowledgeBase' && <BookOpen size={13} />}
                {item.icon === 'delete' && <Trash2 size={13} />}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
