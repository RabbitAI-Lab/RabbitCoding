/**
 * CompactionBlock 组件
 *
 * 展示会话压缩结果卡片，包含 token 变化和触发方式。
 */

import { memo } from 'react';
import { Archive } from 'lucide-react';
import type { CompactionResultMessage } from '../../types';
import { useI18n } from '../../i18n/useI18n';

interface CompactionBlockProps {
  message: CompactionResultMessage;
}

function formatTokens(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}K`;
  }
  return String(n);
}

function CompactionBlockInner({ message }: CompactionBlockProps) {
  const { t } = useI18n();
  const { trigger, preTokens, postTokens, durationMs } = message;
  const reduction = postTokens != null && preTokens > 0
    ? Math.round((1 - postTokens / preTokens) * 100)
    : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 my-1">
      <Archive size={14} className="shrink-0 text-blue-500 dark:text-blue-400" />
      <div className="flex-1 min-w-0 flex items-center gap-2 text-xs">
        <span className="font-medium text-blue-700 dark:text-blue-300">
          {t('agent.compaction.compacted')}
        </span>
        {reduction != null && (
          <span className="text-gray-500 dark:text-gray-400">
            {formatTokens(preTokens)} → {formatTokens(postTokens!)} ({reduction}% ↓)
          </span>
        )}
        {trigger === 'manual' && (
          <span className="text-gray-400 dark:text-gray-500">· {t('agent.compaction.manual')}</span>
        )}
        {durationMs != null && (
          <span className="text-gray-400 dark:text-gray-500">· {(durationMs / 1000).toFixed(1)}s</span>
        )}
      </div>
    </div>
  );
}

export const CompactionBlock = memo(CompactionBlockInner);
