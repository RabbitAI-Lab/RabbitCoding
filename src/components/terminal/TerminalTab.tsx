import { useState, useCallback, useEffect } from 'react';
import { Plus, X, Terminal } from 'lucide-react';
import { generateId } from '../../utils/id';
import { useResizable } from '../../hooks/useResizable';
import TerminalView from './TerminalView';
import { DEFAULT_SHELL_LABEL } from './useTerminal';
import type { TerminalSession } from '../../types/terminal';

const MAX_TABS = 10;

interface TerminalTabProps {
  visible?: boolean;
}

/**
 * 多标签终端管理器
 * 支持新建、切换、关闭多个终端 session
 */
export default function TerminalTab({ visible = true }: TerminalTabProps) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fitFn, setFitFn] = useState<(() => void) | null>(null);
  const { width: sidebarWidth, isResizing, handleProps } = useResizable({
    storageKey: 'terminal-sidebar-width',
    defaultWidth: 120,
    minWidth: 120,
    maxWidth: 320,
  });

  const nextTitle = useCallback(() => {
    const count = sessions.length + 1;
    return count === 1 ? DEFAULT_SHELL_LABEL : `${DEFAULT_SHELL_LABEL}-${count}`;
  }, [sessions.length]);

  const addTab = useCallback(() => {
    if (sessions.length >= MAX_TABS) return;
    const id = generateId();
    const session: TerminalSession = {
      id,
      title: nextTitle(),
      createdAt: Date.now(),
    };
    setSessions(prev => [...prev, session]);
    setActiveId(id);
  }, [sessions.length, nextTitle]);

  const closeTab = useCallback((id: string) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const next = prev.filter(s => s.id !== id);

      // 如果关闭的是当前激活的标签，自动切换到相邻标签
      if (id === activeId && next.length > 0) {
        const nextIdx = Math.min(idx, next.length - 1);
        setActiveId(next[nextIdx].id);
      } else if (next.length === 0) {
        setActiveId(null);
      }

      return next;
    });
  }, [activeId]);

  // 当面板重新可见时，触发终端 fit
  useEffect(() => {
    if (visible && fitFn) {
      requestAnimationFrame(() => fitFn());
    }
  }, [visible, fitFn]);

  // 空状态：显示创建提示
  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-300 dark:text-gray-600 p-6">
        <Terminal size={32} />
        <p className="text-xs text-gray-400 dark:text-gray-500">还没有终端会话</p>
        <button
          onClick={addTab}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
        >
          <Plus size={14} />
          <span>新建终端</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* 左侧标签栏 */}
      <div
        className="flex shrink-0 flex-col border-r border-gray-200 bg-white py-1 dark:border-gray-700 dark:bg-[#1e1e1e]"
        style={{ width: sidebarWidth }}
      >
        {/* 新建按钮 - 固定在顶部 */}
        {sessions.length < MAX_TABS && (
          <button
            onClick={addTab}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#646261] hover:text-[#141414] hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <Plus size={12} />
            <span>新建终端</span>
          </button>
        )}
        {sessions.map(session => (
          <div
            key={session.id}
            className={`group flex items-center gap-1.5 px-2.5 py-1.5 text-xs cursor-pointer transition-colors ${
              activeId === session.id
                ? 'bg-[#dfdfdf] text-[#141414] dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:text-gray-500 dark:hover:text-gray-300 dark:hover:bg-gray-800'
            }`}
            onClick={() => setActiveId(session.id)}
          >
            <Terminal size={12} className="shrink-0" />
            <span className="flex-1 truncate">{session.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(session.id);
              }}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 transition-all"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* 分割线拖拽手柄 */}
      <div
        {...handleProps}
        className={`w-1 shrink-0 cursor-col-resize transition-colors bg-transparent hover:bg-blue-500/40 ${
          isResizing ? 'bg-blue-500/40' : ''
        }`}
      />

      {/* 右侧终端内容区 */}
      <div className="flex-1 overflow-hidden relative" style={{ minWidth: 550 }}>
        {sessions.map(session => (
          <div
            key={session.id}
            className="absolute inset-0"
            style={{ visibility: activeId === session.id ? 'visible' : 'hidden' }}
          >
            <TerminalView
              visible={activeId === session.id}
              onFitReady={setFitFn}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
