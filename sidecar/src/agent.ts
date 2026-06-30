/**
 * Claude Agent SDK 封装
 *
 * 将 SDK 的 query() AsyncGenerator 转换为 JSON-lines 格式的流式输出。
 * SDK 消息类型：
 *   - system(init)  → 初始化，含 session_id
 *   - assistant     → BetaMessage，content 含 text / tool_use / tool_result 块
 *   - result        → 最终结果（success / error）
 *   - 其他（user, status, tool_progress 等）忽略
 */

import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as nodePath from "path";
import * as nodeFs from "fs/promises";
import type {
  StartQueryCommand,
  ResumeQueryCommand,
  CompactQueryCommand,
  RewindFilesCommand,
  AgentEvent,
  AgentMessage,
  TokenUsage,
  AskUserQuestionItem,
} from "./protocol.js";

/**
 * 检测生产环境下的原生 CLI 二进制路径
 *
 * esbuild 打包后，SDK 无法通过 node_modules 解析平台特定的原生二进制。
 * 生产模式下，原生二进制被复制到 bundle 同目录（resources/sidecar/claude）。
 * 开发模式下，该文件不存在，返回 undefined，SDK 走 node_modules 正常解析。
 */
function resolveNativeCliBinary(): string | undefined {
  try {
    const here = nodePath.dirname(fileURLToPath(import.meta.url));
    const binName = process.platform === "win32" ? "claude.exe" : "claude";
    const candidate = nodePath.join(here, binName);
    if (existsSync(candidate)) return candidate;
  } catch {}
  return undefined;
}

const NATIVE_CLI_BINARY = resolveNativeCliBinary();

/**
 * 检测已安装并启用的插件，返回 SDK plugins 配置
 *
 * 读取 CLAUDE_CONFIG_DIR 下的：
 *   - settings.json → enabledPlugins（哪些插件被启用）
 *   - plugins/installed_plugins.json → installPath（插件实际路径）
 *
 * 通过 SDK query() 的 plugins 参数显式注入插件，
 * 使插件的 hooks/agents/commands/skills 在 sidecar 中生效。
 * 这独立于 settingSources: [] 的隔离设计——
 * settingSources 阻止文件系统 settings 覆盖 BYOK，
 * 而 plugins 参数只注入扩展能力，不影响 API 配置。
 */
function resolveInstalledPlugins(): Array<{ type: 'local'; path: string }> {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (!configDir) return [];

  try {
    // 1. 读取 settings.json 获取启用的插件
    const settingsPath = nodePath.join(configDir, 'settings.json');
    if (!existsSync(settingsPath)) return [];
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const enabledPlugins: Record<string, boolean> = settings.enabledPlugins || {};

    // 2. 读取 installed_plugins.json 获取安装路径
    const installedPath = nodePath.join(configDir, 'plugins', 'installed_plugins.json');
    if (!existsSync(installedPath)) return [];
    const installed = JSON.parse(readFileSync(installedPath, 'utf-8'));
    const pluginsMap: Record<string, Array<{ installPath: string; lastUpdated?: string }>> =
      installed.plugins || {};

    // 3. 匹配：只加载 enabledPlugins 中为 true 且已安装的插件
    const result: Array<{ type: 'local'; path: string }> = [];
    for (const [pluginKey, enabled] of Object.entries(enabledPlugins)) {
      if (!enabled) continue;
      const entries = pluginsMap[pluginKey];
      if (!Array.isArray(entries) || entries.length === 0) continue;

      // 取最新版本（lastUpdated 最新的）
      const latest = entries.reduce((a, b) =>
        (b.lastUpdated || '') > (a.lastUpdated || '') ? b : a
      );
      if (latest.installPath && existsSync(latest.installPath)) {
        result.push({ type: 'local', path: latest.installPath });
        process.stderr.write(`[agent] plugin loaded: ${pluginKey} → ${latest.installPath}\n`);
      }
    }
    if (result.length === 0) {
      process.stderr.write(`[agent] no plugins enabled (configDir=${configDir})\n`);
    } else {
      process.stderr.write(`[agent] plugins summary: ${result.length} plugin(s) loaded\n`);
    }
    return result;
  } catch (err) {
    process.stderr.write(`[agent] resolveInstalledPlugins error: ${err}\n`);
    return [];
  }
}

