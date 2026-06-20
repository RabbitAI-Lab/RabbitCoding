import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 点击这些区域不应触发关闭（用于嵌套子菜单） */
  ignoredRefs?: React.RefObject<HTMLElement | null>[];
  /** hover 进入回调（用于 hover 展开模式） */
  onMouseEnter?: () => void;
  /** hover 离开回调（用于 hover 展开模式） */
  onMouseLeave?: () => void;
}

export default function Popover({ anchorRef, open, onClose, children, ignoredRefs = [], onMouseEnter, onMouseLeave }: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);
  // 标记本次 open 是否已完成实际宽度测量与边界溢出修正，避免与 setPosition 形成循环
  const measuredRef = useRef(false);

  useLayoutEffect(() => {
    if (open && anchorRef.current) {
      measuredRef.current = false;
      const anchorRect = anchorRef.current.getBoundingClientRect();
      setPosition({
        left: anchorRect.left,
        bottom: window.innerHeight - anchorRect.top + 4,
      });
    }
    if (!open) {
      setPosition(null);
    }
  }, [open, anchorRef]);

  // 渲染后测量实际宽度并修正左右边界溢出
  useLayoutEffect(() => {
    if (!position || measuredRef.current || !popoverRef.current) return;
    measuredRef.current = true;
    const width = popoverRef.current.offsetWidth;
    const innerWidth = window.innerWidth;
    const MARGIN = 8;
    let newLeft = position.left;
    if (newLeft + width > innerWidth - MARGIN) {
      newLeft = Math.max(MARGIN, innerWidth - width - MARGIN);
    } else if (newLeft < MARGIN) {
      newLeft = MARGIN;
    }
    if (newLeft !== position.left) {
      setPosition(prev => (prev ? { ...prev, left: newLeft } : prev));
    }
  }, [position]);

  // open 期间监听窗口尺寸变化，重新定位以保持在视口内
  useEffect(() => {
    if (!open) return;
    const handleResize = () => {
      if (anchorRef.current) {
        measuredRef.current = false;
        const anchorRect = anchorRef.current.getBoundingClientRect();
        setPosition({
          left: anchorRect.left,
          bottom: window.innerHeight - anchorRect.top + 4,
        });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [open, anchorRef]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    const target = e.target as Node;
    if (popoverRef.current?.contains(target)) return;
    if (anchorRef.current?.contains(target)) return;
    if (ignoredRefs.some(ref => ref.current?.contains(target))) return;
    onClose();
  }, [onClose, anchorRef, ignoredRefs]);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, handleClickOutside]);

  if (!open || !position) return null;

  return (
    <div
      ref={popoverRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 min-w-[160px] rounded-lg border border-gray-200 bg-[#F8F8F8] py-1 shadow-lg dark:border-gray-700 dark:bg-[#1e1e1e]"
      style={{ left: position.left, bottom: position.bottom }}
    >
      {children}
    </div>
  );
}
