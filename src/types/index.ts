export interface Repo {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface Rabbit {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
  pinned?: boolean;
  // ---- Agent SDK 字段 ----
  sessionId?: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  messages: AgentMessage[];
  model: string;
  costUsd?: number;
  durationMs?: number;
  error?: string;
  // ---- Token 统计 ----
  tokenUsage?: TokenUsage;
  /** 当前 turn 的实时上下文占用（来自 message_start，覆盖式更新） */
  currentUsage?: TokenUsage;
  numTurns?: number;
  // ---- 会话压缩 ----
  compactionPhase?: 'compacting' | 'done' | 'failed' | null;
  // ---- Spec 文档 ----
  /** 本会话通过 WriteSpec 工具写入的 Spec 文档路径列表（可能有多个） */
  specFilePaths?: string[];
}

export interface Workspace {
  id: string;
  name: string;
  path?: string;
  rabbits: Rabbit[];
  repos: Repo[];
  collapsed: boolean;
  createdAt: number;
}

export type CodeWikiLanguage = 'zh' | 'en';

export interface KnowledgeBaseConfig {
  language: CodeWikiLanguage;
  autoUpdate: boolean;
  autoExport: boolean;
  referenceEnabled: boolean;
  generatedAt?: number;
}

export interface CodeWikiEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: CodeWikiEntry[];
}

export interface UserInfo {
  name: string;
  email: string;
  avatar?: string;
  plan: 'free' | 'pro';
  usageUsed: number;
  usageLimit: number;
}

export interface ContextMenuAction {
  label: string;
  action: () => void;
  danger?: boolean;
  dividerBelow?: boolean;
  icon?: string;
}

// ============================================================
// Agent SDK 消息类型（与 sidecar/src/protocol.ts 对齐）
// ============================================================

/** Agent 消息联合类型 */
export type AgentMessage =
  | UserMessage
  | SystemInitMessage
  | AssistantTextDeltaMessage
  | AssistantThinkingDeltaMessage
  | AssistantTextDoneMessage
  | AssistantThinkingDoneMessage
  | AssistantThinkingMessage
  | AssistantTextMessage
  | AssistantToolUseMessage
  | ToolResultMessage
  | ResultMessage
  | AgentErrorMessage
  | SpecGeneratingMessage
  | SpecConfirmationMessage
  | SpecWrittenMessage
  | CompactionStatusMessage
  | CompactionResultMessage
  | UsageUpdateMessage
  | AskUserQuestionMessage;

/** 用户发送的消息 */
export interface UserMessage {
  type: 'user';
  text: string;
}

/** 系统初始化消息 */
export interface SystemInitMessage {
  type: 'system';
  subtype: 'init';
  sessionId: string;
}

/** Claude 流式文本 */
export interface AssistantTextMessage {
  type: 'assistant';
  subtype: 'text';
  text: string;
}

/** Claude 深度思考过程 */
export interface AssistantThinkingMessage {
  type: 'assistant';
  subtype: 'thinking';
  thinking: string;
  durationMs: number;
}

/** 流式文本增量 */
export interface AssistantTextDeltaMessage {
  type: 'assistant';
  subtype: 'text_delta';
  delta: string;
}

/** 流式思考增量 */
export interface AssistantThinkingDeltaMessage {
  type: 'assistant';
  subtype: 'thinking_delta';
  delta: string;
}

/** 流式内容结束信号 */
export interface AssistantTextDoneMessage {
  type: 'assistant';
  subtype: 'text_done';
}

/** 思考结束信号（携带持续时间） */
export interface AssistantThinkingDoneMessage {
  type: 'assistant';
  subtype: 'thinking_done';
  durationMs: number;
}