/** 活跃查询管理 */
const activeQueries = new Map<string, AbortController>();

/** 追踪 spec 是否已通过 WriteSpec 工具写入 */
const specWrittenQueries = new Set<string>();

/** AskUserQuestion 的 pending request */
interface PendingToolRequest {
  queryId: string;
  resolve: (result: any) => void;
  timer: ReturnType<typeof setTimeout>;
  /** 原始 questions 数组，resolve 时需传回给 SDK */
  questions: AskUserQuestionItem[];
}

/** AskUserQuestion 等待用户回复的请求 Map */
const pendingToolRequests = new Map<string, PendingToolRequest>();

/** 生成唯一 requestId */
let requestCounter = 0;
function generateRequestId(): string {
  requestCounter++;
  return `req-${Date.now()}-${requestCounter}`;
}

/**
 * 发送一个 AgentEvent 到 stdout（JSON-lines 格式）
 */
function emit(queryId: string, payload: AgentMessage): void {
  const event: AgentEvent = { queryId, payload };
  process.stdout.write(JSON.stringify(event) + "\n");
}

/**
 * 创建 Spec 写入 MCP 服务器
 * 提供 WriteSpec 工具，让 Agent 在 plan 模式下写入 spec 文档到 .rabbit/specs/ 目录
 */
function createSpecMcpServer(queryId: string, cwd: string) {
  const writeSpecTool = tool(
    "WriteSpec",
    "Write the specification document to the .rabbit/specs/ directory. You MUST call this tool to save your specification as a markdown file before finishing.",
    {
      content: z.string().describe("The full specification document content in Markdown format"),
      filename: z.string().optional().describe("Optional custom filename (without directory path). If omitted, one will be auto-generated."),
    },
    async (args: { content: string; filename?: string }) => {
      const specsDir = nodePath.join(cwd, ".rabbit", "specs");
      await nodeFs.mkdir(specsDir, { recursive: true });

      const now = new Date();
      const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
      const fname = args.filename || `spec_${ts}.md`;
      const filePath = nodePath.join(specsDir, fname);

      await nodeFs.writeFile(filePath, args.content, "utf-8");
      specWrittenQueries.add(queryId);

      process.stderr.write(`[agent] WriteSpec: spec written to ${filePath}\n`);

      // 通知前端 spec 已写入，携带 spec 内容供前端展示摘要
      emit(queryId, {
        type: "spec_written",
        specContent: args.content,
        specFilePath: filePath,
      });

      // 异步中止 spec 查询（让当前 tool handler 先正常返回 result 给 SDK）
      // abort 后 SDK 在下次迭代时抛出 AbortError，runQuery catch 会 emit result(success)
      setTimeout(() => {
        const controller = activeQueries.get(queryId);
        if (controller) {
          controller.abort();
          process.stderr.write(`[agent] WriteSpec: aborted spec query to exit session\n`);
        }
      }, 0);

      return {
        content: [{ type: "text" as const, text: `Specification successfully written to ${filePath}` }],
      };
    }
  );

  return createSdkMcpServer({
    name: "rabbit-spec",
    version: "1.0.0",
    tools: [writeSpecTool],
    alwaysLoad: true,
  });
}

/**
 * 处理 SDK 流式增量事件（stream_event）
 *
 * BetaRawMessageStreamEvent 包含：
 *   - content_block_start: 新内容块开始（thinking / text / tool_use）
 *   - content_block_delta: 增量文本（thinking_delta / text_delta）
 *   - content_block_stop: 内容块结束
 *   - message_start / message_delta / message_stop: 消息级事件
 */
