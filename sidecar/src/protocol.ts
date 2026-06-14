/**
 * JSON-lines 通信协议类型定义
 *
 * Sidecar stdin/stdout 之间传输的消息格式。
 * 前端通过 Tauri Commands 写入 stdin，Sidecar 将结果写入 stdout。
 * Rust 后端读取 stdout 并通过 Tauri Events 转发到前端。
 */

// ============================================================
// 前端 → Sidecar（通过 stdin）
// ============================================================

/** 启动新的 Agent 查询 */
export interface StartQueryCommand {
  type: "start_query";
  id: string;
  prompt: string;
  cwd: string;
  options: QueryOptions;
}

/** 恢复已有会话 */
export interface ResumeQueryCommand {
  type: "resume_query";
  id: string;
  sessionId: string;
  prompt: string;
  cwd: string;
  options: QueryOptions;
}

/** 取消当前查询 */
export interface CancelQueryCommand {
  type: "cancel_query";
  id: string;
}

/** 关闭 Sidecar */
export interface ShutdownCommand {
  type: "shutdown";
}

/** 手动触发会话压缩 */
export interface CompactQueryCommand {
  type: "compact_query";
  id: string;
  sessionId: string;
  cwd: string;
  options: QueryOptions;
}

/** 响应 AskUserQuestion 提问（前端 → Sidecar） */
export interface RespondToolRequestCommand {
  type: "respond_tool_request";
  requestId: string;
  answers: Record<string, string>;
  response?: string;
  cancelled?: boolean;
}

/** 查询选项 */
export interface QueryOptions {
  model: string;
  allowedTools: string[];
  permissionMode: "acceptEdits" | "dontAsk" | "bypassPermissions" | "plan";
  maxTurns?: number;
  maxBudgetUsd?: number;
  specEnabled?: boolean;
}

/** 所有前端→Sidecar 命令的联合类型 */
export type InboundMessage =
  | StartQueryCommand
  | ResumeQueryCommand
  | CancelQueryCommand
  | CompactQueryCommand
  | RespondToolRequestCommand
  | ShutdownCommand;

// ============================================================
// Sidecar → 前端（通过 stdout，Rust 通过 Tauri Event 转发）
// ============================================================

/** 包装结构：Tauri Event payload */
export interface AgentEvent {
  queryId: string;
  payload: AgentMessage;
}

/** Agent 消息联合类型 */
export type AgentMessage =
  | SystemInitMessage
  | AssistantTextDeltaMessage
  | AssistantThinkingDeltaMessage
  | AssistantTextDoneMessage
  | AssistantThinkingDoneMessage
  | AssistantTextMessage
  | AssistantThinkingMessage
  | AssistantToolUseMessage
  | ToolResultMessage
  | ResultMessage
  | ErrorMessage
  | CompactionStatusMessage
  | CompactionResultMessage
  | UsageUpdateMessage
  | AskUserQuestionMessage
  | SpecWrittenMessage;

/** 系统初始化消息 */
export interface SystemInitMessage {
  type: "system";
  subtype: "init";
  sessionId: string;
}

/** Claude 流式文本 */
export interface AssistantTextMessage {
  type: "assistant";
  subtype: "text";
  text: string;
}

/** Claude 深度思考过程 */
export interface AssistantThinkingMessage {
  type: "assistant";
  subtype: "thinking";
  thinking: string;
  durationMs: number;
}

/** 流式文本增量 */
export interface AssistantTextDeltaMessage {
  type: "assistant";
  subtype: "text_delta";
  delta: string;
}

/** 流式思考增量 */
export interface AssistantThinkingDeltaMessage {
  type: "assistant";
  subtype: "thinking_delta";
  delta: string;
}

/** 流式内容结束信号 */
export interface AssistantTextDoneMessage {
  type: "assistant";
  subtype: "text_done";
}

/** 思考结束信号（携带持续时间） */
export interface AssistantThinkingDoneMessage {
  type: "assistant";
  subtype: "thinking_done";
  durationMs: number;
}

/** 工具调用 */
export interface AssistantToolUseMessage {
  type: "assistant";
  subtype: "tool_use";
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResultMessage {
  type: "tool_result";
  toolUseId: string;
  output: string;
  isError: boolean;
}

/** Token 用量明细 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

/** 最终结果 */
export interface ResultMessage {
  type: "result";
  subtype: "success" | "error";
  result?: string;
  totalCostUsd?: number;
  durationMs?: number;
  error?: string;
  numTurns?: number;
  usage?: TokenUsage;
}

/** 错误消息 */
export interface ErrorMessage {
  type: "error";
  queryId?: string;
  message: string;
}

/** 会话压缩状态消息 */
export interface CompactionStatusMessage {
  type: "compaction";
  phase: "compacting" | "done" | "failed";
  error?: string;
}

/** 实时 Token 用量更新（来自 message_start，表示当前 turn 的上下文占用） */
export interface UsageUpdateMessage {
  type: "usage_update";
  usage: TokenUsage;
}

/** 会话压缩结果消息（含 token 统计） */
export interface CompactionResultMessage {
  type: "compaction_result";
  trigger: "manual" | "auto";
  preTokens: number;
  postTokens?: number;
  durationMs?: number;
}

/** AskUserQuestion 选项 */
export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

/** AskUserQuestion 单个问题 */
export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

/** AskUserQuestion 提问消息（Sidecar → 前端） */
export interface AskUserQuestionMessage {
  type: "ask_user_question";
  requestId: string;
  questions: AskUserQuestionItem[];
}

/** Spec 已通过 WriteSpec 工具写入的消息 */
export interface SpecWrittenMessage {
  type: "spec_written";
  specContent: string;
  specFilePath: string;
}