/** 工具调用 */
export interface AssistantToolUseMessage {
  type: 'assistant';
  subtype: 'tool_use';
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

/** 工具执行结果 */
export interface ToolResultMessage {
  type: 'tool_result';
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
  type: 'result';
  subtype: 'success' | 'error';
  result?: string;
  totalCostUsd?: number;
  durationMs?: number;
  error?: string;
  numTurns?: number;
  usage?: TokenUsage;
}

/** 错误消息 */
export interface AgentErrorMessage {
  type: 'error';
  queryId?: string;
  message: string;
}

/** Spec 文档生成中状态消息 */
export interface SpecGeneratingMessage {
  type: 'spec_generating';
}

/** Spec 文档生成确认消息 */
export interface SpecConfirmationMessage {
  type: 'spec_confirmation';
  specFilePath: string;
  specFileName: string;
  /** Spec 摘要（前几行内容），用于在聊天中预览 */
  specSummary?: string;
}

/** Spec 已通过 WriteSpec 工具写入的消息（来自 sidecar） */
export interface SpecWrittenMessage {
  type: 'spec_written';
  specContent: string;
  specFilePath: string;
}

/** 会话压缩状态消息 */
export interface CompactionStatusMessage {
  type: 'compaction';
  phase: 'compacting' | 'done' | 'failed';
  error?: string;
}

/** 会话压缩结果消息（含 token 统计） */
export interface CompactionResultMessage {
  type: 'compaction_result';
  trigger: 'manual' | 'auto';
  preTokens: number;
  postTokens?: number;
  durationMs?: number;
}

/** 实时 Token 用量更新（来自 message_start，表示当前 turn 的上下文占用） */
export interface UsageUpdateMessage {
  type: 'usage_update';
  usage: TokenUsage;
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

/** AskUserQuestion 提问消息 */
export interface AskUserQuestionMessage {
  type: 'ask_user_question';
  requestId: string;
  questions: AskUserQuestionItem[];
  /** 前端状态：是否已回答 */
  answered?: boolean;
  /** 前端状态：用户的回答 */
  userAnswers?: Record<string, string>;
  /** 前端状态：因会话重启已失效（sidecar 上下文丢失，无法再回答） */
  expired?: boolean;
}

/** Agent Event 包装结构（从 Rust emit 过来的） */
export interface AgentEventPayload {
  data: string; // JSON string of AgentEvent
}

/** Agent Event 结构（sidecar stdout 每行的格式） */
export interface AgentEvent {
  queryId: string;
  payload: AgentMessage;
}

/** Agent 查询选项 */
export interface AgentQueryOptions {
  model: string;
  allowedTools: string[];
  permissionMode: 'acceptEdits' | 'dontAsk' | 'bypassPermissions' | 'plan';
  maxTurns?: number;
  maxBudgetUsd?: number;
}

/** Sidecar 运行状态 */
export type SidecarStatus = 'starting' | 'running' | 'stopped' | 'error';

/** TodoWrite 工具的单条 Todo 项 */
export interface TodoItem {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** Task 工具的单条任务项（TaskCreate/TaskUpdate 聚合后的结构） */
export interface TaskTodoItem {
  taskId: string;
  subject: string;
  description: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

// ============================================================
// 模型配置（Model Management）
// ============================================================

/** 模型厂商类型 */
export type ModelProvider = 'glm' | 'minimax' | 'aliyun' | 'kimi' | 'deepseek' | 'custom';

/** 单个模型配置（存储在 localStorage 'model-configs' 键） */
export interface ModelConfig {
  /** 主键 UUID */
  id: string;
  /** 用户自定义显示名称 */
  name: string;
  /** 厂商类型 */
  provider: ModelProvider;
  /** 模型标识符，传给 API 的 model 字段 */
  modelId: string;
  /** API Base URL */
  baseUrl: string;
  /** API Key */
  apiKey: string;
  /** API Key 注入运行环境时的环境变量名 */
  apiKeyEnvVar: string;
  /** 额外的自定义环境变量 key=value */
  envVars: Record<string, string>;
  /** 是否启用（禁用的模型不出现在选择器中） */
  enabled: boolean;
  /** 创建时间戳 */
  createdAt: number;
  /** 上下文窗口大小（tokens），默认 200000 */
  maxContextTokens?: number;
}

/** 模型连接测试结果（由 test_model_connection 命令返回，字段对齐 Rust 的 camelCase 输出） */
export interface ModelTestResult {
  /** 是否连通且鉴权通过、模型可用 */
  success: boolean;
  /** HTTP 状态码（网络层失败时为 null） */
  statusCode: number | null;
  /** 请求耗时（毫秒） */
  latencyMs: number | null;
  /** 服务端回显的 model 字段，用于确认 modelId 被接受 */
  modelEcho: string | null;
  /** 友好错误描述（失败时填充） */
  error: string | null;
}

// ============================================================
// 智能体配置（Agent Configuration）
// ============================================================

/** 内置专家团子智能体角色 */
export type BuiltinAgentRole =
  | 'researcher'
  | 'fullstack'
  | 'qa'
  | 'reviewer'
  | 'ui_operator'
  | 'debugger';

/** 内置专家团子智能体配置 */
export interface BuiltinAgentConfig {
  role: BuiltinAgentRole;
  /** 关联模型ID（引用 ModelConfig.id），空字符串 = 使用默认模型 */
  modelId: string;
  /** 技能列表 */
  skills: string[];
  /** MCP 服务列表 */
  mcp: string[];
  /** 追加提示词 */
  additionalPrompt: string;
}

/** 自定义子智能体配置 */
export interface CustomAgentConfig {
  id: string;
  name: string;
  description: string;
  /** 关联模型ID（引用 ModelConfig.id），空字符串 = 使用默认模型 */
  modelId: string;
  /** 允许使用的工具列表 */
  tools: string[];
  /** 系统提示词 */
  systemPrompt: string;
  /** 是否启用 */
  enabled: boolean;
  createdAt: number;
}

/** 单个范围（用户级 / 工作区级）的完整智能体配置 */
export interface AgentScopeConfig {
  /** '__user__' 为全局默认，其余为 workspace.id */
  scope: string;
  builtinAgents: BuiltinAgentConfig[];
  customAgents: CustomAgentConfig[];
}

// ============================================================
// MCP 服务配置（MCP Server Configuration）
// ============================================================

/** MCP Server 传输类型 */
export type McpServerType = 'stdio' | 'http' | 'sse';

/**
 * 单个 MCP Server 配置（存储在 localStorage 'mcp-server-configs' 键）
 *
 * 不同类型使用的字段：
 * - stdio: command + args + env
 * - http:  url + headers
 * - sse:   url + headers
 */
export interface McpServerConfig {
  /** 主键 UUID */
  id: string;
  /** 用户自定义显示名称 */
  name: string;
  /** 传输类型 */
  type: McpServerType;

