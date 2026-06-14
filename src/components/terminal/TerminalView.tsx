import { useEffect } from 'react';
import { useTerminal } from './useTerminal';
import { useTheme } from '../../hooks/useTheme';

interface TerminalViewProps {
  cwd?: string;
  visible?: boolean;
  onFitReady?: (fit: () => void) => void;
}

/**
 * 单个终端视图组件
 * 挂载 xterm.js 到 DOM，管理 PTY 生命周期
 */
export default function TerminalView({ cwd, visible = true, onFitReady }: TerminalViewProps) {
  const { resolvedTheme } = useTheme();
  const { containerRef, ready, error, fit } = useTerminal({ cwd, visible, resolvedTheme });

  // 将 fit 函数传递给父组件
  useEffect(() => {
    if (ready && onFitReady) {
      onFitReady(fit);
    }
  }, [ready, fit, onFitReady]);

  return (
    <div className="h-full w-full relative p-1.5">
      <div
        ref={containerRef}
        className="h-full w-full"
      />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500">
            <div className="h-3 w-3 rounded-full border-2 border-gray-300 border-t-transparent dark:border-gray-600 animate-spin" />
            <span className="text-xs">启动终端中...</span>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-xs text-red-500 dark:text-red-400">{error}</div>
        </div>
      )}
    </div>
  );
}
