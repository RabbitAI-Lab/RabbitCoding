/**
 * CopyMarkdownButton 组件
 *
 * 在每轮 AI 回复末尾提供「复制」按钮，复制该轮所有 assistant text 的原始 Markdown。
 */

import { memo, useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import Tooltip from '../common/Tooltip';
import { useI18n } from '../../i18n/useI18n';

interface CopyMarkdownButtonProps {
  /** 该轮所有 assistant text 消息的原始 Markdown 文本 */
  texts: string[];
}

function CopyMarkdownButtonInner({ texts }: CopyMarkdownButtonProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const markdown = texts.join('\n\n');
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // 静默失败：剪贴板不可用时无副作用
    });
  }, [texts]);

  return (
    <Tooltip content={copied ? t('agent.message.copied') : t('agent.message.copyMarkdown')}>
      <button
        onClick={handleCopy}
        className="text-gray-400 dark:text-gray-500 transition-colors hover:text-black dark:hover:text-white"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </Tooltip>
  );
}

export const CopyMarkdownButton = memo(CopyMarkdownButtonInner);
