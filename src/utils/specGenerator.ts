/**
 * Spec 生成工具模块
 *
 * 核心思路：不依赖 Agent 使用 Write 工具写文件（模型可能写错路径）。
 * 改为让 Agent 纯文本生成 spec 内容，从 result.result 提取，
 * 前端用 writeTextFile 写入指定路径。路径由前端控制，绝对可靠。
 */

import { listen } from '@tauri-apps/api/event';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import type {
  AgentEventPayload,
  AgentEvent,
  AgentMessage,
  AgentQueryOptions,
  ResultMessage,
} from '../types';

const SPEC_PREFIX = '__spec__';

/** 根据用户输入 + 时间戳生成文件名 */
export function generateSpecFileName(userPrompt: string): string {
  const slug = userPrompt
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `${slug || 'spec'}_${ts}.md`;
}

/**
 * 从 spec 内容提取摘要（标题 + 前几行描述）
 * 用于在聊天界面中预览 spec 内容
 */
export function extractSpecSummary(content: string, maxLen = 400): string {
  const lines = content.split('\n');
  const summaryLines: string[] = [];
  let foundTitle = false;
  let charCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 找到第一个 # 标题作为 spec 标题
    if (trimmed.startsWith('#')) {
      if (!foundTitle) {
        summaryLines.push(trimmed.replace(/^#+\s*/, ''));
        foundTitle = true;
        continue;
      } else {
        // 遇到第二个标题，停止收集
        break;
      }
    }

    // 标题之后的内容，收集到 maxLen
    if (foundTitle) {
      if (charCount + trimmed.length > maxLen) {
        const remaining = maxLen - charCount;
        summaryLines.push(trimmed.slice(0, remaining) + '...');
        break;
      }
      summaryLines.push(trimmed);
      charCount += trimmed.length + 1;
    }

    if (summaryLines.length >= 6) break;
  }

  // 如果没找到标题，取前几行非空行
  if (summaryLines.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        summaryLines.push(trimmed);
        if (summaryLines.length >= 3 || charCount >= maxLen) break;
        charCount += trimmed.length + 1;
      }
    }
  }

  let summary = summaryLines.join('\n');
  if (summary.length > maxLen) {
    summary = summary.slice(0, maxLen) + '...';
  }
  return summary;
}

/** 构造 spec 生成的 prompt */
function buildSpecPrompt(userPrompt: string): string {
  return `You are a specification writer. Based on the following user request, write a detailed technical specification document.

You can use Read, Glob, Grep, and Ls tools to explore the existing project structure and codebase before writing the spec. This will help you create a more accurate and project-specific specification.

IMPORTANT: After completing your analysis and writing the specification, you MUST call the WriteSpec tool to save the specification document to the .rabbit/specs/ directory. Do NOT output the specification as plain text - use the WriteSpec tool to save it.

Do NOT generate a plan. Do not call ExitPlanMode, and do not produce any plan document or leave any files under a .claude/plans/ directory. Your only deliverable is the specification document saved via the WriteSpec tool.

User Request: "${userPrompt}"

The specification should include:
1. **项目概述**
2. **需求分析**
3. **技术方案**
4. **实现计划**
5. **验收标准**

Steps:
1. Explore the codebase using Read, Glob, Grep tools
2. Write the specification content
3. Call the WriteSpec tool with the full specification content to save it`;
}

/** Spec 生成的超时时间（毫秒），防止 listener 丢失事件或 sidecar 无响应时永久阻塞 */
const SPEC_TIMEOUT_MS = 300_000;

/** generateSpec 返回类型 */
export interface GenerateSpecResult {
  /** Spec 完整内容（成功时），失败时为 null */
  content: string | null;
  /** Spec 生成会话的 session ID，用于 resume */
  sessionId: string | null;
  /** WriteSpec 工具实际写入的文件路径（来自 sidecar） */
  specFilePath: string | null;
}

/**
 * 单次执行：发送查询 → 等待 result → 返回 spec 内容 + session ID
 *
 * 返回值：
 * - content: spec 完整内容（成功时），失败时为 null
 * - sessionId: spec 生成会话的 session ID（用于后续 resume）
 *
 * 文件写入方式：
 * - 优先由 Agent 调用 WriteSpec 工具写入（sidecar 处理）
 * - Fallback：如果 Agent 未调用 WriteSpec 而是输出文本，前端写入
 */
export async function generateSpec(
  startQuery: (
    queryId: string,
    prompt: string,
    cwd: string,
    options: AgentQueryOptions,
  ) => Promise<void>,
  userPrompt: string,
  specFilePath: string,
  cwd: string,
  model: string,
  onStream?: (message: AgentMessage) => void,
): Promise<GenerateSpecResult> {
  const queryId = `${SPEC_PREFIX}${Date.now()}`;
  const prompt = buildSpecPrompt(userPrompt);

  // 发送查询并等待 result（带超时保护）
  const { resultText, specWrittenContent, specWrittenFilePath, sessionId } = await waitForSpecResult(startQuery, queryId, prompt, cwd, model, onStream);

  // spec 已通过 WriteSpec 工具写入，直接返回内容
  if (specWrittenContent) {
    return { content: specWrittenContent, sessionId, specFilePath: specWrittenFilePath };
  }
  // Fallback：从 result 文本提取并写入
  if (resultText && resultText.trim().length > 0) {
    await writeTextFile(specFilePath, resultText);
    return { content: resultText, sessionId, specFilePath };
  }
  return { content: null, sessionId, specFilePath: null };
}

