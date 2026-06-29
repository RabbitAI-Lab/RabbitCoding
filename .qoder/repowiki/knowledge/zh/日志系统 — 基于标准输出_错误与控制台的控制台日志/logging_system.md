## 1. 使用的系统与方式

该仓库没有引入专用的日志框架（如 Rust 的 `tracing`/`env_logger`/`fern`，或 Node.js 的 `winston`/`pino`），而是采用**语言内置的标准输出/标准错误 + 控制台 API** 作为唯一的日志通道：

- **Rust (Tauri 后端)**：使用 `println!` 和 `eprintln!` 宏，将信息分别写入 stdout/stderr。
- **TypeScript/Node (Sidecar 进程)**：自定义 `log()` 函数统一写 `process.stderr`，协议消息走 `process.stdout`；前端代码中使用 `console.debug`/`console.warn`。
- **日志级别策略**：没有统一的级别配置或过滤器，仅通过**输出目标（stdout vs stderr）**和**前缀标签**做简单区分。

## 2. 关键文件与位置

- **Rust 后端日志集中地**：
  - `src-tauri/src/lib.rs`：应用启动、窗口状态、通知、宠物窗口穿透等核心流程的 `println!`/`eprintln!` 日志。
  - `src-tauri/src/auth.rs`、`src-tauri/src/integration.rs`：OAuth/集成相关 HTTP 请求与响应的 `eprintln!` 调试日志。
- **Sidecar（Claude Agent SDK 封装）日志**：
  - `sidecar/src/index.ts`：定义 `log(msg)` 统一写 `process.stderr`，并在命令解析、错误处理、生命周期事件中记录结构化文本日志。
  - `sidecar/src/agent.ts`：在 Agent 查询生命周期、工具调用、插件加载、ZodError 诊断等场景大量使用 `process.stderr.write` 输出带 `[agent]` 前缀的日志。
- **前端日志**：
  - `src/utils/notify.ts`：桌面通知与声音提示链路中，使用 `console.debug`/`console.warn` 记录权限、发送结果与异常。

## 3. 架构与约定

### 3.1 多进程日志分工

- **Tauri 主进程（Rust）**：
  - 正常信息与状态变更（如窗口尺寸、路径注入）使用 `println!`。
  - 错误与警告（如数据库初始化失败、通知脚本失败、激活窗口失败）使用 `eprintln!`，并常带模块前缀，例如 `[db]`、`[notify]`、`[activate]`、`[pet-cursor]`、`[node-runtime]`。
- **Sidecar 子进程（Node/TS）**：
  - 所有人类可读日志统一走 `stderr`，通过 `log()` 封装为 `[sidecar] <msg>` 格式，确保不与 JSON-lines 协议消息混流。
  - Agent 内部详细行为日志使用 `[agent]` 前缀，直接写 `process.stderr.write`，包含查询 ID、CWD、模型、插件、工具输入类型等上下文。
- **前端渲染进程（Browser/Tauri Webview）**：
  - 使用 `console.debug` 记录正常流程（如通知权限、偏好读取），`console.warn` 记录异常回退（如 Rust 通知失败、Tauri 通知失败、声音播放失败）。

### 3.2 结构化程度

- **无统一结构化日志格式**：日志内容为自由文本，通过方括号前缀标识模块，例如：
  - Rust: `[db]`, `[notify]`, `[activate]`, `[pet-cursor]`, `[node-runtime]`, `[window-state]`
  - Sidecar: `[sidecar]`, `[agent]`
  - Frontend: `[notify]`
- **关键字段通过文本嵌入**：例如 `start_query: id=..., cwd=..., permissionMode=..., allowedTools=...`、`[agent] plugin loaded: ...`、`[agent] CAUGHT ZodError: ...`。
- **无持久化与轮转策略**：日志仅存在于进程标准流中，由宿主环境（终端、IDE、系统日志收集器）决定如何捕获与存储。

### 3.3 日志与协议分离

- Sidecar 严格区分**协议通道（stdout JSON-lines）**与**日志通道（stderr 文本）**：
  - `send()` 只写 stdout，保证前端/父进程可以稳定解析 JSON 事件。
  - `log()` 与 `process.stderr.write` 只写 stderr，避免污染协议流。

## 4. 开发者应遵循的规则与建议

- **不要向 stdout 写入非协议内容（Sidecar）**：
  - 在 `sidecar/` 中，任何人类可读日志必须通过 `log()` 或直接写 `process.stderr`，严禁 `console.log`/`process.stdout.write` 用于调试信息。
- **优先使用 stderr 记录错误与诊断信息（Rust & Node）**：
  - Rust 中错误路径、异常分支、外部命令失败应使用 `eprintln!`。
  - Node/Sidecar 中工具调用异常、ZodError、插件加载失败等应写 `process.stderr`。
- **保持模块前缀一致**：
  - 新增日志时沿用现有前缀风格：`[db]`, `[notify]`, `[agent]`, `[sidecar]`, `[auth]`, `[integration]`, `[window-state]`, `[pet-cursor]`, `[node-runtime]` 等，便于 grep 与过滤。
- **避免在生产日志中泄露敏感信息**：
  - 当前部分日志会打印 HTTP 响应片段、token 长度、工具输入键名等；新增日志时应避免直接输出完整 token、密钥或个人身份信息。
- **如需更高级日志能力（级别控制、结构化、持久化），需先统一方案**：
  - 目前仓库未集成任何日志库；若未来需要按级别过滤、JSON 结构化输出或落盘，应在 Rust 与 Node 两端分别选定框架并制定统一字段规范，而不是零散增加 `println!`/`console.*`。