  // ---- stdio 类型字段 ----
  /** 可执行命令，如 "npx" / "node" */
  command?: string;
  /** 命令参数数组，如 ["-y", "@modelcontextprotocol/server-filesystem"] */
  args?: string[];
  /** 环境变量键值对 */
  env?: Record<string, string>;

  // ---- http / sse 类型字段 ----
  /** 服务端 URL */
  url?: string;
  /** 自定义 HTTP 请求头 */
  headers?: Record<string, string>;

  /** 是否启用 */
  enabled: boolean;
  /** 创建时间戳 */
  createdAt: number;
}

// ============================================================
// 网络诊断（Network Diagnostics）
// ============================================================

/** 代理检测信息 */
export interface ProxyInfo {
  enabled: boolean;
  source?: string;
  address?: string;
}

/** DNS 诊断结果 */
export interface DnsResult {
  host: string;
  proxy: ProxyInfo;
  server?: string;
  resolvedIps: string[];
  resolutionMs?: number;
  status: string;
  error?: string;
}

/** HTTP 诊断结果 */
export interface HttpResult {
  endpoint: string;
  method: string;
  proxy: ProxyInfo;
  statusCode?: number;
  httpVersion?: string;
  tlsVersion?: string;
  responseTimeMs?: number;
  contentType?: string;
  remoteIp?: string;
  status: string;
  error?: string;
}

/** Ping 诊断结果 */
export interface PingResult {
  target: string;
  ip?: string;
  packetsSent?: number;
  packetsReceived?: number;
  packetLossPercent?: number;
  rttMinMs?: number;
  rttAvgMs?: number;
  rttMaxMs?: number;
  status: string;
  error?: string;
}

/** Marketplace 诊断结果 */
export interface MarketplaceResult {
  endpoint: string;
  proxy: ProxyInfo;
  connectionOk: boolean;
  apiAvailable: boolean;
  statusCode?: number;
  responseTimeMs?: number;
  status: string;
  error?: string;
}

// ============================================================
// 网络代理配置（Proxy Configuration）
// ============================================================

/** 网络代理配置（存储在 localStorage 'proxy-config' 键） */
export interface ProxyConfig {
  /** 是否启用代理 */
  enabled: boolean;
  /** HTTP 代理地址，如 http://127.0.0.1:7890 */
  httpProxy: string;
  /** HTTPS 代理地址，如 http://127.0.0.1:7890 */
  httpsProxy: string;
  /** SOCKS 代理地址，如 socks5://127.0.0.1:1080 */
  socksProxy: string;
  /** 不走代理的地址（逗号分隔），如 localhost,127.0.0.1 */
  noProxy: string;
}

// ============================================================
// 集成配置（Integration Configuration）
// ============================================================

/** 集成服务类型 */
export type IntegrationProvider = 'github';

/** GitHub OAuth 连接配置（存储在 localStorage 'integration-configs' 键） */
export interface IntegrationConfig {
  /** 主键 UUID */
  id: string;
  /** 服务类型 */
  provider: IntegrationProvider;
  /** 是否已连接 */
  connected: boolean;
  /** GitHub 用户名（login） */
  accountName: string;
  /** GitHub 头像 URL */
  avatarUrl: string;
  /** OAuth access token */
  token: string;
  /** 连接时间戳 */
  connectedAt: number;
}

// ============================================================
// 代码库索引（Codebase Index / GitNexus）
// ============================================================

/** 索引项类型 */
export type IndexItemType = 'docs' | 'repo';

/** 索引项状态 */
export type IndexItemStatus = 'idle' | 'indexing' | 'indexed' | 'error' | 'stale';

/** Group sync 状态 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

/** Rust gitnexus_check 命令返回 */
export interface GitnexusCheckResult {
  installed: boolean;
  version?: string;
  path?: string;
}

/** Rust gitnexus_list / gitnexus_analyze 命令返回的单个项 */
export interface GitnexusItem {
  name: string;
  path: string;
  indexed: boolean;
}

/** Rust gitnexus-progress 事件的 payload */
export interface GitnexusProgress {
  itemKey: string;
  workspaceId: string;
  itemType: 'docs' | 'repo' | 'group_sync';
  status: 'running' | 'done' | 'error';
  message: string;
  timestamp: number;
}

/** 单个索引项的运行时状态 */
export interface IndexItemState {
  itemKey: string;
  itemType: IndexItemType;
  path: string;
  label: string;
  status: IndexItemStatus;
  lastMessage?: string;
  indexedAt?: number;
}

// ============================================================
// 问题反馈（Feedback）
// ============================================================

/** Rust capture_app_window 返回 */
export interface ScreenCaptureResult {
  base64Png: string;
  width: number;
  height: number;
}

/** Rust collect_system_info 返回 */
export interface FeedbackSystemInfo {
  os: string;
  osVersion: string;
  arch: string;
  appVersion: string;
  appIdentifier: string;
  cpuBrand: string;
  cpuCores: number;
  totalMemoryMb: number;
}

/** 模型配置概要（不含 API Key） */
export interface ModelSummary {
  name: string;
  provider: string;
  modelId: string;
  baseUrl: string;
  enabled: boolean;
}

/** MCP 服务概要 */
export interface McpSummary {
  name: string;
  serverType: string;
  enabled: boolean;
}

/** 代理状态（脱敏） */
export interface ProxyStatus {
  enabled: boolean;
  hasHttpProxy: boolean;
  hasHttpsProxy: boolean;
  hasSocksProxy: boolean;
}

/** 配置摘要 */
export interface ConfigSummary {
  models: ModelSummary[];
  enabledMcpServers: McpSummary[];
  proxy: ProxyStatus;
}

/** WebView 性能指标（前端采集） */
export interface WebviewMetrics {
  domElements: number;
  jsHeapUsedMb: number;
  jsHeapTotalMb: number;
  timingDomCompleteMs: number;
}

/** Rust collect_performance_metrics 返回 */
export interface FeedbackPerformanceMetrics {
  appMemoryMb: number;
  appCpuPercent: number;
  systemMemoryUsagePercent: number;
  systemCpuUsagePercent: number;
  webviewMetrics: WebviewMetrics;
}

/** Rust submit_feedback 返回 */
export interface FeedbackSubmitResult {
  success: boolean;
  message: string;
  ticketId?: string;
}

/** 反馈描述信息 */
export interface FeedbackDescription {
  steps: string;
  expected: string;
  occurredAt: string;
  email: string;
}

/** 提交到 Rust 的完整 payload */
export interface FeedbackPayload {
  screenshots: string[];
  description: FeedbackDescription;
  systemInfo: FeedbackSystemInfo;
  configSummary: ConfigSummary;
  performanceMetrics?: FeedbackPerformanceMetrics;
}

// ============================================================
// 全局待办（Sidebar Todo）
// ============================================================

/** 全局待办项（存储在 localStorage 'sidebar-todos' 键） */
export interface SidebarTodo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

// ============================================================
// AI Wiki 生成（AI Wiki Generation）
// ============================================================

/** 单个失败文档记录 */
export interface FailedDoc {
  path: string;
  error: string;
  retries: number;
}

/** 单个 repo 的 wiki 生成元数据 */
export interface RepoMeta {
  status: string;
  catalogDone: boolean;
  completedDocs: string[];
  failedDocs: FailedDoc[];
}

/** Wiki 生成断点续传元数据 */
export interface WikiMeta {
  version: number;
  workspaceName: string;
  modelId: string;
  language: string;
  generatedAt: number;
  status: string;
  catalogDone: boolean;
  completedDocs: string[];
  failedDocs: FailedDoc[];
  repos: Record<string, RepoMeta>;
}

// ============================================================
// Casdoor 认证（Casdoor Auth）
// ============================================================

/** Casdoor 登录返回的完整用户信息 */
export interface CasdoorUser {
  /** 用户名 */
  username: string;
  /** 显示名 */
  displayName: string;
  /** 邮箱 */
  email: string;
  /** 头像 URL */
  avatar: string;
  /** OAuth access_token */
  accessToken: string;
  /** 登录时间戳 */
  loggedInAt: number;
}
