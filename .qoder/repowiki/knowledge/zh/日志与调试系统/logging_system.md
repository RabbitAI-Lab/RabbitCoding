该仓库未引入专用的日志框架（如 Rust 的 `tracing`/`env_logger` 或前端的 `pino`/`winston`），而是采用**平台原生的标准输出/错误流**结合**前端控制台 API** 的轻量级调试方案。

### 1. 后端日志 (Rust/Tauri)
- **机制**：直接使用 `println!` 和 `eprintln!` 宏。
- **约定**：
  - **结构化前缀**：绝大多数日志都带有模块标识前缀，例如 `[db]`, `[sidecar]`, `[window-state]`, `[pet-cursor]`, `[auth]`, `[wiki]`。这使得在开发环境中可以通过 grep 快速过滤特定子系统的日志。
  - **错误流区分**：关键错误、状态变更和后台线程日志（如 sidecar 的 stderr 捕获）通常输出到 `stderr` (`eprintln!`)，而常规的状态恢复、路径注入等信息输出到 `stdout` (`println!`)。
  - **生命周期日志**：在 `src-tauri/src/lib.rs` 的 `setup` 阶段，会打印窗口恢复状态、Node.js 运行时路径注入情况等启动期关键信息。

### 2. 前端日志 (TypeScript/React)
- **机制**：使用浏览器原生的 `console.log`, `console.warn`, `console.error`, `console.debug`。
- **约定**：
  - **组件/模块标签**：日志消息通常以 `[ComponentName]` 或 `[module]` 开头，如 `[ContentArea]`, `[notify]`, `[App]`。
  - **调试级别**：大量使用 `console.debug` 记录非关键的流程分支（如通知权限检查、偏好设置读取），便于在生产构建中通过关闭 Debug 级别来减少噪音（如果构建了相应的过滤逻辑，但目前主要是开发期使用）。
  - **错误捕获**：在 `catch` 块中使用 `console.error` 记录异步操作失败（如 API 调用、Tauri Invoke 错误）。

### 3. 外部进程日志 (Sidecar)
- **捕获与转发**：Rust 后端在启动 Sidecar (Node.js 进程) 时，会创建独立的线程读取其 `stdout` 和 `stderr`。
  - `stdout`：被解析为 JSON 行并通过 Tauri 事件系统 (`agent:message`) 转发给前端 UI 进行展示。
  - `stderr`：被 Rust 后端直接通过 `eprintln!("[sidecar] {}", text)` 打印到主应用的控制台，用于开发者调试 Sidecar 内部的运行时错误。

### 4. 开发者建议
- **后端**：新增模块日志时，请遵循 `[module_name] message` 的格式，并根据重要性选择 `println` (信息) 或 `eprintln` (错误/警告)。
- **前端**：避免在生产代码中遗留 `console.log`，建议使用 `console.debug` 记录详细流程，或使用 `console.error` 记录异常。