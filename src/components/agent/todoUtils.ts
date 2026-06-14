/**
 * TodoListBlock 相关工具函数
 *
 * 从 TodoListBlock.tsx 中拆分出来，使组件文件仅导出 React 组件，
 * 确保 Vite Fast Refresh 正常工作。
 */

import type { AssistantToolUseMessage, TodoItem, TaskTodoItem } from '../../types';

/** 判断是否为任务类工具调用 */
export function isTaskTool(toolName: string): boolean {
  return toolName === 'TodoWrite' || toolName === 'TaskCreate' || toolName === 'TaskUpdate';
}

// ─── TodoWrite：安全解析 todos 数组 ────────────────────────────

export function parseTodos(toolInput: Record<string, unknown>): TodoItem[] {
  const raw = toolInput.todos;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is TodoItem =>
      item != null &&
      typeof item === 'object' &&
      typeof item.content === 'string' &&
      typeof item.status === 'string' &&
      ['pending', 'in_progress', 'completed'].includes(item.status)
  );
}

/** 从消息列表中取最后一次 TodoWrite 的 todos */
export function getLatestTodoWriteTodos(messages: any[]): TodoItem[] {
  const todoWrites = messages.filter(
    (m): m is AssistantToolUseMessage =>
      m.type === 'assistant' && m.subtype === 'tool_use' && m.toolName === 'TodoWrite'
  );
  if (todoWrites.length === 0) return [];
  const lastCall = todoWrites[todoWrites.length - 1];
  return parseTodos(lastCall.toolInput);
}

// ─── Task 工具：聚合 ──────────────────────────────────────────

export function parseTaskCreate(input: Record<string, unknown>) {
  const subject = String(input.subject ?? '');
  if (!subject) return null;
  return {
    taskId: String(input.task_id ?? ''),
    subject,
    description: String(input.description ?? ''),
    activeForm: String(input.activeForm ?? ''),
  };
}

export function parseTaskUpdate(input: Record<string, unknown>) {
  const taskId = String(input.taskId ?? '');
  if (!taskId) return null;
  return {
    taskId,
    status: String(input.status ?? ''),
    activeForm: String(input.activeForm ?? ''),
    subject: String(input.subject ?? ''),
  };
}

export function aggregateTasksFromMessages(messages: any[]): TaskTodoItem[] {
  const taskMap = new Map<string, TaskTodoItem>();
  for (const msg of messages) {
    if (msg.type !== 'assistant' || msg.subtype !== 'tool_use') continue;
    if (msg.toolName === 'TaskCreate' && msg.toolInput) {
      const p = parseTaskCreate(msg.toolInput);
      if (p) {
        const id = p.taskId || `task-${taskMap.size}`;
        taskMap.set(id, {
          taskId: id,
          subject: p.subject,
          description: p.description,
          activeForm: p.activeForm,
          status: 'pending',
        });
      }
    }
    if (msg.toolName === 'TaskUpdate' && msg.toolInput) {
      const p = parseTaskUpdate(msg.toolInput);
      if (p && taskMap.has(p.taskId)) {
        const existing = taskMap.get(p.taskId)!;
        if (p.status && ['pending', 'in_progress', 'completed'].includes(p.status)) {
          existing.status = p.status as TaskTodoItem['status'];
        }
        if (p.activeForm) existing.activeForm = p.activeForm;
        if (p.subject) existing.subject = p.subject;
      }
    }
  }
  return Array.from(taskMap.values());
}
