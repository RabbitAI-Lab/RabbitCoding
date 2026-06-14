import { useRef, useState, useCallback } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  delay?: number;
  className?: string;
}

export default function Tooltip({ content, children, delay = 150, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPosition({
          left: rect.left + rect.width / 2,
          top: rect.top - 6,
        });
        setVisible(true);
      }
    }, delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        className={className}
        style={{ display: 'inline-flex' }}
      >
        {children}
      </span>
      {visible && (
        <div
          className="fixed z-[9999] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-[#141414] dark:bg-gray-800 px-1.5 py-1 text-[10px] leading-tight text-white"
          style={{ left: position.left, top: position.top }}
        >
          {content}
        </div>
      )}
    </>
  );
}