/** waitForSpecResult 返回类型 */
interface SpecResult {
  /** result.result 文本（fallback 路径） */
  resultText: string | null;
  /** WriteSpec 工具写入的 spec 内容（主要路径） */
  specWrittenContent: string | null;
  /** WriteSpec 工具实际写入的文件路径 */
  specWrittenFilePath: string | null;
  /** Spec 生成会话的 session ID（来自 system(init) 消息） */
  sessionId: string | null;
}

/**
 * 监听 agent:message 事件，等待指定 queryId 的 result 消息
 * 返回 { resultText, specWrittenContent }
 *
 * ★ 修复竞态条件：先 await listen 注册完成，再 startQuery
 *   原实现中 listen() 和 startQuery() 并行执行，如果 sidecar 响应极快，
 *   result 事件可能在 listener 注册完成前到达，导致 Promise 永远不 resolve。
 *
 * ★ 添加超时保护：SPEC_TIMEOUT_MS 后自动 resolve，防止永久阻塞。
 */
async function waitForSpecResult(
  startQuery: (
    queryId: string,
    prompt: string,
    cwd: string,
    options: AgentQueryOptions,
  ) => Promise<void>,
  queryId: string,
  prompt: string,
  cwd: string,
  model: string,
  onStream?: (message: AgentMessage) => void,
): Promise<SpecResult> {
  return new Promise((resolve) => {
    let resolved = false;
    let unlistenFn: (() => void) | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let specWrittenContent: string | null = null;
    let specWrittenFilePath: string | null = null;
    let sessionId: string | null = null;

    const cleanup = () => {
      if (unlistenFn) {
        unlistenFn();
        unlistenFn = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const doResolve = (value: SpecResult) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(value);
    };

    // ★ 关键修复：先注册 listener，等待注册完成后再发送查询
    listen<AgentEventPayload>('agent:message', (event) => {
      if (resolved) return;
      try {
        const agentEvent: AgentEvent = JSON.parse(event.payload.data);
        if (agentEvent.queryId !== queryId) return;
        if (agentEvent.payload.type === 'result') {
          const result = agentEvent.payload as ResultMessage;
          if (result.subtype === 'success') {
            console.log('[Spec] Received result(success), resolving:', { hasContent: !!specWrittenContent, filePath: specWrittenFilePath });
            doResolve({ resultText: result.result ?? null, specWrittenContent, specWrittenFilePath, sessionId });
          } else {
            console.log('[Spec] Received result(non-success), resolving:', { hasContent: !!specWrittenContent, filePath: specWrittenFilePath });
            doResolve({ resultText: null, specWrittenContent, specWrittenFilePath, sessionId });
          }
        } else if (agentEvent.payload.type === 'error') {
          doResolve({ resultText: null, specWrittenContent, specWrittenFilePath, sessionId });
        } else {
          // 检测 spec_written 消息（来自 WriteSpec 工具 handler）
          if (agentEvent.payload.type === 'spec_written') {
            specWrittenContent = (agentEvent.payload as any).specContent ?? null;
            specWrittenFilePath = (agentEvent.payload as any).specFilePath ?? null;
            console.log('[Spec] Received spec_written:', { hasContent: !!specWrittenContent, filePath: specWrittenFilePath });
          }
          // 捕获 spec session ID（来自 system(init) 消息）
          if (agentEvent.payload.type === 'system' && (agentEvent.payload as any).subtype === 'init') {
            sessionId = (agentEvent.payload as any).sessionId ?? null;
          }
          // 透传流式消息（assistant text_delta/thinking_delta/tool_use/tool_result 等）
          onStream?.(agentEvent.payload);
        }
      } catch {
        /* ignore parse errors */
      }
    }).then((fn) => {
      // listener 可能已在回调中 resolve（竞态保护）
      if (resolved) {
        fn();
        return;
      }
      unlistenFn = fn;

      // ★ listener 注册完成，现在安全地发送查询
      // plan 模式 + 只读工具白名单：允许检索目录、读取文件，禁止写入/执行
      // AskUserQuestion 用于在 Spec 生成时向用户提问以明确需求
      startQuery(queryId, prompt, cwd, {
        model,
        allowedTools: ['Read', 'Glob', 'Grep', 'Ls', 'AskUserQuestion', 'mcp__rabbit-spec__WriteSpec'],
        permissionMode: 'plan',
        maxTurns: 5,
      }).catch(() => {
        console.error('[Spec] startQuery failed for spec generation');
        doResolve({ resultText: null, specWrittenContent: null, specWrittenFilePath: null, sessionId: null });
      });
    }).catch((err) => {
      console.error('[Spec] listen() registration failed:', err);
      doResolve({ resultText: null, specWrittenContent: null, specWrittenFilePath: null, sessionId: null });
    });

    // ★ 超时保护：防止 listener 丢失事件或 sidecar 无响应时永久阻塞
    timeoutId = setTimeout(() => {
      console.warn(`[Spec] Spec generation timed out after ${SPEC_TIMEOUT_MS / 1000}s`);
      doResolve({ resultText: null, specWrittenContent: null, specWrittenFilePath: null, sessionId: null });
    }, SPEC_TIMEOUT_MS);
  });
}
