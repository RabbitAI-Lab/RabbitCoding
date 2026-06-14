import { useEffect, useRef, useCallback } from 'react';
import type { ContextMenuAction } from '../../types';

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuAction[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('wheel', onClose);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('wheel', onClose);
    };
  }, [handleClickOutside, onClose]);

  // Adjust position if menu would overflow viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 1000,
  };

  return (
    <div
      ref={menuRef}
      style={style}
      className="min-w-[140px] rounded-lg border border-gray-200 bg-[#F8F8F8] py-1 shadow-lg dark:border-gray-700 dark:bg-[#2a2a2a]"
    >
      {items.map((item, index) => (
        <div key={index}>
          <button
            className={`w-full px-3 py-1.5 text-left text-xs ${
              item.danger
                ? 'text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
                : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              item.action();
            }}
          >
            {item.label}
          </button>
          {item.dividerBelow && (
            <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
          )}
        </div>
      ))}
    </div>
  );
}
