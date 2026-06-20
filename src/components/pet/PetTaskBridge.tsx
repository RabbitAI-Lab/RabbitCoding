import { useEffect, useMemo } from 'react';
import { emitTo, listen } from '@tauri-apps/api/event';
import type { useWorkspaces } from '../../hooks/useWorkspaces';
import type { AgentMessage, AssistantToolUseMessage, Rabbit, ToolResultMessage } from '../../types';
import { aggregateTasksFromMessages, getLatestTodoWriteTodos } from '../agent/todoUtils';
import type { PetTask, PetTasksPayload } from './types';

interface PetTaskBridgeProps {
  store: ReturnType<typeof useWorkspaces>;
}

const MAX_PET_TASKS = 5;

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function summarizeTool(toolUse: AssistantToolUseMessage) {
  const input = toolUse.toolInput;
  switch (toolUse.toolName) {
    case 'Read':
      return `Reading ${String(input.file_path ?? input.filePath ?? '')}`;
    case 'Write':
      return `Writing ${String(input.file_path ?? input.filePath ?? '')}`;
    case 'Edit':
      return `Editing ${String(input.file_path ?? input.filePath ?? '')}`;
    case 'Bash':
      return `Running ${String(input.command ?? '')}`;
    case 'Glob':
      return `Finding ${String(input.pattern ?? '')}`;
    case 'Grep':
      return `Searching ${String(input.pattern ?? '')}`;
    case 'WebSearch':
      return `Searching web: ${String(input.query ?? '')}`;
    case 'WebFetch':
      return `Fetching ${String(input.url ?? '')}`;
    default:
      return toolUse.toolName;
  }
}

function messageOutput(message: AgentMessage): string {
  if (message.type === 'assistant') {
    if (message.subtype === 'text') return message.text;
    if (message.subtype === 'text_delta') return message.delta;
    if (message.subtype === 'thinking') return message.thinking;
    if (message.subtype === 'thinking_delta') return message.delta;
    if (message.subtype === 'tool_use') return summarizeTool(message);
  }
  if (message.type === 'tool_result') return message.output;
  if (message.type === 'error') return message.message;
  if (message.type === 'result') return message.result ?? message.error ?? '';
  if (message.type === 'compaction') return message.error ?? `Compaction ${message.phase}`;
  if (message.type === 'compaction_result') {
    return `Context compacted ${message.preTokens}${message.postTokens ? ` -> ${message.postTokens}` : ''}`;
  }
  if (message.type === 'ask_user_question') return 'Waiting for your answer';
  if (message.type === 'spec_confirmation') return `Spec ready: ${message.specFileName}`;
  if (message.type === 'spec_written') return `Spec written: ${message.specFilePath}`;
  if (message.type === 'spec_generating') return 'Generating spec';
  return '';
}

function latestRabbitOutput(rabbit: Rabbit) {
  for (let i = rabbit.messages.length - 1; i >= 0; i -= 1) {
    const output = cleanText(messageOutput(rabbit.messages[i]));
    if (output) return output.slice(0, 260);
  }
  return rabbit.status === 'running' ? 'Working...' : '';
}

function buildTasksForRabbit(rabbit: Rabbit): PetTask[] {
  const output = latestRabbitOutput(rabbit);
  const todos = getLatestTodoWriteTodos(rabbit.messages)
    .filter(todo => todo.status === 'in_progress')
    .map((todo, index): PetTask => ({
      id: `${rabbit.id}:todo:${index}:${todo.content}`,
      title: todo.activeForm || todo.content,
      output,
      status: 'running',
    }));

  if (todos.length > 0) return todos;

  const taskToolItems = aggregateTasksFromMessages(rabbit.messages)
    .filter(task => task.status === 'in_progress')
    .map((task): PetTask => ({
      id: `${rabbit.id}:task:${task.taskId}`,
      title: task.activeForm || task.subject,
      output,
      status: 'running',
    }));

  if (taskToolItems.length > 0) return taskToolItems;

  const activeTool = [...rabbit.messages]
    .reverse()
    .find((message): message is AssistantToolUseMessage =>
      message.type === 'assistant' && message.subtype === 'tool_use'
    );
  const activeToolResult = activeTool
    ? rabbit.messages.find((message): message is ToolResultMessage =>
      message.type === 'tool_result' && message.toolUseId === activeTool.toolUseId
    )
    : undefined;

  return [{
    id: `${rabbit.id}:task`,
    title: activeTool && !activeToolResult ? summarizeTool(activeTool) : rabbit.title,
    output,
    status: rabbit.status === 'error' ? 'error' : 'running',
  }];
}

function buildPetTasks(store: ReturnType<typeof useWorkspaces>): PetTask[] {
  return store.workspaces
    .flatMap(workspace =>
      workspace.rabbits
        .filter(rabbit => rabbit.status === 'running')
        .flatMap(rabbit => buildTasksForRabbit(rabbit))
    )
    .slice(0, MAX_PET_TASKS)
    .map(task => ({
      ...task,
      title: cleanText(task.title).slice(0, 80) || 'Working',
      output: cleanText(task.output).slice(0, 260) || 'Working...',
    }));
}

async function sendPetTasks(tasks: PetTask[]) {
  const payload: PetTasksPayload = {
    tasks,
    updatedAt: Date.now(),
  };
  try {
    await emitTo('pet', 'pet:tasks', payload);
  } catch {
    // The pet window may not be available in a plain browser preview.
  }
}

export default function PetTaskBridge({ store }: PetTaskBridgeProps) {
  const tasks = useMemo(() => buildPetTasks(store), [store]);
  const signature = useMemo(() => JSON.stringify(tasks), [tasks]);

  useEffect(() => {
    void sendPetTasks(tasks);
  }, [signature, tasks]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    listen('pet:request-sync', () => {
      void sendPetTasks(tasks);
    }).then(unlisten => {
      if (cancelled) {
        unlisten();
      } else {
        cleanup = unlisten;
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [tasks]);

  return null;
}
