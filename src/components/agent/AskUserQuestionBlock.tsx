/**
 * AskUserQuestionBlock 组件
 *
 * 渲染 Claude 的 AskUserQuestion 提问卡片。
 * 支持单选/多选 + 自由文本回答。
 * 已回答后切换为只读状态。
 */

import { useState, useMemo } from 'react';
import { HelpCircle, Check, X } from 'lucide-react';
import type { AskUserQuestionMessage, AskUserQuestionItem } from '../../types';
import { useAgentContext } from '../../hooks/useAgentContext';
import { useWorkspaces } from '../../hooks/useWorkspaces';

interface AskUserQuestionBlockProps {
  message: AskUserQuestionMessage;
  /** rabbitId（即 queryId） */
  rabbitId: string;
}

export function AskUserQuestionBlock({ message, rabbitId }: AskUserQuestionBlockProps) {
  const { respondToQuestion, cancelQuestion } = useAgentContext();
  const store = useWorkspaces();
  const [selectedOptions, setSelectedOptions] = useState<Record<number, Set<string>>>({});
  const [customText, setCustomText] = useState('');

  // 查找 rabbit 获取 workspaceId
  const ws = useMemo(
    () => store.workspaces.find(w => w.rabbits.some(r => r.id === rabbitId)),
    [store.workspaces, rabbitId],
  );

  const isAnswered = message.answered === true;
  const isExpired = message.expired === true;
  // 已回答或已失效均进入只读态（失效后 sidecar 上下文丢失，无法再回答）
  const readOnly = isAnswered || isExpired;

  // 切换选项
  const toggleOption = (questionIdx: number, label: string, multiSelect: boolean) => {
    if (readOnly) return;
    setSelectedOptions(prev => {
      const current = new Set(prev[questionIdx] ?? []);
      if (multiSelect) {
        if (current.has(label)) {
          current.delete(label);
        } else {
          current.add(label);
        }
      } else {
        current.clear();
        current.add(label);
      }
      return { ...prev, [questionIdx]: current };
    });
  };

  // 提交回答
  const handleSubmit = () => {
    if (!ws || readOnly) return;
    const answers: Record<string, string> = {};
    for (let i = 0; i < message.questions.length; i++) {
      const q = message.questions[i];
      const selected = selectedOptions[i] ?? new Set<string>();
      answers[q.question] = Array.from(selected).join(', ');
    }
    void respondToQuestion(rabbitId, message.requestId, answers, customText.trim() || undefined);
  };

  // 取消
  const handleCancel = () => {
    if (!ws || readOnly) return;
    void cancelQuestion(rabbitId, message.requestId);
  };

  // 检查所有问题是否已选
  const allAnswered = message.questions.every((_, i) => (selectedOptions[i]?.size ?? 0) > 0);

  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 my-2 overflow-hidden">
      {/* 头部 */}
      <div className={`flex items-center gap-2 px-3 py-2 border-b ${isExpired ? 'border-gray-200 dark:border-gray-700' : 'border-blue-200 dark:border-blue-800'}`}>
        <HelpCircle size={14} className={`shrink-0 ${isExpired ? 'text-gray-400 dark:text-gray-500' : 'text-blue-500 dark:text-blue-400'}`} />
        <span className={`text-xs font-medium ${isExpired ? 'text-gray-500 dark:text-gray-400' : 'text-blue-700 dark:text-blue-300'}`}>
          {isExpired ? '已失效 · 会话已重启' : isAnswered ? '已回答' : '需要你的输入'}
        </span>
      </div>

      {/* 问题列表 */}
      <div className="px-3 py-2 space-y-3">
        {message.questions.map((q, qi) => (
          <QuestionItem
            key={qi}
            question={q}
            selected={selectedOptions[qi] ?? new Set<string>()}
            userAnswer={message.userAnswers?.[q.question]}
            isAnswered={isAnswered}
            disabled={readOnly}
            onToggle={(label) => toggleOption(qi, label, q.multiSelect)}
          />
        ))}

        {/* 自定义文本输入（仅未回答且未失效时） */}
        {!readOnly && (
          <div>
            <textarea
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="补充说明（可选）…"
              rows={2}
              className="w-full rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-600"
            />
          </div>
        )}

        {/* 操作按钮 */}
        {!readOnly ? (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 rounded-md px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X size={12} />
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!allAnswered}
              className="flex items-center gap-1 rounded-md bg-[#E8702A] hover:bg-[#D56020] dark:bg-[#F5824C] dark:hover:bg-[#E8702A] text-white text-xs font-medium px-3 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={12} />
              提交
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 单个问题项 */
function QuestionItem({
  question,
  selected,
  userAnswer,
  isAnswered,
  disabled,
  onToggle,
}: {
  question: AskUserQuestionItem;
  selected: Set<string>;
  userAnswer?: string;
  isAnswered: boolean;
  disabled: boolean;
  onToggle: (label: string) => void;
}) {
  // 已回答时，高亮用户选择的选项
  const userAnswerSet = useMemo(() => {
    if (!userAnswer) return new Set<string>();
    return new Set(userAnswer.split(', ').map(s => s.trim()).filter(Boolean));
  }, [userAnswer]);

  return (
    <div>
      {/* 问题标题 */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300">
          {question.header}
        </span>
        <span className="text-xs text-gray-600 dark:text-gray-400">{question.question}</span>
      </div>

      {/* 选项列表 */}
      <div className="space-y-1">
        {question.options.map((opt, oi) => {
          const isUserSelected = isAnswered
            ? userAnswerSet.has(opt.label)
            : selected.has(opt.label);
          return (
            <button
              key={oi}
              onClick={() => onToggle(opt.label)}
              disabled={disabled}
              className={`w-full text-left rounded-md border px-2.5 py-1.5 transition-colors ${
                isUserSelected
                  ? 'border-[#E8702A] dark:border-[#F5824C] bg-[#E8702A]/5 dark:bg-[#F5824C]/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              } ${isAnswered ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-2">
                <div className={`mt-0.5 shrink-0 ${question.multiSelect ? 'rounded-sm' : 'rounded-full'} w-3.5 h-3.5 border ${
                  isUserSelected
                    ? 'border-[#E8702A] dark:border-[#F5824C] bg-[#E8702A] dark:bg-[#F5824C] flex items-center justify-center'
                    : 'border-gray-300 dark:border-gray-600'
                }`}>
                  {isUserSelected && <Check size={10} className="text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-700 dark:text-gray-300">{opt.label}</div>
                  {opt.description && (
                    <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{opt.description}</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
