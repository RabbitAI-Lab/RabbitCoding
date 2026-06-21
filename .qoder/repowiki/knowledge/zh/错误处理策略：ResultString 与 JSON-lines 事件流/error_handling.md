RabbitCoding 采用了一种混合的错误处理架构，结合了 Rust 后端的 `Result<T, String>` 模式、TypeScript Sidecar 进程的 `try/catch` 异常捕获，以及基于 JSON-lines (JSONL) 的事件驱动错误传播机制。

### 1. Rust 后端 (Tauri)
- **核心模式**：所有 Tauri Command (`#[tauri::command]`) 均返回 `Result<T, String>`。成功时返回数据，失败时返回描述性错误字符串。
- **错误转换**：广泛使用 `.map_err(|e| format!("...: {e}"))` 将底层库（如 `rusqlite`, `reqwest`, `std::fs`）的错误转换为人类可读的字符串。例如在 `src-tauri/src/auth.rs` 和 `src-tauri/src/db.rs` 中。
- **初始化容错**：在 `src-tauri/src/lib.rs` 的 `setup` 阶段，数据库初始化失败不会导致应用崩溃（panic），而是通过 `eprintln!` 记录日志并允许前端降级到 `localStorage`。
- **无自定义 Error 类型**：目前未定义统一的 `enum Error`，而是依赖字符串消息进行跨语言边界（Rust -> JS）的错误传递。

### 2. Node.js Sidecar 进程
- **通信协议**：Sidecar (`sidecar/src/agent.ts`, `sidecar/src/index.ts`) 通过 stdin/stdout 与主进程通信。错误不通过抛出异常传播，而是序列化为特定的 JSONL 事件。
- **事件化错误**：
  - `type: "error"`：通用错误事件，包含 `queryId` 和 `message`。
  - `type: "result", subtype: "error"`：查询执行失败时的最终状态事件。
- **异常捕获**：在 `runQuery` 等异步逻辑中，使用 `try/catch` 捕获 SDK 异常（如 `AbortError`, `ZodError`），并将其转换为上述 JSONL 事件发送到 stdout。
- **全局兜底**：`sidecar/src/index.ts` 注册了 `uncaughtException` 和 `unhandledRejection` 监听器，确保进程不会因未处理异常而静默退出，并将错误信息发送给前端。

### 3. 前端 (React/TypeScript)
- **通知反馈**：`src/utils/notify.ts` 封装了桌面通知逻辑。在发送通知时采用多层回退策略（优先尝试 Rust 后端 osascript/PowerShell，失败则回退到 Tauri 插件），并通过 `console.warn` 记录非致命错误。
- **状态同步**：前端通过监听 Sidecar 发出的 `error` 或 `result(subtype: error)` 事件来更新 UI 状态（如显示错误提示或停止加载动画）。

### 4. 开发者规范
- **Rust 端**：Command 函数必须返回 `Result`。避免在 Command 中使用 `unwrap()` 或 `expect()`，应使用 `map_err` 提供上下文信息。
- **Sidecar 端**：所有异步操作必须包裹在 `try/catch` 中，并确保错误最终以 JSONL 格式写入 stdout。禁止直接 `process.exit(1)` 除非是致命启动错误。
- **错误日志**：关键错误应同时输出到 `stderr`（用于调试日志）和 `stdout`（用于前端展示）。
