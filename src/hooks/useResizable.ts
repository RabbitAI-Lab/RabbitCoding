import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocalStorage } from './useLocalStorage';

interface UseResizableOptions {
  minWidth?: number;
  maxWidth?: number;
  maxWidthRatio?: number;
  storageKey: string;
  defaultWidth?: number;
  reverse?: boolean;
}

function getMaxWidth(ratio: number) {
  return Math.floor(window.innerWidth * ratio);
}

export function useResizable({
  minWidth = 200,
  maxWidth,
  maxWidthRatio = 0.3,
  storageKey,
  defaultWidth = 272,
  reverse = false,
}: UseResizableOptions) {
  const [width, setWidth] = useLocalStorage<number>(storageKey, defaultWidth);
  const [isResizing, setIsResizing] = useState(false);

  const widthRef = useRef(width);
  widthRef.current = width;

  const dragRef = useRef({ startX: 0, startWidth: 0 });

  // 计算实际最大宽度
  const effectiveMax = maxWidth ?? getMaxWidth(maxWidthRatio);

  // 窗口缩小时确保宽度不超出上限
  useEffect(() => {
    const handleResize = () => {
      if (widthRef.current > effectiveMax) {
        setWidth(effectiveMax);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [effectiveMax, setWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    dragRef.current = {
      startX: e.clientX,
      startWidth: widthRef.current,
    };
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (e: MouseEvent) => {
      const direction = reverse ? -1 : 1;
      const delta = (e.clientX - dragRef.current.startX) * direction;
      const newWidth = Math.min(
        effectiveMax,
        Math.max(minWidth, dragRef.current.startWidth + delta)
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, minWidth, effectiveMax, setWidth, reverse]);

  return {
    width,
    isResizing,
    handleProps: {
      onMouseDown: handleMouseDown,
    },
  };
}
