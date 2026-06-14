/**
 * ToolCallBlock 组件
 *
 * 展示 Agent 的工具调用（Read, Edit, Bash, Glob 等），
 * 包括工具图标、名称、输入摘要和可折叠详情。
 */

import { memo, useState } from 'react';
import {
  FileText,
  Terminal,
  Edit3,
  Search,
  FolderSearch,
  Globe,
  ChevronDown,
  AlertCircle,
  FilePlus,
  FilePenLine,
} from 'lucide-react';
import { TodoListBlock } from './TodoListBlock';
import { isTaskTool } from './todoUtils';
import type { AssistantToolUseMessage, ToolResultMessage } from '../../types';
import { useI18n } from '../../i18n/useI18n';

interface ToolCallBlockProps {
  toolUse: AssistantToolUseMessage;
  result?: ToolResultMessage;
}

/** 工具图标映射 */
const TOOL_ICONS: Record<string, typeof FileText> = {
  Read: FileText,
  Write: Edit3,
  Edit: Edit3,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  WebSearch: Globe,
  WebFetch: Globe,
};

/** 工具显示名称 key 映射 */
const TOOL_LABEL_KEYS: Record<string, string> = {
  Read: 'agent.toolCall.read',
  Write: 'agent.toolCall.write',
  Edit: 'agent.toolCall.edit',
  Bash: 'agent.toolCall.bash',
  Glob: 'agent.toolCall.glob',
  Grep: 'agent.toolCall.grep',
  WebSearch: 'agent.toolCall.webSearch',
  WebFetch: 'agent.toolCall.webFetch',
};

/** 从工具输入中提取简短摘要 */
function getToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Read':
      return String(input.file_path ?? input.filePath ?? '');
    case 'Write':
      return String(input.file_path ?? input.filePath ?? '');
    case 'Edit':
      return String(input.file_path ?? input.filePath ?? '');
    case 'Bash':
      return String(input.command ?? '').substring(0, 80);
    case 'Glob':
      return String(input.pattern ?? '');
    case 'Grep':
      return String(input.pattern ?? '');
    case 'WebSearch':
      return String(input.query ?? '');
    case 'WebFetch':
      return String(input.url ?? '');
    default:
      return JSON.stringify(input).substring(0, 80);
  }
}

/** 从路径中提取文件名 */
function getFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

/** 计算文件变更的增减行数 */
function computeFileChange(toolName: string, input: Record<string, unknown>): { added: number; removed: number; changeType: 'Add' | 'Modify' } {
  if (toolName === 'Write') {
    const content = String(input.file_content ?? input.content ?? '');
    const added = content ? content.split('\n').length : 0;
    return { added, removed: 0, changeType: 'Add' };
  }
  if (toolName === 'Edit' || toolName === 'SearchReplace') {
    const oldText = String(input.old_text ?? input.original_text ?? '');
    const newText = String(input.new_text ?? input.new_text ?? '');
    const removed = oldText ? oldText.split('\n').length : 0;
    const added = newText ? newText.split('\n').length : 0;
    return { added, removed, changeType: 'Modify' };
  }
  return { added: 0, removed: 0, changeType: 'Modify' };
}

/** 判断是否为文件变更类工具 */
function isFileChangeTool(toolName: string): boolean {
  return toolName === 'Write' || toolName === 'Edit' || toolName === 'SearchReplace';
}

/** 文件变更消息 */
function FileChangeLine({ toolUse, result }: ToolCallBlockProps) {
  const filePath = String(toolUse.toolInput.file_path ?? toolUse.toolInput.filePath ?? '');
  const fileName = getFileName(filePath);
  const { added, removed, changeType } = computeFileChange(toolUse.toolName, toolUse.toolInput);
  const isError = result?.isError;

  return (
    <div className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 ${isError ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30' : ''}`}>
      {changeType === 'Add' ? (
        <FilePlus size={13} className="shrink-0 text-emerald-500" />
      ) : (
        <FilePenLine size={13} className="shrink-0 text-blue-500" />
      )}
      <span className="text-[#141414] dark:text-gray-100 truncate" title={filePath}>{fileName}</span>
      {added > 0 && <span className="text-emerald-600 dark:text-emerald-400 shrink-0">+{added}</span>}
      {removed > 0 && <span className="text-red-500 dark:text-red-400 shrink-0">-{removed}</span>}
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${
        changeType === 'Add'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
      }`}>
        {changeType}
      </span>
    </div>
  );
}

function ToolCallBlockInner({ toolUse, result }: ToolCallBlockProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  // Task 工具（TaskCreate/TaskUpdate）：委托给专用组件
  if (isTaskTool(toolUse.toolName)) {
    return <TodoListBlock toolUse={toolUse} />;
  }

  // 文件变更类工具：紧凑行展示
  if (isFileChangeTool(toolUse.toolName)) {
    return <FileChangeLine toolUse={toolUse} result={result} />;
  }

  const Icon = TOOL_ICONS[toolUse.toolName] ?? FileText;
  const label = TOOL_LABEL_KEYS[toolUse.toolName] ? t(TOOL_LABEL_KEYS[toolUse.toolName]) : toolUse.toolName;
  const summary = getToolSummary(toolUse.toolName, toolUse.toolInput);
  const hasResult = !!result;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
      {/* 工具调用头部 */}
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <Icon size={14} className={`shrink-0 ${result?.isError ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`} />
        <span className="text-xs font-medium text-[#141414] dark:text-gray-100">{label}</span>
        <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-1">{summary}</span>
        {hasResult && result?.isError && (
          <AlertCircle size={12} className="text-red-400 dark:text-red-500 shrink-0" />
        )}
        <ChevronDown
          size={12}
          className={`shrink-0 text-gray-400 dark:text-gray-500 transition-transform ${expanded ? '' : '-rotate-90'}`}
        />
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2">
          {/* 工具输入 */}
          <div className="mb-2">
            <span className="text-xs text-gray-400 dark:text-gray-500">{t('agent.toolCall.input')}</span>
            <pre className="mt-1 text-xs text-[#141414] dark:text-gray-100 bg-white dark:bg-[#2a2a2a] rounded p-2 overflow-x-auto border border-gray-100 dark:border-gray-800">
              {JSON.stringify(toolUse.toolInput, null, 2)}
            </pre>
          </div>

          {/* 工具结果 */}
          {hasResult && (
            <div>
              <span className="text-xs text-gray-400 dark:text-gray-500">{t('agent.toolCall.output')}</span>
              <pre className={`mt-1 text-xs rounded p-2 overflow-x-auto border ${result.isError ? 'bg-red-50 border-red-200 text-red-600 dark:bg-red-950/30 dark:border-red-900 dark:text-red-400' : 'bg-white border-gray-100 text-[#141414] dark:bg-[#2a2a2a] dark:border-gray-800 dark:text-gray-100'}`}>
                {result.output.substring(0, 2000)}
                {result.output.length > 2000 ? '\n...(truncated)' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ToolCallBlock = memo(ToolCallBlockInner);
