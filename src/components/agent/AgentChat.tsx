/**
 * AgentChat 组件
 *
 * 展示一个 Rabbit 任务的完整 Agent 对话流。
 * 处理消息的关联（tool_use ↔ tool_result）、合并连续文本、自动滚动等。
 * 点击吸顶 user 消息 → 直接在消息位置变为 inline textarea 编辑 → 发送即 rewind。
 */

import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { Loader2, Archive } from 'lucide-react';
import { Sender } from '@ant-design/x';
import { AgentMessageItem } from './AgentMessage';
import { CopyMarkdownButton } from './CopyMarkdownButton';
import type { AgentMessage, AssistantToolUseMessage, AssistantTextMessage, UsageUpdateMessage, ToolResultMessage, Rabbit, UserMessage } from '../../types';
import { useI18n } from '../../i18n/useI18n';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { formatTokens } from '../../hooks/useUsage';

interface AgentChatProps {
  rabbit: Rabbit;
  /** Spec 确认后启动编码查询 */
  onSpecRun?: (rabbitId: string) => void;
  /** inline 编辑提交：触发 rewind + 重发 */
  onEditUserMessage?: (text: string, userMessageId?: string) => void;
  /** Sender footer 渲染回调：inline 编辑时复用底部 Sender 的完整 footer（模型选择、Spec开关、提示词优化等） */
  renderSenderFooter?: (context: { value: string; components: { SendButton: React.ComponentType<any>; LoadingButton: React.ComponentType<any> }; showUsage?: boolean }) => React.ReactNode;
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

/** 隐藏的内部工具调用：仅渲染对应的交互卡片，不展示原始 tool_use 块 */
const HIDDEN_TOOLS = new Set([
  'ExitPlanMode',
  'mcp__rabbit-spec__WriteSpec',
  'AskUserQuestion',
]);

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
    // 隐藏内部工具调用：ExitPlanMode（sidecar deny）、WriteSpec（通过 spec_confirmation 卡片展示）、AskUserQuestion（通过 ask_user_question 卡片展示）
    if (msg.type === 'assistant' && msg.subtype === 'tool_use'
        && HIDDEN_TOOLS.has((msg as AssistantToolUseMessage).toolName)) {
      continue;
    }

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

export default function AgentChat({ rabbit, onSpecRun, onEditUserMessage, renderSenderFooter }: AgentChatProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevMsgCountRef = useRef(rabbit.messages.length);
  const isRunning = rabbit.status === 'running';
  const [showTokenUsage] = useLocalStorage('pref-show-token-usage', false);

  // inline 编辑状态：正在编辑的 group 索引
  const [editingGroupIdx, setEditingGroupIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

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

  // 中文输入法正在输入时，回车用于确认候选词，不发送消息
  const imeComposingRef = useRef(false);

  // 提交编辑：调用 onEditUserMessage 触发 rewind + 重发
  const submitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (!trimmed || editingGroupIdx === null) return;
    const group = groups[editingGroupIdx];
    if (!group?.userItem) return;
    const userMsg = group.userItem.message as UserMessage;
    onEditUserMessage?.(trimmed, userMsg.userMessageId);
    setEditingGroupIdx(null);
    setEditValue('');
  }, [editValue, editingGroupIdx, groups, onEditUserMessage]);

  // 开始 inline 编辑：点击 user 消息后，消息变为 Sender
  const startEditing = useCallback((groupIdx: number) => {
    const group = groups[groupIdx];
    if (!group?.userItem) return;
    const userMsg = group.userItem.message as UserMessage;
    setEditValue(userMsg.text);
    setEditingGroupIdx(groupIdx);
  }, [groups]);

  // 取消编辑
  const cancelEditing = useCallback(() => {
    setEditingGroupIdx(null);
    setEditValue('');
  }, []);

  // Sender 键盘事件：IME 组合中不发送
  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (imeComposingRef.current || e.nativeEvent.isComposing) {
        return false;
      }
    }
  }, []);

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
            const isEditingThis = editingGroupIdx === gi;
            return (
              <div key={gi} className="space-y-1">
                {group.userItem && (
                  <div className="sticky top-[8px] z-30 pb-2">
                    {isEditingThis ? (
                      // inline 编辑模式：user 消息位置变为 Sender 组件，复用底部 Sender 的完整 footer
                      <Sender
                        value={editValue}
                        onChange={setEditValue}
                        onSubmit={submitEdit}
                        onKeyDown={handleEditKeyDown}
                        onCancel={cancelEditing}
                        loading={false}
                        placeholder={t('contentArea.followUpPlaceholder')}
                        autoSize={{ minRows: 3, maxRows: 10 }}
                        suffix={false}
                        styles={{ content: { paddingTop: 2 }, footer: { paddingBottom: 6 } }}
                        footer={(_, { components: { SendButton, LoadingButton } }) =>
                          renderSenderFooter
                            ? renderSenderFooter({ value: editValue, components: { SendButton, LoadingButton }, showUsage: false })
                            : <SendButton style={{ width: 20, height: 20, minWidth: 20, fontSize: 12, padding: 0, backgroundColor: editValue.trim() ? 'var(--brand-solid)' : '#C4C4C4', color: '#ffffff', border: 'none' }} />
                        }
                      />
                    ) : (
                      // 正常展示模式：可点击进入编辑
                      <AgentMessageItem
                        message={group.userItem.message}
                        rabbitId={rabbit.id}
                        onSpecRun={onSpecRun}
                        onEditUserMessage={!isRunning && onEditUserMessage ? () => startEditing(gi) : undefined}
                      />
                    )}
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
                {/* 尾部行：复制按钮 + token 用量（受设置开关控制） */}
                {(() => {
                  const texts = group.items
                    .filter(item => item.message.type === 'assistant' && item.message.subtype === 'text')
                    .map(item => (item.message as AssistantTextMessage).text)
                    .filter(text => text.trim().length > 0);
                  const groupIsStreaming = isLastGroup && isRunning;
                  if (texts.length === 0 || groupIsStreaming) return null;

                  // 聚合该轮所有 usage_update 的 token
                  const usages = group.items
                    .filter(item => item.message.type === 'usage_update')
                    .map(item => (item.message as UsageUpdateMessage).usage);
                  const totalIn = usages.reduce((s, u) => s + (u.inputTokens ?? 0), 0);
                  const totalOut = usages.reduce((s, u) => s + (u.outputTokens ?? 0), 0);
                  const totalCache = usages.reduce((s, u) => s + (u.cacheReadInputTokens ?? 0), 0);

                  return (
                    <div className="flex items-center gap-3 py-1.5">
                      <CopyMarkdownButton texts={texts} />
                      {showTokenUsage && usages.length > 0 && (
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">
                          {t('agent.message.tokenLabel')} {t('agent.message.tokenIn')}: {formatTokens(totalIn)}　{t('agent.message.tokenOut')}: {formatTokens(totalOut)}　{t('agent.message.tokenCache')}: {formatTokens(totalCache)}
                        </span>
                      )}
                    </div>
                  );
                })()}
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