function processStreamEvent(queryId: string, event: any, thinkingStartTime: { value: number }): void {
  if (!event || !event.type) return;

  // message_delta：每个 turn 结束时携带 per-turn usage（真实 token 数据）
  if (event.type === "message_delta") {
    const usage = event.usage;
    if (usage && typeof usage.input_tokens === "number") {
      emit(queryId, {
        type: "usage_update",
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
        },
      });
    }
    return;
  }

  if (event.type === "content_block_start") {
    const block = event.content_block;
    if (!block) return;

    if (block.type === "thinking") {
      thinkingStartTime.value = Date.now();
      emit(queryId, { type: "assistant", subtype: "thinking_delta", delta: "" });
    } else if (block.type === "text") {
      emit(queryId, { type: "assistant", subtype: "text_delta", delta: "" });
    }
    return;
  }

  if (event.type === "content_block_delta") {
    const delta = event.delta;
    if (!delta) return;

    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      emit(queryId, { type: "assistant", subtype: "thinking_delta", delta: delta.thinking });
    } else if (delta.type === "text_delta" && typeof delta.text === "string") {
      emit(queryId, { type: "assistant", subtype: "text_delta", delta: delta.text });
    }
    return;
  }

  if (event.type === "content_block_stop") {
    if (thinkingStartTime.value > 0) {
      const durationMs = Date.now() - thinkingStartTime.value;
      emit(queryId, { type: "assistant", subtype: "thinking_done", durationMs });
      thinkingStartTime.value = 0;
    }
    return;
  }
}

/**
 * 从 SDK assistant 消息的 content blocks 中提取工具相关消息
 * （text/thinking 已通过 delta 流式发送，这里只处理 tool_use 和 tool_result）
 */
function processAssistantToolContent(queryId: string, content: any[], thinkingDurationMs: number): void {
  for (const block of content) {
    if (!block || typeof block !== "object") continue;

    if (block.type === "tool_use") {
      emit(queryId, {
        type: "assistant",
        subtype: "tool_use",
        toolUseId: block.id ?? "",
        toolName: block.name ?? "",
        toolInput: block.input ?? {},
      });
    } else if (block.type === "tool_result") {
      const output =
        typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .map((c: any) =>
                  typeof c === "string" ? c : c.text ?? JSON.stringify(c)
                )
                .join("\n")
            : JSON.stringify(block.content);
      emit(queryId, {
        type: "tool_result",
        toolUseId: block.tool_use_id ?? "",
        output,
        isError: block.is_error ?? false,
      });
    }
  }
}

/**
 * 运行 Agent 查询的通用逻辑
 */
