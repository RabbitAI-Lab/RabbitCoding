/**
 * TodoListBlock 组件
 *
 * 展示 Claude TodoWrite / TaskCreate / TaskUpdate 工具调用的任务清单。
 *
 * TodoWrite：toolInput.todos 数组，直接渲染为完整 checklist 卡片
 * TaskCreate：创建单个任务，渲染为紧凑行
 * TaskUpdate：更新状态，渲染为状态变更行
 *
 * 注意：工具函数已拆分至 ./todoUtils.ts，确保 Fast Refresh 正常工作。
 */

import { memo } from 'react';
import { Circle, Loader2, CheckCircle2 } from 'lucide-react';
import type { AssistantToolUseMessage } from '../../types';
import { useI18n } from '../../i18n/useI18n';
import { parseTodos, parseTaskCreate, parseTaskUpdate } from './todoUtils';

interface TodoListBlockProps {
  toolUse: AssistantToolUseMessage;
}

// ─── 状态图标组件 ─────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 size={14} className="shrink-0 mt-px text-emerald-500" />;
  if (status === 'in_progress') return <Loader2 size={14} className="shrink-0 mt-px text-blue-500 animate-spin" />;
  return <Circle size={14} className="shrink-0 mt-px text-gray-300 dark:text-gray-600" />;
}

function statusTextClass(status: string): string {
  if (status === 'completed') return 'text-gray-400 dark:text-gray-500 line-through';
  if (status === 'in_progress') return 'text-[#141414] dark:text-gray-100 font-medium';
  return 'text-gray-500 dark:text-gray-400';
}

// ─── TodoWrite 渲染：完整 checklist 卡片 ──────────────────────

function TodoWriteCard({ toolUse }: { toolUse: AssistantToolUseMessage }) {
  const { t } = useI18n();
  const todos = parseTodos(toolUse.toolInput);
  if (todos.length === 0) return null;

  const completedCount = todos.filter(t => t.status === 'completed').length;
  const totalCount = todos.length;
  const progress = totalCount > 0 ? completedCount / totalCount : 0;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/30 dark:border-blue-900/50 dark:bg-blue-950/20 overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{t('agent.todoList.taskList')}</span>
        <span className="text-xs text-blue-400 ml-auto shrink-0">{completedCount}/{totalCount}</span>
        <div className="h-1 w-16 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden shrink-0">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
      {/* 列表 */}
      <div className="flex flex-col gap-0.5 px-3 pb-2">
        {todos.map((todo, i) => (
          <div key={i} className="flex items-start gap-2 py-0.5">
            <StatusIcon status={todo.status} />
            <span className={`text-xs leading-relaxed ${statusTextClass(todo.status)}`}>
              {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── TaskCreate / TaskUpdate 渲染 ─────────────────────────────

const STATUS_KEYS: Record<string, string> = {
  in_progress: 'agent.todoList.inProgress',
  completed: 'agent.todoList.completed',
  pending: 'agent.todoList.pending',
};

function TaskToolLine({ toolUse }: { toolUse: AssistantToolUseMessage }) {
  const { t } = useI18n();
  if (toolUse.toolName === 'TaskCreate') {
    const p = parseTaskCreate(toolUse.toolInput);
    if (!p) return null;
    return (
      <div className="flex items-start gap-2 px-3 py-1.5 text-xs rounded-lg border border-blue-100 bg-blue-50/30 dark:border-blue-900/50 dark:bg-blue-950/20">
        <Circle size={14} className="shrink-0 mt-px text-blue-400" />
        <span className="text-[#141414] dark:text-gray-100">{p.subject}</span>
      </div>
    );
  }

  if (toolUse.toolName === 'TaskUpdate') {
    const p = parseTaskUpdate(toolUse.toolInput);
    if (!p) return null;
    return (
      <div className="flex items-start gap-2 px-3 py-1.5 text-xs rounded-lg border border-blue-100 bg-blue-50/30 dark:border-blue-900/50 dark:bg-blue-950/20">
        <StatusIcon status={p.status} />
        <span className={`text-[#141414] dark:text-gray-100 ${p.status === 'completed' ? 'line-through text-gray-400 dark:text-gray-500' : ''}`}>
          {p.status === 'in_progress' && p.activeForm ? p.activeForm : p.subject}
        </span>
        <span className={`ml-auto shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${
          p.status === 'completed'
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
            : p.status === 'in_progress'
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
        }`}>
          {STATUS_KEYS[p.status] ? t(STATUS_KEYS[p.status]) : p.status}
        </span>
      </div>
    );
  }

  return null;
}

// ─── 主组件 ───────────────────────────────────────────────────

function TodoListBlockInner({ toolUse }: TodoListBlockProps) {
  if (toolUse.toolName === 'TodoWrite') {
    return <TodoWriteCard toolUse={toolUse} />;
  }
  return <TaskToolLine toolUse={toolUse} />;
}

export const TodoListBlock = memo(TodoListBlockInner);
