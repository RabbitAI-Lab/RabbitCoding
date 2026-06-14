/**
 * ContextIndicator 组件
 *
 * Sender footer 中的上下文用量指示器。
 * 点击后展开 Popover，显示 token 使用百分比和「压缩当前上下文」按钮。
 */

import { useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import Popover from './Popover';
import type { TokenUsage } from '../../types';
import { useI18n } from '../../i18n/useI18n';

interface ContextIndicatorProps {
  tokenUsage?: TokenUsage;
  maxContextTokens?: number;
  compactionPhase?: 'compacting' | 'done' | 'failed' | null;
  status?: string;
  onCompact: () => void;
}

const DEFAULT_MAX_CONTEXT = 200_000;

function formatK(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function ContextIndicator({
  tokenUsage,
  maxContextTokens,
  compactionPhase,
  status,
  onCompact,
}: ContextIndicatorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const handleMouseLeave = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }, [clearCloseTimer]);

  const maxTokens = maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  const usedTokens = tokenUsage
    ? tokenUsage.inputTokens +
      tokenUsage.cacheCreationInputTokens +
      tokenUsage.cacheReadInputTokens
    : 0;
  const percent = Math.min(100, Math.round((usedTokens / maxTokens) * 100));

  // 颜色判定
  let colorClass: string;
  let barClass: string;
  let fillColor: string;
  if (percent >= 80) {
    colorClass = 'text-red-500 dark:text-red-400';
    barClass = 'bg-red-500 dark:bg-red-400';
    fillColor = '#ef4444';
  } else if (percent >= 50) {
    colorClass = 'text-amber-500 dark:text-amber-400';
    barClass = 'bg-amber-500 dark:bg-amber-400';
    fillColor = '#f59e0b';
  } else {
    colorClass = 'text-gray-400 dark:text-gray-500';
    barClass = 'bg-gray-400 dark:bg-gray-500';
    fillColor = '#9ca3af';
  }

  // 圆形容器内部填充高度（内部可用高度 8px，从底部向上）
  const fillHeight = Math.max(0.5, (percent / 100) * 8);

  const isCompacting = compactionPhase === 'compacting';
  const isRunning = status === 'running';
  const compactDisabled = isCompacting || isRunning;

  return (
    <>
      <button
        ref={iconRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`flex items-center px-0.5 h-[22px] rounded leading-none ${colorClass}`}
        title={t('contextIndicator.title')}
      >
        {/* 圆形容器水位填充图标 */}
        <svg width="16" height="16" viewBox="0 0 12 12" fill="none" className="shrink-0">
          {/* 圆形外框 */}
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" fill="none" />
          {/* 裁剪组：限制填充在圆内 */}
          <clipPath id="ctx-clip">
            <circle cx="6" cy="6" r="4.5" />
          </clipPath>
          <g clipPath="url(#ctx-clip)">
            {/* 内部填充：从底部向上 */}
            <rect x="1" y={10 - fillHeight} width="10" height={fillHeight} fill={fillColor} className="transition-all duration-300" />
          </g>
        </svg>
      </button>

      <Popover anchorRef={iconRef} open={open} onClose={() => setOpen(false)} onMouseEnter={clearCloseTimer} onMouseLeave={handleMouseLeave}>
        <div className="w-[240px] px-3 py-2.5 space-y-2.5">
          {/* 标题 */}
          <div className="text-xs font-medium text-gray-700 dark:text-gray-200">
            {t('contextIndicator.contextUsage')}
          </div>

          {/* 进度条 */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400 mb-1">
              <span>{formatK(usedTokens)} / {formatK(maxTokens)}</span>
              <span className={colorClass}>{percent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${barClass}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Token 明细 */}
          {tokenUsage && (
            <div className="space-y-0.5 text-[11px] text-gray-400 dark:text-gray-500">
              <div className="flex justify-between">
                <span>{t('contextIndicator.input')}</span>
                <span>{formatK(tokenUsage.inputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('contextIndicator.output')}</span>
                <span>{formatK(tokenUsage.outputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('contextIndicator.cache')}</span>
                <span>{formatK(tokenUsage.cacheCreationInputTokens + tokenUsage.cacheReadInputTokens)}</span>
              </div>
            </div>
          )}

          {/* 压缩按钮 */}
          <button
            onClick={() => {
              onCompact();
              setOpen(false);
            }}
            disabled={compactDisabled}
            className="w-full flex items-center justify-center gap-1.5 rounded-md text-xs font-medium py-1.5 transition-colors disabled:cursor-not-allowed text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
            style={{
              backgroundColor: compactDisabled ? '#B8BCC3' : '#dfdfdf',
            }}
          >
            {isCompacting ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                <span>{t('contextIndicator.compacting')}</span>
              </>
            ) : (
              <span>{t('contextIndicator.compactNow')}</span>
            )}
          </button>
        </div>
      </Popover>
    </>
  );
}
