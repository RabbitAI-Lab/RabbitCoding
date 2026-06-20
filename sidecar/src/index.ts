/**
 * Claude Sidecar 入口
 *
 * 通过 stdin 读取 JSON-lines 命令，分发给对应的 handler 处理。
 * 所有输出通过 stdout 以 JSON-lines 格式返回。
 * 日志输出到 stderr，不影响 stdout 的协议消息。
 */

import * as readline from "node:readline";
import type { InboundMessage } from "./protocol.js";
import {
  handleStartQuery,
  handleResumeQuery,
  handleCancelQuery,
  handleCompactQuery,
  shutdownAll,
  resolvePendingToolRequest,
} from "./agent.js";

function log(msg: string): void {
  process.stderr.write(`[sidecar] ${msg}\n`);
}

/** 向 stdout 发送 JSON-lines 消息 */
function send(data: unknown): void {
  process.stdout.write(JSON.stringify(data) + "\n");
}

/** 发送错误消息 */
function sendError(queryId: string | undefined, message: string): void {
  send({ queryId: queryId ?? "", payload: { type: "error", queryId, message } });
}

/**
 * 处理单条入站命令
 */
async function handleCommand(msg: InboundMessage): Promise<void> {
  switch (msg.type) {
    case "start_query":
      log(`start_query: id=${msg.id}, cwd=${msg.cwd}, permissionMode=${msg.options?.permissionMode}, allowedTools=${JSON.stringify(msg.options?.allowedTools)}`);
      // 不 await，允许并发处理多个查询
      handleStartQuery(msg).catch((err) => {
        log(`start_query error: ${err}`);
        sendError(msg.id, err instanceof Error ? err.message : String(err));
      });
      break;

    case "resume_query":
      log(`resume_query: id=${msg.id}, sessionId=${msg.sessionId}, permissionMode=${msg.options?.permissionMode}, allowedTools=${JSON.stringify(msg.options?.allowedTools)}`);
      handleResumeQuery(msg).catch((err) => {
        log(`resume_query error: ${err}`);
        sendError(msg.id, err instanceof Error ? err.message : String(err));
      });
      break;

    case "cancel_query":
      log(`cancel_query: id=${msg.id}`);
      handleCancelQuery(msg.id);
      break;

    case "compact_query":
      log(`compact_query: id=${msg.id}, sessionId=${msg.sessionId}`);
      handleCompactQuery(msg).catch((err) => {
        log(`compact_query error: ${err}`);
        sendError(msg.id, err instanceof Error ? err.message : String(err));
      });
      break;

    case "respond_tool_request": {
      log(`respond_tool_request: requestId=${msg.requestId}`);
      resolvePendingToolRequest(
        msg.requestId,
        msg.answers,
        msg.response,
        msg.cancelled,
      );
      break;
    }

    case "shutdown":
      log("shutdown requested");
      shutdownAll();
      // 给 stdout 一点时间 flush
      setTimeout(() => process.exit(0), 100);
      break;

    default:
      log(`unknown command type: ${(msg as any).type}`);
      sendError(undefined, `Unknown command type: ${(msg as any).type}`);
  }
}

/**
 * 主入口：stdin 命令循环
 */
async function main(): Promise<void> {
  log("sidecar starting...");
  log(`=== Environment ===`);
  log(`CLAUDE_CONFIG_DIR: ${process.env.CLAUDE_CONFIG_DIR || "(not set)"}`);
  log(`HOME: ${process.env.HOME || process.env.USERPROFILE || "(not set)"}`);
  log(`Node: ${process.version} | Platform: ${process.platform}/${process.arch}`);
  log(`ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL || "(default)"}`);
  log(`===================`);

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const msg = JSON.parse(trimmed) as InboundMessage;
      handleCommand(msg).catch((err) => {
        log(`command handler error: ${err}`);
      });
    } catch (err) {
      log(`invalid JSON: ${trimmed.substring(0, 100)}`);
      sendError(undefined, `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  rl.on("close", () => {
    log("stdin closed, shutting down");
    shutdownAll();
    process.exit(0);
  });

  // 发送就绪信号
  send({ queryId: "", payload: { type: "system", subtype: "ready" } });
  log("sidecar ready");
}

// 未捕获异常处理
process.on("uncaughtException", (err) => {
  log(`uncaught exception: ${err}`);
  sendError(undefined, `Uncaught exception: ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  log(`unhandled rejection: ${reason}`);
  sendError(undefined, `Unhandled rejection: ${String(reason)}`);
});

main().catch((err) => {
  log(`fatal: ${err}`);
  process.exit(1);
});
