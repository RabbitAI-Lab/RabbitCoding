## 1. 使用的系统与方式

该仓库**未集成专用的日志框架**（如 Rust 的 `tracing`、`log`/`env_logger`，或前端的 `winston`、`pino` 等）。日志输出完全依赖语言/平台提供的**标准输出与标准错误流**：

- **Rust 后端 (Tauri)**：使用标准宏 `println!`（stdout）和 `eprintln!`（stderr）进行日志打印。
- **前端 (React/TypeScript)**：使用浏览器原生的 `console.log`、`console.error`、`console.warn` 等方法。
- **Node.js Sidecar**：使用 Node.js 原生的 `console.log`、`console.error`。

这是一种**轻量级、无依赖**的日志策略，适用于中小型桌面应用，但缺乏结构化日志、日志级别过滤、文件落盘及远程采集能力。

## 2. 关键文件与位置

核心日志逻辑分散在各个业务模块中，没有统一的日志初始化文件或配置中心：

- **Rust 后端入口与核心逻辑**：
  - `src-tauri/src/lib.rs`：应用启动、窗口状态管理、宠物窗口穿透逻辑等，大量使用 `println!` 和 `eprintln!` 记录调试信息与警告。
  - `src-tauri/src/auth.rs`：OAuth 认证流程，使用 `eprintln!` 记录 HTTP 请求与响应详情。
  - `src-tauri/src/network.rs`：网络诊断工具，虽主要返回结构化数据，但在底层命令执行失败时可能通过 stderr 输出。
  - `src-tauri/src/integration.rs`：第三方集成调用，使用 `eprintln!` 记录 API 交互细节。
- **前端日志**：
  - `src/App.tsx`：应用根组件，使用 `console.error` 捕获全局错误。
  - `src/components/ContentArea.tsx`：核心交互区域，使用 `console.error` 记录 Sidecar 启动失败、代理切换错误等。
- **Sidecar 脚本**：
  - `sidecar/scripts/setup-resources.mjs`：资源设置脚本，使用 `console.log` 和 `console.error` 输出构建与复制进度。

## 3. 架构与约定

### 3.1 日志流向
- **开发环境**：
  - Rust 后端的 `println!`/`eprintln!` 输出会显示在 Tauri 启动的终端控制台或 IDE 的输出面板中。
  - 前端 `console` 输出显示在浏览器 DevTools 的控制台中（Tauri 开发模式下通常嵌入 Webview，可通过 DevTools 查看）。
- **生产环境**：
  - 桌面应用打包后，标准输出通常会被重定向或丢弃，除非用户手动通过命令行启动应用并重定向输出。目前**没有实现日志文件持久化**机制。

### 3.2 日志内容约定
- **Rust 后端**：
  - **标签化**：普遍采用 `[module] message` 的格式，例如 `[db]`、`[auth]`、`[window-state]`、`[pet-cursor]`、`[node-runtime]`。这有助于在杂乱的终端输出中快速定位模块。
  - **级别区分**：
    - `println!`：用于常规状态更新，如窗口尺寸变化、路径注入成功。
    - `eprintln!`：用于错误、警告或关键流程追踪，如数据库初始化失败、HTTP 请求详情、系统调用失败。
- **前端**：
  - 主要在 `catch` 块中使用 `console.error` 记录异常，通常包含组件名称标签，如 `[ContentArea] Failed to start sidecar`。

### 3.3 缺失的能力
- **无日志级别控制**：无法在运行时动态开启/关闭调试日志，生产包中仍可能包含详细的调试输出（如 `auth.rs` 中的 token 交换详情）。
- **无结构化日志**：日志为纯文本，难以被日志分析工具自动解析。
- **无持久化**：用户遇到崩溃或异常时，无法直接提供日志文件供开发者排查，只能依赖截图或内存中的 DevTools 输出。

## 4. 开发者应遵循的规则

1. **统一标签格式**：在 Rust 后端添加新日志时，务必使用 `[module_name]` 前缀，保持与现有代码风格一致。
2. **合理选择 stdout/stderr**：
   - 常规状态、调试信息使用 `println!`。
   - 错误、警告、敏感操作追踪（如网络请求）使用 `eprintln!`。
3. **避免敏感信息泄露**：当前 `auth.rs` 等模块会将 HTTP 响应体片段打印到 stderr。在生产环境中，需注意避免将 Access Token、用户隐私数据等直接打印到控制台。
4. **前端错误捕获**：在异步操作失败时，应使用 `console.error` 并提供足够的上下文（如组件名、操作类型），以便用户在 DevTools 中排查。
5. **临时调试日志清理**：由于缺乏日志级别过滤，提交代码前应清理临时的 `println!` 调试语句，避免污染生产环境的控制台输出。