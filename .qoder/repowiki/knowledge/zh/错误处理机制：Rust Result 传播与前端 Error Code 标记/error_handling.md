该项目采用 **Tauri (Rust + TypeScript)** 架构，其错误处理机制呈现出明显的跨语言分层特征：后端依赖 Rust 的 `Result<T, String>` 类型进行显式错误传播，前端则通过 `try/catch` 捕获异步调用异常，并结合自定义错误码（Error Codes）和状态管理来处理业务逻辑错误。

### 1. 核心系统与模式

*   **Rust 后端：Result 传播与命令边界**
    *   **统一返回类型**：所有 Tauri 命令（`#[tauri::command]`）均使用 `Result<T, String>` 作为返回类型。成功时返回数据，失败时返回描述性错误字符串。
    *   **错误转换**：广泛使用 `.map_err(|e| format!("...: {}", e))?` 将底层库（如 `rusqlite`, `reqwest`, `std::io`）的错误转换为友好的字符串消息。
    *   **事务回滚**：在数据库操作（`db.rs`）中，利用 `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK` 确保数据一致性，出错时自动回滚并返回错误。
    *   **非致命错误降级**：在应用启动阶段（`lib.rs`），若数据库初始化失败，仅打印日志并继续运行，前端随后通过检测命令执行情况降级到 `localStorage`。

*   **TypeScript 前端：Async/Await 与 Error Code 识别**
    *   **异常捕获**：在调用 `invoke` 或 `fetch` 时使用 `try/catch` 块。
    *   **自定义错误码**：在关键业务接口（如 `portalClient.ts`）中，通过给 `Error` 对象附加 `code` 属性（如 `NOT_AUTHENTICATED`, `AIKEY_NOT_RETURNED`）来区分错误类型，便于 UI 层做出精确响应（如弹出重新登录引导）。
    *   **状态驱动的错误展示**：利用 React Context（如 `useAuth`）管理 `loginError` 等状态，将错误信息直接绑定到 UI 组件。

### 2. 关键文件与逻辑

*   **`src-tauri/src/lib.rs`**：
    *   展示了全局错误处理策略。例如，`ensure_workspace_docs_dir` 等命令直接返回 `Result<(), String>`。
    *   在 `setup` 钩子中，对数据库初始化的错误进行了“软处理”（记录日志但不崩溃）。
*   **`src-tauri/src/network.rs`**：
    *   实现了健壮的诊断逻辑。在执行 `curl`、`ping` 等系统命令时，即使外部工具执行失败，也会捕获错误并返回包含 `status: "error"` 和 `error: String` 的结构化数据，而不是直接抛出异常中断流程。
*   **`src/utils/portalClient.ts`**：
    *   定义了前端错误处理的规范。通过检查 `resp.ok` 手动抛出带有特定 `code` 的 `Error` 对象，实现了业务错误的标准化。
*   **`src/hooks/useAuth.tsx`**：
    *   演示了前端如何消费后端错误。在 `handleCallback` 中捕获 `invoke` 抛出的异常，并将其存入 `loginError` 状态供 UI 显示。

### 3. 开发约定与规则

*   **禁止 Panic**：在 Tauri 命令实现中，严禁使用 `panic!` 或 `unwrap()`。必须使用 `match` 或 `?` 运算符将错误转换为 `Err(String)` 返回给前端。
*   **错误信息本地化准备**：虽然目前后端主要返回英文错误字符串，但前端在展示时应考虑国际化（i18n）映射，尤其是针对常见的网络错误或权限错误。
*   **结构化错误优先**：对于复杂的诊断功能（如网络诊断），应返回包含详细字段（如 `resolved_ips`, `packet_loss_percent`）的对象，并在其中包含 `error` 字段，而非简单返回一个错误字符串。
*   **前端错误标识**：当需要前端根据错误类型执行不同逻辑（如跳转登录页 vs 显示通用提示）时，应遵循 `portalClient.ts` 的模式，为 `Error` 对象添加唯一的 `code` 标识。