import { useCallback, useMemo } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { generateId } from '../utils/id';
import type { SidebarTodo } from '../types';

const STORAGE_KEY = 'sidebar-todos';

export function useTodos() {
  const [todos, setTodos] = useLocalStorage<SidebarTodo[]>(STORAGE_KEY, []);

  /** 新建待办（插入到 pending 区末尾） */
  const addTodo = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const newTodo: SidebarTodo = {
      id: generateId(),
      text: trimmed,
      done: false,
      createdAt: Date.now(),
    };
    setTodos(prev => {
      const firstDoneIdx = prev.findIndex(t => t.done);
      if (firstDoneIdx === -1) return [...prev, newTodo];
      return [...prev.slice(0, firstDoneIdx), newTodo, ...prev.slice(firstDoneIdx)];
    });
  }, [setTodos]);

  /** 切换 done 状态，自动迁移分区 */
  const toggleTodo = useCallback((id: string) => {
    setTodos(prev => {
      const idx = prev.findIndex(t => t.id === id);
      if (idx === -1) return prev;
      const toggled: SidebarTodo = { ...prev[idx], done: !prev[idx].done };
      const rest = prev.filter(t => t.id !== id);
      if (toggled.done) {
        return [...rest, toggled];
      } else {
        const firstDoneIdx = rest.findIndex(t => t.done);
        if (firstDoneIdx === -1) return [...rest, toggled];
        return [...rest.slice(0, firstDoneIdx), toggled, ...rest.slice(firstDoneIdx)];
      }
    });
  }, [setTodos]);

  /** 更新文本（空文本 = 删除） */
  const updateTodo = useCallback((id: string, text: string) => {
    const trimmed = text.trim();
    setTodos(prev => {
      if (!trimmed) return prev.filter(t => t.id !== id);
      return prev.map(t => t.id === id ? { ...t, text: trimmed } : t);
    });
  }, [setTodos]);

  /** 删除 */
  const deleteTodo = useCallback((id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  }, [setTodos]);

  /** 拖拽排序（仅同区内排序） */
  const reorderTodo = useCallback((sourceId: string, targetId: string, insertBefore: boolean) => {
    setTodos(prev => {
      const sourceIdx = prev.findIndex(t => t.id === sourceId);
      const targetIdx = prev.findIndex(t => t.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return prev;
      // 仅允许同区排序
      if (prev[sourceIdx].done !== prev[targetIdx].done) return prev;

      const next = [...prev];
      const [removed] = next.splice(sourceIdx, 1);
      // 移除后重新定位 target
      const newTargetIdx = next.findIndex(t => t.id === targetId);
      next.splice(insertBefore ? newTargetIdx : newTargetIdx + 1, 0, removed);
      return next;
    });
  }, [setTodos]);

  /** 清除所有已完成 */
  const clearDone = useCallback(() => {
    setTodos(prev => prev.filter(t => !t.done));
  }, [setTodos]);

  const pendingTodos = useMemo(() => todos.filter(t => !t.done), [todos]);
  const doneTodos = useMemo(() => todos.filter(t => t.done), [todos]);

  return {
    todos,
    pendingTodos,
    doneTodos,
    addTodo,
    toggleTodo,
    updateTodo,
    deleteTodo,
    reorderTodo,
    clearDone,
  };
}
