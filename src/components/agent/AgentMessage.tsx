/**
 * AgentMessage 组件
 *
 * 根据 Agent 消息类型渲染不同的展示样式。
 * 合并连续的 text 块，关联 tool_use 和 tool_result。
 */

import { memo, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { StreamingText } from './StreamingText';
import { ToolCallBlock } from './ToolCallBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { CompactionBlock } from './CompactionBlock';
import { AskUserQuestionBlock } from './AskUserQuestionBlock';
import type {
  AgentMessage,
  UserMessage,
  AssistantTextMessage,
  AssistantThinkingMessage,
  AssistantToolUseMessage,
  ToolResultMessage,
  ResultMessage,
  AgentErrorMessage,
  SpecConfirmationMessage,
  CompactionResultMessage,
  AskUserQuestionMessage,
} from '../../types';
import { useI18n } from '../../i18n/useI18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { formatTokens } from '../../hooks/useUsage';

interface AgentMessageProps {
  message: AgentMessage;
  isStreaming?: boolean;
  /** 关联的 tool_result 消息（仅 tool_use 类型使用） */
  toolResult?: ToolResultMessage;
  /** rabbitId（AskUserQuestion 需要） */
  rabbitId?: string;
  /** Spec 确认后启动编码查询 */
  onSpecRun?: (rabbitId: string) => void;
}

function AgentMessageItemInner({ message, isStreaming, toolResult, rabbitId, onSpecRun }: AgentMessageProps) {
  const [specRunClicked, setSpecRunClicked] = useState(false);
  const { t } = useI18n();
  const [showTokenUsage] = useLocalStorage('pref-show-token-usage', false);
  switch (message.type) {
    case 'user': {
      const userMsg = message as UserMessage;
      return (
        <div className="flex items-center rounded-lg bg-[#f3f3f3] dark:bg-gray-800 px-3 min-h-[33px] text-[13px] text-[#141414] dark:text-gray-100 whitespace-pre-wrap break-words">
          {userMsg.text}
        </div>
      );
    }

    case 'assistant':
      if (message.subtype === 'thinking') {
        const thinkingMsg = message as AssistantThinkingMessage;
        return (
          <div className="py-1">
            <ThinkingBlock thinking={thinkingMsg.thinking} durationMs={thinkingMsg.durationMs} isStreaming={isStreaming} />
          </div>
        );
      }
      if (message.subtype === 'text') {
        return (
          <div className="py-1">
            <StreamingText
              text={(message as AssistantTextMessage).text}
              isStreaming={isStreaming}
            />
          </div>
        );
      }
      if (message.subtype === 'tool_use') {
        return (
          <div className="py-1">
            <ToolCallBlock
              toolUse={message as AssistantToolUseMessage}
              result={toolResult}
            />
          </div>
        );
      }
      return null;

    case 'result': {
      const result = message as ResultMessage;
      return (
        <div className={`flex items-center gap-2 py-2 text-xs ${
          result.subtype === 'error' ? 'text-red-500 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'
        }`}>
          {result.subtype === 'error' ? (
            <span>{t('agent.message.taskError')}: {result.error ?? t('agent.message.unknownError')}</span>
          ) : (
            <span>{t('agent.message.taskCompleted')}</span>
          )}
          {result.durationMs != null && (
            <span>· {(result.durationMs / 1000).toFixed(1)}s</span>
          )}
          {result.totalCostUsd != null && (
            <span>· ${result.totalCostUsd.toFixed(4)}</span>
          )}
          {showTokenUsage && result.usage && (
            <span>· {t('agent.message.tokens')}: {formatTokens(result.usage.inputTokens + result.usage.outputTokens)}</span>
          )}
          {showTokenUsage && result.numTurns != null && (
            <span>· {result.numTurns} {t('agent.message.turns')}</span>
          )}
        </div>
      );
    }

    case 'error': {
      const err = message as AgentErrorMessage;
      return (
        <div className="py-2 text-xs text-red-500 dark:text-red-400">
          错误: {err.message}
        </div>
      );
    }

    case 'system':
      // system/init 消息不在聊天流中展示
      return null;

    case 'tool_result':
      // tool_result 通过 ToolCallBlock 的 toolResult prop 展示，不单独渲染
      return null;

    case 'compaction_result':
      return <CompactionBlock message={message as CompactionResultMessage} />;

    case 'spec_generating': {
      return (
        <div className="flex items-center gap-2.5 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 px-3 py-2.5 my-1">
          <Loader2 size={16} className="shrink-0 text-blue-500 dark:text-blue-400 animate-spin" />
          <span className="text-xs font-medium text-blue-700 dark:text-blue-300">{t('agent.message.specGenerating')}</span>
        </div>
      );
    }

    case 'spec_confirmation': {
      const specMsg = message as SpecConfirmationMessage;
      return (
        <div className="rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20 my-1 overflow-hidden">
          {/* Header: icon + title + file name */}
          <div className="flex items-center gap-2.5 px-3 py-2">
            <FileText size={16} className="shrink-0 text-green-500 dark:text-green-400" />
            <span className="text-xs font-medium text-green-700 dark:text-green-300">{t('agent.message.specGenerated')}</span>
            <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 truncate">{specMsg.specFileName}</span>
          </div>

          {/* Spec 摘要预览 */}
          {specMsg.specSummary && (
            <div className="px-3 pb-2">
              <div className="rounded-md bg-white/60 dark:bg-gray-800/50 border border-green-200 dark:border-green-800 px-2.5 py-2 max-h-[200px] overflow-y-auto">
                <pre className="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words font-sans leading-relaxed">{specMsg.specSummary}</pre>
              </div>
            </div>
          )}

          {/* 运行按钮 */}
          <div className="px-3 pb-2.5">
            <button
              disabled={specRunClicked}
              onClick={() => {
                if (specRunClicked || !rabbitId || !onSpecRun) return;
                setSpecRunClicked(true);
                onSpecRun(rabbitId);
              }}
              className={`w-full rounded-md text-white text-xs font-medium py-1.5 transition-colors ${
                specRunClicked
                  ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed'
                  : 'bg-[#E8702A] hover:bg-[#D56020] dark:bg-[#F5824C] dark:hover:bg-[#E8702A]'
              }`}
            >
              {specRunClicked ? t('agent.message.running') : t('agent.message.run')}
            </button>
          </div>
        </div>
      );
    }

    case 'ask_user_question': {
      const askMsg = message as AskUserQuestionMessage;
      if (!rabbitId) return null;
      return <AskUserQuestionBlock message={askMsg} rabbitId={rabbitId} />;
    }

    default:
      return null;
  }
}

export const AgentMessageItem = memo(AgentMessageItemInner);
