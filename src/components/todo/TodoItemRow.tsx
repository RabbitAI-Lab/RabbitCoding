import { useRef, useState, useEffect, useCallback } from 'react';
import { Circle, CheckCircle2, Trash2, GripVertical } from 'lucide-react';
import type { SidebarTodo } from '../../types';

export interface DropTarget {
  id: string;
  before: boolean;
}

interface TodoItemRowProps {
  todo: SidebarTodo;
  isDragged: boolean;
  dropTarget: DropTarget | null;
  onToggle: () => void;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  onDragStart: (id: string) => void;
  onDragOverItem: (id: string, before: boolean) => void;
  onDrop: (targetId: string) => void;
  onDragEnd: () => void;
}

export default function TodoItemRow({
  todo,
  isDragged,
  dropTarget,
  onToggle,
  onUpdate,
  onDelete,
  onDragStart,
  onDragOverItem,
  onDrop,
  onDragEnd,
}: TodoItemRowProps) {
  const editRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(todo.text);

  useEffect(() => {
    if (isEditing) {
      setEditValue(todo.text);
      requestAnimationFrame(() => {
        editRef.current?.focus();
        editRef.current?.select();
      });
    }
  }, [isEditing, todo.text]);

  const commitEdit = useCallback(() => {
    onUpdate(editValue);
    setIsEditing(false);
  }, [editValue, onUpdate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      commitEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
    }
  }, [commitEdit]);

  // 拖拽：根据鼠标 Y 相对中点决定 before/after
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const isAboveMid = e.clientY < rect.top + rect.height / 2;
    onDragOverItem(todo.id, isAboveMid);
  }, [todo.id, onDragOverItem]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDrop(todo.id);
  }, [todo.id, onDrop]);

  const showLineBefore = dropTarget?.id === todo.id && dropTarget.before;
  const showLineAfter = dropTarget?.id === todo.id && !dropTarget.before;

  return (
    <div
      draggable={!isEditing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(todo.id);
      }}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={onDragEnd}
      className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
        isDragged ? 'opacity-40' : ''
      } ${todo.done ? '' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
      onDoubleClick={() => !todo.done && setIsEditing(true)}
    >
      {/* 上方拖放指示线 */}
      {showLineBefore && (
        <div className="absolute inset-x-1 top-0 h-0.5 rounded-full bg-blue-500" />
      )}

      {/* 拖拽手柄 */}
      <div className="flex h-4 w-4 shrink-0 cursor-grab items-center justify-center text-gray-300 opacity-0 group-hover:opacity-100 active:cursor-grabbing dark:text-gray-600">
        <GripVertical size={14} />
      </div>

      {/* 勾选按钮 */}
      <button
        className="flex h-5 w-5 shrink-0 items-center justify-center"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        {todo.done ? (
          <CheckCircle2 size={16} className="text-blue-500 dark:text-blue-400" />
        ) : (
          <Circle size={16} className="text-gray-300 hover:text-blue-500 dark:text-gray-600 dark:hover:text-blue-400 transition-colors" />
        )}
      </button>

      {/* 文本 / 编辑输入框 */}
      {isEditing ? (
        <input
          ref={editRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          className="flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-sm text-gray-700 outline-none dark:bg-[#2a2a2a] dark:text-gray-200"
        />
      ) : (
        <span className={`flex-1 truncate text-sm ${
          todo.done
            ? 'text-gray-400 line-through dark:text-gray-500'
            : 'text-gray-700 dark:text-gray-300'
        }`}>
          {todo.text}
        </span>
      )}

      {/* hover 删除按钮 */}
      {!isEditing && (
        <button
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-0 hover:text-[#EC5B56] group-hover:opacity-100 dark:text-gray-500 transition-colors"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 size={14} />
        </button>
      )}

      {/* 下方拖放指示线 */}
      {showLineAfter && (
        <div className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-blue-500" />
      )}
    </div>
  );
}