async function runQuery(
  id: string,
  prompt: string,
  options: StartQueryCommand["options"],
  extraOptions: Record<string, unknown> = {}
): Promise<void> {
  const abortController = new AbortController();
  activeQueries.set(id, abortController);

  const startTime = Date.now();
  let turnStartTime = Date.now();
  const thinkingStartTime = { value: 0 };

  try {
    const queryOptions: Record<string, any> = {
      cwd: (extraOptions as any).cwd,
      model: options.model,
      allowedTools: options.allowedTools,
      permissionMode: options.permissionMode,
      canUseTool: async (toolName: string, input: Record<string, unknown>, toolOptions: any) => {
        // 诊断日志：打印 input 类型和值，排查 ZodError 根因
        const rawInput = input as unknown;
        const inputType = rawInput === null ? "null" : rawInput === undefined ? "undefined" : Array.isArray(rawInput) ? "array" : typeof rawInput;
        process.stderr.write(`[agent] canUseTool called: ${toolName} | input type=${inputType}`);
        if (rawInput !== null && rawInput !== undefined && typeof rawInput === "object") {
          process.stderr.write(` keys=[${Object.keys(rawInput).join(",")}]`);
        } else if (typeof rawInput === "string") {
          process.stderr.write(` val="${(rawInput as string).substring(0, 100)}"`);
        }
        process.stderr.write("\n");

        // 防御性修复：第三方模型（如 GLM-5.2）可能返回 null/undefined/string 类型的 input
        // 导致 CLI 内部 Zod 校验失败（ZodError: Invalid input）
        // 对所有工具都确保 input 是干净的 plain object，并通过 updatedInput 传回 CLI
        // 这样 CLI 不会使用模型原始的（可能有问题的）input，而是使用我们清洗后的版本
        let cleanInput: Record<string, unknown>;
        let needsUpdate = false;
        if (rawInput === null || rawInput === undefined || typeof rawInput !== "object") {
          process.stderr.write(`[agent] WARNING: ${toolName} input is ${inputType}, normalizing to {}\n`);
          cleanInput = {};
          needsUpdate = true;
        } else {
          // input 已经是对象，但可能包含不可序列化的值或原型链问题
          // 用 JSON 往返确保是纯 plain object
          try {
            cleanInput = JSON.parse(JSON.stringify(rawInput)) as Record<string, unknown>;
            // 如果 JSON 往返后内容不一致，说明原始 input 有问题
            needsUpdate = cleanInput !== rawInput;
          } catch {
            process.stderr.write(`[agent] WARNING: ${toolName} input is not JSON-serializable, using {}\n`);
            cleanInput = {};
            needsUpdate = true;
          }
        }

        // Spec 查询（__spec__ 前缀）特殊处理
        if (id.startsWith("__spec__")) {
          // WriteSpec MCP 工具：允许（用于写入 spec 文档）
          if (toolName === "mcp__rabbit-spec__WriteSpec") {
            process.stderr.write(`[agent] Allowing WriteSpec for spec query\n`);
            const result: Record<string, unknown> = { behavior: "allow" as const, toolUseID: toolOptions.toolUseID };
            if (needsUpdate) result.updatedInput = cleanInput;
            process.stderr.write(`[agent] canUseTool return: ${JSON.stringify(result)}\n`);
            return result;
          }
          // ExitPlanMode：永远拦截，spec 查询不退出 plan 模式
          if (toolName === "ExitPlanMode") {
            process.stderr.write(`[agent] Blocked ExitPlanMode for spec query (never exit plan)\n`);
            return {
              behavior: "deny" as const,
              message: specWrittenQueries.has(id)
                ? "The specification has been saved successfully. You can now finish your response without calling ExitPlanMode."
                : "You must call the WriteSpec tool to save the specification document first. Do not call ExitPlanMode.",
            };
          }
        }

        // 非 AskUserQuestion 工具：自动放行
        if (toolName !== "AskUserQuestion") {
          const result: Record<string, unknown> = { behavior: "allow" as const, toolUseID: toolOptions.toolUseID };
          // 对 MCP 工具（mcp__ 开头），始终通过 updatedInput 传回清洗后的 input
          // 这确保 CLI 使用合法的 plain object，而非模型可能返回的非标准格式
          if (needsUpdate || toolName.startsWith("mcp__")) {
            result.updatedInput = cleanInput;
          }
          process.stderr.write(`[agent] canUseTool return: ${JSON.stringify(result)}\n`);
          return result;
        }
        // AskUserQuestion：发消息到前端，等待用户回答
        return handleAskUserQuestion(id, input, toolOptions);
      },
      abortController,
      maxTurns: options.maxTurns,
      maxBudgetUsd: options.maxBudgetUsd,
      thinking: { type: "adaptive" },
      includePartialMessages: true,
      // 启用文件检查点：CLI 自动在文件修改前将备份写入 ~/.claude/file-history/{sessionId}/
      // replay-user-messages: 必须设置，否则 SDK 不在响应流中回放 user 消息的 uuid
      // 仅对编码查询启用（spec 查询 id 以 __spec__ 开头时跳过）
      ...(id.startsWith("__spec__") ? {} : {
        enableFileCheckpointing: true,
        extraArgs: { "replay-user-messages": null },
      }),
      // SDK 层兜底：不加载任何文件系统 settings。
      // 主隔离手段是 sidecar.rs 注入的 CLAUDE_CONFIG_DIR（指向应用专用空目录），
      // 它一刀切断 ~/.claude/ 下的 settings/plugins/skills/agents/commands/hooks
      // 等全部全局资源。此处 settingSources:[] 作为 SDK 级冗余兜底，
      // 防止残留的 settings.env 覆盖 BYOK。
      settingSources: [],
      ...(extraOptions as any),
      ...(NATIVE_CLI_BINARY ? { pathToClaudeCodeExecutable: NATIVE_CLI_BINARY } : {}),
    };

    // 对 Spec 查询注入 WriteSpec MCP 工具
    if (id.startsWith("__spec__")) {
      const specCwd = (extraOptions as any).cwd;
      if (specCwd) {
        queryOptions.mcpServers = { "rabbit-spec": createSpecMcpServer(id, specCwd) };
      }
    }

    // 移除 undefined 值
    for (const key of Object.keys(queryOptions)) {
      if (queryOptions[key] === undefined) {
        delete queryOptions[key];
      }
    }

    // 当 allowedTools 非空时，自动追加 MCP 工具通配符
    // allowedTools 是白名单机制——不在列表中的工具会被 CLI 过滤掉。
    // 插件加载的 MCP 工具名以 mcp__ 开头，前端不可能预知所有名字，
    // 因此用 mcp__ 前缀通配符让所有 MCP 工具都可用。
    if (Array.isArray(queryOptions.allowedTools) && queryOptions.allowedTools.length > 0) {
      const hasMcpWildcard = queryOptions.allowedTools.some(
        (t: string) => t === "mcp__" || t === "mcp__*"
      );
      if (!hasMcpWildcard) {
        queryOptions.allowedTools.push("mcp__");
        process.stderr.write(`[agent] allowedTools: appended \"mcp__\" wildcard for plugin MCP tools\n`);
      }
    }

    // 加载已安装并启用的插件（claude-mem 等）
    // 通过 SDK plugins 参数显式注入，使插件的 hooks/agents/commands/skills 生效
    const installedPlugins = resolveInstalledPlugins();
    if (installedPlugins.length > 0) {
      queryOptions.plugins = installedPlugins;
    }

    process.stderr.write(`[agent] === Query Runtime ===\n`);
    process.stderr.write(`[agent] queryId: ${id}\n`);
    process.stderr.write(`[agent] cwd: ${(extraOptions as any).cwd}\n`);
    process.stderr.write(`[agent] CLAUDE_CONFIG_DIR: ${process.env.CLAUDE_CONFIG_DIR || "(not set)"}\n`);
    process.stderr.write(`[agent] nativeCli: ${NATIVE_CLI_BINARY || "(node_modules default)"}\n`);
    process.stderr.write(`[agent] plugins: ${installedPlugins.length} enabled${installedPlugins.length > 0 ? " → " + installedPlugins.map(p => p.path).join(", ") : ""}\n`);
    process.stderr.write(`[agent] model: ${options.model || "(default)"}\n`);
    process.stderr.write(`[agent] ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL || "(default)"}\n`);
    process.stderr.write(`[agent] ANTHROPIC_API_KEY prefix: ${(process.env.ANTHROPIC_API_KEY || "").substring(0, 12)}...\n`);
    process.stderr.write(`[agent] ========================\n`);

    for await (const message of query({ prompt, options: queryOptions })) {
      const msg = message as any;


      // 处理系统初始化消息
      if (msg.type === "system" && msg.subtype === "init") {
        emit(id, {
          type: "system",
          subtype: "init",
          sessionId: msg.session_id ?? "",
        });
        continue;
      }

      // 处理会话压缩状态消息（status）
      if (msg.type === "system" && msg.subtype === "status") {
        if (msg.status === "compacting") {
          emit(id, { type: "compaction", phase: "compacting" });
        } else if (msg.compact_result === "failed") {
          emit(id, { type: "compaction", phase: "failed", error: msg.compact_error });
        }
        // status === 'requesting' 或 null：压缩正常结束，等 compact_boundary 消息
        continue;
      }

      // 处理会话压缩边界消息（compact_boundary）
      if (msg.type === "system" && msg.subtype === "compact_boundary") {
        const meta = msg.compact_metadata;
        emit(id, {
          type: "compaction_result",
          trigger: meta?.trigger ?? "auto",
          preTokens: meta?.pre_tokens ?? 0,
          postTokens: meta?.post_tokens,
          durationMs: meta?.duration_ms,
        });
        emit(id, { type: "compaction", phase: "done" });
        continue;
      }

      // 忽略 thinking_tokens 系统消息（SDK 思考 token 估算反馈，当前前端未使用）
      if (msg.type === "system" && msg.subtype === "thinking_tokens") {
        continue;
      }

      // 捕获 api_retry 消息并输出详细诊断日志（含 HTTP 状态码和错误原因）
      if (msg.type === "system" && msg.subtype === "api_retry") {
        process.stderr.write(
          `[agent] API retry ${msg.attempt}/${msg.max_retries}: ` +
          `status=${msg.error_status}, delay=${msg.retry_delay_ms}ms, error=${msg.error}\n`
        );
        continue;
      }

      // 处理流式增量事件
      if (msg.type === "stream_event") {
        processStreamEvent(id, msg.event, thinkingStartTime);
        continue;
      }

      // 处理完整的 assistant 消息（每个 turn 结束后到达）
      if (msg.type === "assistant" && msg.message?.content) {
        const thinkingDurationMs = Date.now() - turnStartTime;

        // 兜底：如果有 thinking block 但没发送过 thinking_done，在这里补发
        if (thinkingStartTime.value > 0) {
          emit(id, { type: "assistant", subtype: "thinking_done", durationMs: thinkingDurationMs });
          thinkingStartTime.value = 0;
        } else {
          // 检查是否有未通过流式发送的 thinking block
          const hasThinkingBlock = msg.message.content.some(
            (block: any) => block.type === "thinking"
          );
          if (hasThinkingBlock) {
            emit(id, { type: "assistant", subtype: "thinking_done", durationMs: thinkingDurationMs });
          }
        }

        // 发送一个 content_block_done 信号，通知前端流式结束
        emit(id, { type: "assistant", subtype: "text_done" });
        // 仅提取 tool_use 和 tool_result（text/thinking 已通过 delta 流式发送）
        processAssistantToolContent(id, msg.message.content, thinkingDurationMs);

        turnStartTime = Date.now();
        continue;
      }

      // 处理最终结果
      if (msg.type === "result") {
        const durationMs = Date.now() - startTime;

        // 检测是否为用户主动取消（SDK 会发出含 aborted 的 error 结果）
        const errors = msg.errors as string[] | undefined;
        const terminalReason = (msg as any).terminal_reason as string | undefined;
        const isAbortedResult =
          (Array.isArray(errors) && errors.some(e => typeof e === "string" && e.toLowerCase().includes("abort"))) ||
          terminalReason === "aborted_streaming" ||
          terminalReason === "aborted_tools";

        if (isAbortedResult) {
          emit(id, {
            type: "result",
            subtype: "success",
            result: "查询已取消",
            durationMs,
          });
          continue;
        }

        // 从 SDK usage 中提取 token 统计
        const rawUsage = msg.usage as any;
        const tokenUsage: TokenUsage | undefined = rawUsage
          ? {
              inputTokens: rawUsage.input_tokens ?? 0,
              outputTokens: rawUsage.output_tokens ?? 0,
              cacheCreationInputTokens: rawUsage.cache_creation_input_tokens ?? 0,
              cacheReadInputTokens: rawUsage.cache_read_input_tokens ?? 0,
            }
          : undefined;

        emit(id, {
          type: "result",
          subtype: msg.subtype === "success" ? "success" : "error",
          result: msg.result,
          totalCostUsd: msg.total_cost_usd,
          durationMs,
          error: msg.errors?.join("; "),
          numTurns: typeof msg.num_turns === "number" ? msg.num_turns : undefined,
          usage: tokenUsage,
        });
        continue;
      }

      // 捕获 user 消息的 uuid（用于 rewindFiles checkpoint 回滚）
      // replay-user-messages 选项使 SDK 在流中回放所有 user 消息（含 uuid）
      // 每次收到都更新，保留最后一个 uuid（即当前 prompt 的 checkpoint）
      if (msg.type === "user" && msg.uuid) {
        emit(id, {
          type: "user_message_uuid",
          sdkUuid: msg.uuid as string,
        });
        continue;
      }

      // 忽略其他消息类型，但打印诊断日志（排查 ZodError 等 SDK 内部错误）
      if (msg.type) {
        process.stderr.write(`[agent] unhandled msg: type=${msg.type} subtype=${msg.subtype ?? ""} keys=[${Object.keys(msg).join(",")}]\n`);
        // 如果 result 字段包含错误信息，打印完整内容
        if (msg.result && typeof msg.result === "string" && (msg.result.includes("ZodError") || msg.result.includes("permission") || msg.result.includes("Invalid"))) {
          process.stderr.write(`[agent] ERROR in result: ${msg.result.substring(0, 500)}\n`);
        }
        if (msg.errors && Array.isArray(msg.errors)) {
          process.stderr.write(`[agent] errors: ${msg.errors.join("; ").substring(0, 500)}\n`);
        }
      }
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    // 捕获并打印 ZodError 的完整信息
    if (errorMessage.includes("ZodError") || errorMessage.includes("Invalid input")) {
      process.stderr.write(`[agent] CAUGHT ZodError: ${errorMessage.substring(0, 1000)}\n`);
      if (err instanceof Error && err.stack) {
        process.stderr.write(`[agent] ZodError stack: ${err.stack.substring(0, 500)}\n`);
      }
    }

    const isAborted =
      errorMessage.toLowerCase().includes("abort") ||
      (err instanceof Error && err.name === "AbortError");
    if (isAborted) {
      emit(id, {
        type: "result",
        subtype: "success",
        result: "查询已取消",
        durationMs: Date.now() - startTime,
      });
    } else {
      emit(id, { type: "error", queryId: id, message: errorMessage });
      emit(id, {
        type: "result",
        subtype: "error",
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });
    }
  } finally {
    activeQueries.delete(id);
    specWrittenQueries.delete(id);
  }
}

/**
 * 启动新的 Agent 查询
 */
export async function handleStartQuery(
  command: StartQueryCommand
): Promise<void> {
  const { id, prompt, cwd, options } = command;
  await runQuery(id, prompt, options, { cwd });
}

/**
 * 恢复已有会话
 */
export async function handleResumeQuery(
  command: ResumeQueryCommand
): Promise<void> {
  const { id, sessionId, prompt, cwd, options } = command;
  await runQuery(id, prompt, options, { resume: sessionId, cwd });
}

/**
 * 手动触发会话压缩
 * 通过发送 /compact prompt + resume sessionId 来触发 SDK 的压缩功能
 */
export async function handleCompactQuery(
  command: CompactQueryCommand
): Promise<void> {
  const { id, sessionId, cwd, options } = command;
  // 使用 /compact prompt 恢复会话，SDK 会自动触发压缩
  await runQuery(id, "/compact", options, { resume: sessionId, cwd });
}

/**
 * 回滚文件到指定 user message 的 checkpoint 状态
 *
 * 复用 Claude SDK 的 rewindFiles 能力（官方文档推荐模式）：
 * - 用空 prompt resume 同一 sessionId，打开 CLI 连接
 * - 在 for-await 循环中收到第一条消息时调用 rewindFiles()
 * - break 退出循环，CLI 进程自然结束
 */
export async function handleRewindFiles(
  command: RewindFilesCommand
): Promise<void> {
  const { id, sessionId, userMessageId, cwd, dryRun } = command;

  process.stderr.write(`[agent] rewind_files: id=${id}, sessionId=${sessionId}, userMessageId=${userMessageId}, dryRun=${dryRun ?? false}\n`);

  try {
    // 用空 prompt resume 会话，打开 CLI 连接（官方文档推荐模式）
    const rewindQuery = query({
      prompt: "",
      options: {
        resume: sessionId,
        cwd,
        enableFileCheckpointing: true,
        // 复用与编码查询相同的隔离配置
        settingSources: [],
        ...(NATIVE_CLI_BINARY ? { pathToClaudeCodeExecutable: NATIVE_CLI_BINARY } : {}),
      },
    });

    // 在 for-await 循环中收到第一条消息时调用 rewindFiles，然后 break
    // 这是官方文档推荐的模式：空 prompt 打开连接 → rewindFiles → break
    let rewindDone = false;
    for await (const msg of rewindQuery) {
      if (!rewindDone) {
        rewindDone = true;
        const result = await rewindQuery.rewindFiles(userMessageId, { dryRun: dryRun ?? false });

        process.stderr.write(`[agent] rewind_files result: canRewind=${result.canRewind}, filesChanged=${result.filesChanged?.length ?? 0}, error=${result.error ?? "(none)"}\n`);

        // emit 回滚结果到前端
        emit(id, {
          type: "rewind_result",
          success: result.canRewind,
          error: result.error,
          filesChanged: result.filesChanged,
          insertions: result.insertions,
          deletions: result.deletions,
          dryRun: dryRun ?? false,
          userMessageId,
        });
        break;
      }
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[agent] rewind_files error: ${errorMessage}\n`);
    emit(id, {
      type: "rewind_result",
      success: false,
      error: errorMessage,
      dryRun: dryRun ?? false,
      userMessageId,
    });
  }
}

/**
 * 处理 AskUserQuestion：发消息到前端并等待用户回复
 */
async function handleAskUserQuestion(
  queryId: string,
  input: Record<string, unknown>,
  toolOptions: any,
): Promise<{ behavior: string; updatedInput?: Record<string, unknown>; toolUseID?: string; message?: string }> {
  const requestId = generateRequestId();
  const questions = (input.questions as AskUserQuestionItem[]) ?? [];

  // 向前端发送提问消息
  emit(queryId, {
    type: "ask_user_question",
    requestId,
    questions,
  });

  // 创建 Promise 等待前端回复
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingToolRequests.delete(requestId);
      resolve({ behavior: "deny", message: "AskUserQuestion 超时（5分钟未回复）", toolUseID: toolOptions.toolUseID });
    }, 5 * 60 * 1000);

    pendingToolRequests.set(requestId, {
      queryId,
      resolve,
      timer,
      questions,
    });

    // 监听 abort signal（查询被取消时）
    if (toolOptions.signal) {
      toolOptions.signal.addEventListener("abort", () => {
        const pending = pendingToolRequests.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingToolRequests.delete(requestId);
          resolve({ behavior: "deny", message: "查询已取消", toolUseID: toolOptions.toolUseID });
        }
      });
    }
  });
}

/**
 * 前端回复 AskUserQuestion 后调用
 */
export function resolvePendingToolRequest(
  requestId: string,
  answers: Record<string, string>,
  response?: string,
  cancelled?: boolean,
): boolean {
  const pending = pendingToolRequests.get(requestId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingToolRequests.delete(requestId);

  if (cancelled) {
    pending.resolve({ behavior: "deny", message: "用户取消了提问" });
  } else {
    pending.resolve({
      behavior: "allow",
      updatedInput: {
        questions: pending.questions,
        answers,
        ...(response ? { response } : {}),
      },
    });
  }
  return true;
}

/**
 * 取消查询
 */
export function handleCancelQuery(queryId: string): boolean {
  // 清理该查询下所有 pending tool requests
  for (const [reqId, pending] of pendingToolRequests) {
    if (pending.queryId === queryId) {
      clearTimeout(pending.timer);
      pending.resolve({ behavior: "deny", message: "查询已取消" });
      pendingToolRequests.delete(reqId);
    }
  }

  const controller = activeQueries.get(queryId);
  if (controller) {
    controller.abort();
    activeQueries.delete(queryId);
    return true;
  }
  return false;
}

/**
 * 关闭所有活跃查询
 */
export function shutdownAll(): void {
  for (const [_id, controller] of activeQueries) {
    controller.abort();
  }
  activeQueries.clear();
}
