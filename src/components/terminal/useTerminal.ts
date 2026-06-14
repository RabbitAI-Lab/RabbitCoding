import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { spawn, type IPty } from 'tauri-pty';
import { terminalTheme, terminalThemeDark } from './terminal-theme';
import type { ResolvedTheme } from '../../hooks/useTheme';
import { isWindows } from '../../utils/platform';

/**
 * 根据平台选择默认 shell
 */
export const DEFAULT_SHELL = isWindows ? 'powershell.exe' : '/bin/zsh';
export const DEFAULT_SHELL_LABEL = isWindows ? 'PowerShell' : 'zsh';

export interface UseTerminalOptions {
  cwd?: string;
  visible?: boolean;
  resolvedTheme?: ResolvedTheme;
}

export interface UseTerminalReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  error: string | null;
  terminal: Terminal | null;
  fit: () => void;
}

/**
 * 管理单个终端实例（xterm.js + PTY）的完整生命周期
 */
export function useTerminal(options: UseTerminalOptions = {}): UseTerminalReturn {
  const { cwd, visible = true, resolvedTheme = 'light' } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const ptyRef = useRef<IPty | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fit = useCallback(() => {
    const fitAddon = fitAddonRef.current;
    const term = terminalRef.current;
    const pty = ptyRef.current;
    const container = containerRef.current;
    if (!fitAddon || !term || !pty || !container) return;

    try {
      fitAddon.fit();
      pty.resize(term.cols, term.rows);
    } catch {
      // fitAddon.fit() 在容器 display:none 时会抛异常，忽略即可
    }
  }, []);

  // 初始化终端
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 5000,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: resolvedTheme === 'dark' ? terminalThemeDark : terminalTheme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    term.open(container);

    // 尝试加载 Canvas 渲染器（失败则回退到 DOM 渲染）
    try {
      term.loadAddon(new CanvasAddon());
    } catch {
      // Canvas addon 加载失败，使用默认 DOM 渲染
    }

    // 创建 PTY
    let pty: IPty;
    try {
      pty = spawn(DEFAULT_SHELL, [], {
        cols: term.cols,
        rows: term.rows,
        cwd: cwd || undefined,
        env: {
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
        },
      });
      ptyRef.current = pty;
    } catch (e) {
      setError(`终端启动失败: ${e}`);
      term.dispose();
      return;
    }

    // 双向数据流
    pty.onData((data: Uint8Array) => {
      term.write(data);
    });

    term.onData((data: string) => {
      pty.write(data);
    });

    pty.onExit(() => {
      term.write('\r\n\x1b[90m[进程已退出]\x1b[0m\r\n');
    });

    setReady(true);

    // 延迟一帧再 fit，确保容器已有尺寸
    requestAnimationFrame(() => {
      fit();
    });

    return () => {
      // 清理 resize timer
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
      // 清理 resize observer
      resizeObserverRef.current?.disconnect();
      // 杀掉 PTY 进程
      try {
        pty.kill();
      } catch {
        // ignore
      }
      ptyRef.current = null;
      // 释放 xterm 实例
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setReady(false);
    };
  }, [cwd]); // 仅在 cwd 变化时重新初始化

  // 主题变化时动态更新终端主题
  useEffect(() => {
    const term = terminalRef.current;
    if (!term) return;
    term.options.theme = resolvedTheme === 'dark' ? terminalThemeDark : terminalTheme;
  }, [resolvedTheme]);

  // 监听容器尺寸变化（防抖 200ms）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
      resizeTimerRef.current = setTimeout(() => {
        fit();
      }, 200);
    });

    observer.observe(container);
    resizeObserverRef.current = observer;

    return () => {
      observer.disconnect();
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current);
      }
    };
  }, [fit]);

  // 当 visible 变为 true 时，重新 fit 终端
  useEffect(() => {
    if (visible && ready) {
      requestAnimationFrame(() => {
        fit();
      });
    }
  }, [visible, ready, fit]);

  return {
    containerRef,
    ready,
    error,
    terminal: terminalRef.current,
    fit,
  };
}
