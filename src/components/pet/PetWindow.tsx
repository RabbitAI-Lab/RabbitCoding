import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import type { PetTask, PetTasksPayload } from './types';

function TaskRow({ task }: { task: PetTask }) {
  const shouldScroll = task.output.length > 36;

  return (
    <div className="pet-task-row">
      <span className="pet-task-dot" />
      <span className="pet-task-title" title={task.title}>{task.title}</span>
      <span className="pet-task-output" title={task.output}>
        {shouldScroll ? (
          <span key={task.output} className="pet-task-marquee">
            <span>{task.output}</span>
            <span>{task.output}</span>
          </span>
        ) : (
          <span className="pet-task-static">{task.output}</span>
        )}
      </span>
    </div>
  );
}

function CyberRabbitPet({ working, onPointerDown, onPointerUp }: {
  working: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  return (
    <div className="cyber-rabbit-pet" data-working={working ? 'true' : 'false'} aria-label={working ? 'Cyber rabbit pet is working' : 'Cyber rabbit pet'} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <svg className="cyber-rabbit-svg" viewBox="0 0 132 168" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="cyberRabbitMainStroke" x1="0" y1="84" x2="132" y2="84" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#8ffcff" />
            <stop offset="0.42" stopColor="#39d9ff" />
            <stop offset="0.68" stopColor="#c45cff" />
            <stop offset="1" stopColor="#ff63f7" />
          </linearGradient>
          <linearGradient id="cyberRabbitBodyFill" x1="0" y1="84" x2="132" y2="84" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#06182e" />
            <stop offset="0.52" stopColor="#0a1538" />
            <stop offset="1" stopColor="#24103e" />
          </linearGradient>
          <linearGradient id="cyberRabbitSoftFill" x1="0" y1="84" x2="132" y2="84" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#0ce9ff" stopOpacity="0.38" />
            <stop offset="0.5" stopColor="#1b1d54" stopOpacity="0.1" />
            <stop offset="1" stopColor="#ff4ff6" stopOpacity="0.36" />
          </linearGradient>
          <filter id="cyberRabbitGlow" x="-45%" y="-45%" width="190%" height="190%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feColorMatrix
              in="blur"
              result="glow"
              type="matrix"
              values="0 0 0 0 0.25 0 0 0 0 0.92 0 0 0 0 1 0 0 0 0.9 0"
            />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="cyberRabbitBlushLeft">
            <stop offset="0" stopColor="#39d9ff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#39d9ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cyberRabbitBlushRight">
            <stop offset="0" stopColor="#ff63f7" stopOpacity="0.22" />
            <stop offset="1" stopColor="#ff63f7" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse className="cyber-rabbit-floor" cx="66" cy="155" rx="47" ry="8" />

        <g className="cyber-rabbit-art" filter="url(#cyberRabbitGlow)">
          <path className="cyber-rabbit-ear-fill cyber-rabbit-ear-left" d="M47 64C35 35 19 9 9 12C-1 16 5 50 32 84C37 75 42 68 47 64Z" />
          <path className="cyber-rabbit-ear-fill cyber-rabbit-ear-right" d="M85 64C97 35 113 9 123 12C133 16 127 50 100 84C95 75 90 68 85 64Z" />
          <path className="cyber-rabbit-head-fill" d="M31 82C38 61 52 55 66 56C80 55 94 61 101 82C115 92 115 118 100 128C94 145 79 154 66 148C53 154 38 145 32 128C17 118 17 92 31 82Z" />
          <path className="cyber-rabbit-body-fill" d="M36 124C26 135 24 153 37 158C48 162 57 151 66 135C75 151 84 162 95 158C108 153 106 135 96 124C84 132 48 132 36 124Z" />

          <path className="cyber-rabbit-outline cyber-rabbit-ear-left" d="M47 64C35 35 19 9 9 12C-1 16 5 50 32 84" />
          <path className="cyber-rabbit-outline cyber-rabbit-ear-right" d="M85 64C97 35 113 9 123 12C133 16 127 50 100 84" />
          <path className="cyber-rabbit-outline" d="M31 82C38 61 52 55 66 56C80 55 94 61 101 82C115 92 115 118 100 128C94 145 79 154 66 148C53 154 38 145 32 128C17 118 17 92 31 82Z" />
          <path className="cyber-rabbit-outline" d="M36 124C26 135 24 153 37 158C48 162 57 151 66 135C75 151 84 162 95 158C108 153 106 135 96 124" />

          <path className="cyber-rabbit-inner cyber-rabbit-ear-left" d="M36 73C23 50 14 21 19 18C26 14 41 43 48 63" />
          <path className="cyber-rabbit-inner cyber-rabbit-ear-left" d="M30 66C19 42 13 24 16 18" />
          <path className="cyber-rabbit-inner cyber-rabbit-ear-left" d="M41 58C32 38 23 22 20 19" />
          <path className="cyber-rabbit-inner cyber-rabbit-ear-right" d="M96 73C109 50 118 21 113 18C106 14 91 43 84 63" />
          <path className="cyber-rabbit-inner cyber-rabbit-ear-right" d="M102 66C113 42 119 24 116 18" />
          <path className="cyber-rabbit-inner cyber-rabbit-ear-right" d="M91 58C100 38 109 22 112 19" />

          <path className="cyber-rabbit-body-line cyber-rabbit-body-line-main" d="M31 127C43 134 55 134 66 126C77 134 89 134 101 127" />

          {/* X 眼睛 */}
          <path className="cyber-rabbit-eye-line" d="M45 90L87 102" />
          <path className="cyber-rabbit-eye-line" d="M87 90L45 102" />

          {/* 左边蓝色腮红 */}
          <ellipse className="cyber-rabbit-blush cyber-rabbit-blush-left" cx="44" cy="112" rx="12" ry="7" />
          {/* 右边红色腮红 */}
          <ellipse className="cyber-rabbit-blush cyber-rabbit-blush-right" cx="88" cy="112" rx="12" ry="7" />

          {working && (
            <g className="cyber-rabbit-work-core" aria-hidden="true">
              <circle cx="101" cy="58" r="7" />
              <path d="M97 58H105M101 54V62" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

/** 拖拽模式：'native' = startDragging (Win32 DWM) + 去边框补丁；'manual' = pointermove + setPosition 手动拖拽，完全无 DWM 边框 */
const DRAG_MODE: 'native' | 'manual' = 'native';

export default function PetWindow() {
  const [tasks, setTasks] = useState<PetTask[]>([]);
  const isClampingPositionRef = useRef(false);
  const working = tasks.length > 0;
  const visibleTasks = useMemo(() => tasks.slice(0, 5), [tasks]);

  useEffect(() => {
    document.documentElement.classList.add('pet-window-document');
    document.body.classList.add('pet-window-document');
    return () => {
      document.documentElement.classList.remove('pet-window-document');
      document.body.classList.remove('pet-window-document');
    };
  }, []);

  const clampWindowToScreen = useCallback(async () => {
    if (isClampingPositionRef.current) return;

    const appWindow = getCurrentWindow();
    const [monitor, position, size] = await Promise.all([
      currentMonitor(),
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);

    if (!monitor) return;

    // 全程逻辑坐标计算（outerPosition/outerSize/workArea 均为逻辑坐标）
    const workArea = monitor.workArea;
    const minX = workArea.position.x;
    const minY = workArea.position.y;
    const maxX = workArea.position.x + Math.max(0, workArea.size.width - size.width);
    const maxY = workArea.position.y + Math.max(0, workArea.size.height - size.height);
    const nextX = Math.min(Math.max(position.x, minX), maxX);
    const nextY = Math.min(Math.max(position.y, minY), maxY);

    if (nextX === position.x && nextY === position.y) return;

    isClampingPositionRef.current = true;
    try {
      await appWindow.setPosition(new LogicalPosition(nextX, nextY));
    } finally {
      setTimeout(() => {
        isClampingPositionRef.current = false;
      }, 80);
    }
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const appWindow = getCurrentWindow();

    appWindow.onMoved(() => {
      void clampWindowToScreen().catch(() => {});
    }).then(unlisten => {
      if (cancelled) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    }).catch(() => {});

    void clampWindowToScreen().catch(() => {});

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [clampWindowToScreen]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    listen<PetTasksPayload>('pet:tasks', event => {
      setTasks(event.payload.tasks.slice(0, 5));
    }).then(unlisten => {
      if (cancelled) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    }).catch(() => {});

    void emit('pet:request-sync').catch(() => {});

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  // 方案 B：手动 JS 拖拽（mousemove + setPosition），完全绕开 Win32 原生拖拽循环，无 DWM 边框
  // 核心：同步 screenX-clientX 为初始基准，异步 outerPosition() 校正多屏坐标偏移
  const handleManualDrag = (event: React.PointerEvent) => {
    const appWindow = getCurrentWindow();
    const startMouseX = event.screenX;
    const startMouseY = event.screenY;
    // 同步基准（单屏正确，副屏可能因 screenX 坐标系不同而有偏移）
    let baseX = startMouseX - event.clientX;
    let baseY = startMouseY - event.clientY;
    let rafId: number | null = null;
    let nextX = baseX;
    let nextY = baseY;
    // 跟踪最新鼠标坐标，用于异步校正时无缝切换基准
    let latestScreenX = startMouseX;
    let latestScreenY = startMouseY;

    const onMove = (e: MouseEvent) => {
      latestScreenX = e.screenX;
      latestScreenY = e.screenY;
      nextX = baseX + (e.screenX - startMouseX);
      nextY = baseY + (e.screenY - startMouseY);
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        void appWindow.setPosition(new LogicalPosition(nextX, nextY));
        rafId = null;
      });
    };

    const onUp = (e: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      isClampingPositionRef.current = false;
      void invoke('set_pet_dragging', { dragging: false }).catch(() => {});
      void invoke('save_pet_position').catch(() => {});
      const dx = Math.abs(e.screenX - startMouseX);
      const dy = Math.abs(e.screenY - startMouseY);
      if (dx < 5 && dy < 5) {
        void invoke('activate_main_window').catch(() => {});
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // 异步校正：用 outerPosition() 修正多屏坐标偏移
    // screenX 在副屏可能相对于当前屏幕而非虚拟桌面原点，outerPosition 始终返回正确的虚拟桌面坐标
    void appWindow.outerPosition().then(pos => {
      // 用当前鼠标位置和窗口真实位置重新计算基准，确保无缝切换
      baseX = pos.x - (latestScreenX - startMouseX);
      baseY = pos.y - (latestScreenY - startMouseY);
    }).catch(() => {});
  };

  const handlePointerDown = async (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    isClampingPositionRef.current = true;
    // 优先设置拖拽标志（同步），阻止 Rust 轮询干扰
    await invoke('set_pet_dragging', { dragging: true }).catch(() => {});

    if (DRAG_MODE === 'manual') {
      handleManualDrag(event);
    } else {
      // 方案 A：原生拖拽 + DWM 去边框（Rust 端 remove_drag_border）
      await getCurrentWindow().setIgnoreCursorEvents(false).catch(() => {});
      void getCurrentWindow().startDragging().catch(() => {});
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    // 手动拖拽模式：清理工作由 document 级 onUp 监听器处理，此处仅重置 dragStartRef
    if (DRAG_MODE === 'manual') {
      dragStartRef.current = null;
      return;
    }
    const start = dragStartRef.current;
    dragStartRef.current = null;
    isClampingPositionRef.current = false;
    void invoke('set_pet_dragging', { dragging: false }).catch(() => {});
    void invoke('save_pet_position').catch(() => {});
    if (start) {
      const dx = Math.abs(event.clientX - start.x);
      const dy = Math.abs(event.clientY - start.y);
      if (dx < 5 && dy < 5) {
        void invoke('activate_main_window').catch(() => {});
      }
    }
  };

  return (
    <div className="pet-window-root">
      <div className="pet-window-stage">
        <div className="pet-task-stack" data-empty={visibleTasks.length === 0 ? 'true' : 'false'}>
          {visibleTasks.map(task => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
        <CyberRabbitPet working={working} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} />
      </div>
    </div>
  );
}
