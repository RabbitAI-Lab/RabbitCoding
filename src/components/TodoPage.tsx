import { useState, useCallback, useRef } from 'react';
import { ListTodo, Plus, ChevronDown, ChevronRight, CheckCheck } from 'lucide-react';
import { useTodos } from '../hooks/useTodos';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useI18n } from '../i18n/useI18n';
import Tooltip from './common/Tooltip';
import TodoItemRow, { type DropTarget } from './todo/TodoItemRow';

export default function TodoPage() {
  const { t } = useI18n();
  const {
    pendingTodos,
    doneTodos,
    addTodo,
    toggleTodo,
    updateTodo,
    deleteTodo,
    reorderTodo,
    clearDone,
  } = useTodos();

  // Done 区折叠状态
  const [doneCollapsed, setDoneCollapsed] = useLocalStorage('todo-done-collapsed', false);

  // 输入框
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  // 拖拽状态
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const handleDragStart = useCallback((id: string) => {
    setDraggedId(id);
  }, []);

  const handleDragOverItem = useCallback((id: string, before: boolean) => {
    setDropTarget({ id, before });
  }, []);

  const handleDrop = useCallback((targetId: string) => {
    if (draggedId && draggedId !== targetId && dropTarget) {
      reorderTodo(draggedId, targetId, dropTarget.before);
    }
    setDraggedId(null);
    setDropTarget(null);
  }, [draggedId, dropTarget, reorderTodo]);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDropTarget(null);
  }, []);

  // 输入框提交
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      const val = inputValue.trim();
      if (val) {
        addTodo(val);
        setInputValue('');
      }
    }
  }, [inputValue, addTodo]);

  const totalCount = pendingTodos.length + doneTodos.length;

  const renderTodoRow = (todo: typeof pendingTodos[0]) => (
    <TodoItemRow
      key={todo.id}
      todo={todo}
      isDragged={draggedId === todo.id}
      dropTarget={dropTarget}
      onToggle={() => toggleTodo(todo.id)}
      onUpdate={(text) => updateTodo(todo.id, text)}
      onDelete={() => deleteTodo(todo.id)}
      onDragStart={handleDragStart}
      onDragOverItem={handleDragOverItem}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
    />
  );

  return (
    <main className="flex flex-1 flex-col overflow-hidden rounded-tl-xl rounded-bl-xl border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-[#1e1e1e]">
      {/* 标题栏 */}
      <div data-tauri-drag-region className="flex h-[42px] shrink-0 items-center pl-4">
        <span data-tauri-drag-region className="text-sm font-medium text-[#333333] dark:text-gray-100 flex items-center gap-1.5">
          <ListTodo size={15} className="text-[#646261] dark:text-gray-400" />
          {t('todo.title')}
        </span>
      </div>
      <div className="h-px bg-gray-200 dark:bg-gray-700" />

      {/* 滚动内容区 */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-8 py-8">
          {/* 新增输入框 */}
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-[#2a2a2a]">
            <Plus size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={t('todo.addPlaceholder')}
              className="flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-200 dark:placeholder:text-gray-500"
            />
          </div>

          {/* 空状态 */}
          {totalCount === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ListTodo size={40} className="text-gray-200 dark:text-gray-700 mb-3" />
              <p className="text-sm text-gray-400 dark:text-gray-500">{t('todo.empty')}</p>
            </div>
          )}

          {/* Pending 区 */}
          {pendingTodos.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                {t('todo.pending')}
                <span className="rounded-full bg-blue-100 px-1.5 text-[10px] font-semibold text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
                  {pendingTodos.length}
                </span>
              </h2>
              <div className="flex flex-col gap-0.5">
                {pendingTodos.map(renderTodoRow)}
              </div>
            </div>
          )}

          {/* Done 区 */}
          {doneTodos.length > 0 && (
            <div className="mt-6">
              {/* 折叠标题 */}
              <div className="group mb-2 flex items-center gap-2">
                <button
                  className="flex h-4 w-4 items-center justify-center text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                  onClick={() => setDoneCollapsed(!doneCollapsed)}
                >
                  {doneCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                <span className="flex-1 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  {t('todo.done')} ({doneTodos.length})
                </span>
                <Tooltip content={t('todo.clearCompleted')}>
                  <button
                    className="flex h-4 w-4 items-center justify-center rounded text-gray-400 opacity-0 hover:text-[#EC5B56] group-hover:opacity-100 dark:text-gray-500 transition-colors"
                    onClick={clearDone}
                  >
                    <CheckCheck size={13} />
                  </button>
                </Tooltip>
              </div>
              {!doneCollapsed && (
                <div className="flex flex-col gap-0.5">
                  {doneTodos.map(renderTodoRow)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
