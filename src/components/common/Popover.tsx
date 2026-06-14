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

  useLayoutEffect(() => {
    if (open && anchorRef.current) {
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
