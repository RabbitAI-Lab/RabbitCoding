/**
 * AgentChat 组件
 *
 * 展示一个 Rabbit 任务的完整 Agent 对话流。
 * 处理消息的关联（tool_use ↔ tool_result）、合并连续文本、自动滚动等。
 */

import { useEffect, useRef, useMemo } from 'react';
import { Loader2, Archive } from 'lucide-react';
import { AgentMessageItem } from './AgentMessage';
import type { AgentMessage, AssistantToolUseMessage, ToolResultMessage, Rabbit } from '../../types';
import { useI18n } from '../../i18n/useI18n';

interface AgentChatProps {
  rabbit: Rabbit;
  /** Spec 确认后启动编码查询 */
  onSpecRun?: (rabbitId: string) => void;
}

interface DisplayItem {
  message: AgentMessage;
  toolResult?: ToolResultMessage;
}

interface MessageGroup {
  /** user 消息（组头），如果没有则整个组无 sticky */
  userItem?: DisplayItem;
  /** 组内非 user 消息 */
  items: DisplayItem[];
}

/**
 * 预处理消息列表：构建 tool_use_id → tool_result 的映射，
 * 过滤掉单独的 tool_result，并按 user 消息分组。
 * 每个 user 消息开新组，后续非 user 消息归入该组，
 * 使 sticky 约束矩形限定在组内，实现“下一条推走上条”的效果。
 */
function processMessages(messages: AgentMessage[]): MessageGroup[] {
  // 构建 tool_result 映射
  const toolResultMap = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.type === 'tool_result') {
      const tr = msg as ToolResultMessage;
      toolResultMap.set(tr.toolUseId, tr);
    }
  }

  // 找出最后一个 result 消息的索引，用于去重
  let lastResultIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].type === 'result') {
      lastResultIndex = i;
      break;
    }
  }

  // 过滤需要展示的消息
  const filteredItems: DisplayItem[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type === 'tool_result') continue;
    if (msg.type === 'result' && i !== lastResultIndex) continue;

    let toolResult: ToolResultMessage | undefined;
    if (msg.type === 'assistant' && msg.subtype === 'tool_use') {
      toolResult = toolResultMap.get((msg as AssistantToolUseMessage).toolUseId);
    }
    filteredItems.push({ message: msg, toolResult });
  }

  // 按 user 消息分组
  const groups: MessageGroup[] = [];
  for (const item of filteredItems) {
    if (item.message.type === 'user') {
      groups.push({ userItem: item, items: [] });
    } else if (groups.length === 0) {
      // 前导消息（第一条不是 user 类型）
      groups.push({ items: [item] });
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }

  return groups;
}

export default function AgentChat({ rabbit, onSpecRun }: AgentChatProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(rabbit.messages.length);
  const isRunning = rabbit.status === 'running';

  // 预处理消息（分组）
  const groups = useMemo(() => processMessages(rabbit.messages), [rabbit.messages]);

  // 判断最后一条消息是否为流式文本
  const lastGroup = groups.length > 0 ? groups[groups.length - 1] : null;
  const lastGroupLastItem = lastGroup
    ? lastGroup.items.length > 0
      ? lastGroup.items[lastGroup.items.length - 1]
      : lastGroup.userItem
    : null;
  const isLastStreaming = isRunning
    && !!lastGroupLastItem
    && lastGroupLastItem.message.type === 'assistant'
    && (lastGroupLastItem.message.subtype === 'text' || lastGroupLastItem.message.subtype === 'thinking');

  // 检测用户是否在底部（阈值 50px）
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  // 自动滚动到底部：流式 delta 或新消息时触发
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // 新消息加入时，强制回到底部
    if (rabbit.messages.length > prevMsgCountRef.current) {
      isAtBottomRef.current = true;
    }
    prevMsgCountRef.current = rabbit.messages.length;

    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [rabbit.messages, isRunning]);

  if (rabbit.messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
        {isRunning ? (
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
            <p className="text-sm">{t('agent.chat.starting')}</p>
          </div>
        ) : rabbit.status === 'error' ? (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-red-400 dark:text-red-500">{t('agent.chat.startFailed')}</p>
            {rabbit.error && <p className="text-xs text-red-300 dark:text-red-500">{rabbit.error}</p>}
          </div>
        ) : (
          <p className="text-sm">{t('agent.chat.waiting')}</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* 消息流 */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-auto px-4 pt-0 pb-3">
        {/* 顶部固定蒙版：遮盖 sticky 消息上方的缝隙，高度为吸附消息高度+28px（含8px间距） */}
        <div className="sticky top-0 z-20 pointer-events-none">
          <div className="h-[58px] bg-white dark:bg-[#1e1e1e]" style={{ maskImage: 'linear-gradient(to bottom, black 60%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent)' }} />
        </div>
        <div className="max-w-3xl mx-auto space-y-1 -mt-[58px] pt-[8px]">
          {groups.map((group, gi) => {
            const isLastGroup = gi === groups.length - 1;
            return (
              <div key={gi} className="space-y-1">
                {group.userItem && (
                  <div className="sticky top-[8px] z-30 pb-2">
                    <AgentMessageItem message={group.userItem.message} rabbitId={rabbit.id} onSpecRun={onSpecRun} />
                  </div>
                )}
                {group.items.map((item, ii) => {
                  const isStreaming = isLastGroup && ii === group.items.length - 1 && isLastStreaming;
                  return (
                    <AgentMessageItem
                      key={`${gi}-${ii}`}
                      message={item.message}
                      isStreaming={isStreaming}
                      toolResult={item.toolResult}
                      rabbitId={rabbit.id}
                      onSpecRun={onSpecRun}
                    />
                  );
                })}
              </div>
            );
          })}

          {/* 压缩中指示器 */}
          {rabbit.compactionPhase === 'compacting' && (
            <div className="flex items-center gap-2 py-2 text-xs text-amber-500 dark:text-amber-400">
              <Archive size={12} className="animate-pulse" />
              <span>{t('agent.compaction.compacting')}</span>
            </div>
          )}

          {/* 压缩失败提示 */}
          {rabbit.compactionPhase === 'failed' && (
            <div className="flex items-center gap-2 py-2 text-xs text-red-400 dark:text-red-500">
              <Archive size={12} />
              <span>{t('agent.compaction.failed')}</span>
            </div>
          )}

          {/* 运行中指示器 */}
          {isRunning && (
            <div className="flex items-center gap-2 py-2 text-xs text-gray-400 dark:text-gray-500">
              <Loader2 size={12} className="animate-spin" />
              <span>{t('agent.chat.working')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
