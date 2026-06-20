/**
 * ThinkingBlock 组件
 *
 * 可折叠展示 Claude 的深度思考过程。
 * 默认折叠，显示「深度思考 · Xs」标签。
 * 点击展开可查看完整推理内容。
 *
 * 流式期间使用实时计时器显示递增秒数，
 * 思考结束后切换为 sidecar 返回的精确 durationMs。
 */

import { memo, useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { useI18n } from '../../i18n/useI18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';

interface ThinkingBlockProps {
  thinking: string;
  durationMs: number;
  isStreaming?: boolean;
}

function ThinkingBlockInner({ thinking, durationMs, isStreaming }: ThinkingBlockProps) {
  const { t } = useI18n();
  const [autoCollapseThinking] = useLocalStorage('pref-auto-collapse-thinking', false);
  const [expanded, setExpanded] = useState(!autoCollapseThinking);
  // 流式期间的实时计时（100ms 精度）
  const [liveMs, setLiveMs] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (isStreaming && startRef.current === 0) {
      startRef.current = Date.now();
    }
    if (!isStreaming) {
      startRef.current = 0;
      setLiveMs(0);
      return;
    }
    const id = setInterval(() => {
      if (startRef.current > 0) {
        setLiveMs(Date.now() - startRef.current);
      }
    }, 100);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (!thinking) return null;

  // 优先使用精确值（thinking_done 已到达），流式期间用实时计时
  const displayMs = durationMs > 0 ? durationMs : liveMs;
  const seconds = (displayMs / 1000).toFixed(1);

  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/50 dark:border-purple-900/50 dark:bg-purple-950/30 overflow-hidden">
      {/* 折叠头部 */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors"
      >
        <Brain size={14} className="shrink-0 text-purple-400" />
        <span className="text-xs font-medium text-purple-600 dark:text-purple-300">{t('agent.thinking.deepThinking')}</span>
        <span className="text-xs text-purple-400">· {seconds}s</span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-purple-400 transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
      </button>

      {/* 展开内容 */}
      {expanded ? (
        <div className="border-t border-purple-100 dark:border-purple-900/50 px-3 py-2 max-h-[400px] overflow-auto">
          <p className="text-xs text-purple-800/70 dark:text-purple-300/70 leading-relaxed whitespace-pre-wrap break-words">
            {thinking}
          </p>
        </div>
      ) : (
        isStreaming && (
          <span className="inline-block w-2 h-3.5 ml-0.5 bg-purple-400 animate-pulse rounded-sm" />
        )
      )}
    </div>
  );
}

export const ThinkingBlock = memo(ThinkingBlockInner);
