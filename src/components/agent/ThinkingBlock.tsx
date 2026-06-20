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
import { Think } from '@ant-design/x';
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
    <Think
      loading={isStreaming}
      expanded={expanded}
      onExpand={setExpanded}
      title={`${t('agent.thinking.deepThinking')} · ${seconds}s`}
      blink={isStreaming}
      styles={{ content: { maxHeight: 400, overflow: 'auto', fontSize: 13 } }}
    >
      <p className="whitespace-pre-wrap break-words leading-relaxed m-0">
        {thinking}
      </p>
    </Think>
  );
}

export const ThinkingBlock = memo(ThinkingBlockInner);
