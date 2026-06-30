该代码库（基于 Tauri + Rust）采用了一套以 `Result<T, String>` 为核心的错误处理模式，结合了前端事件通知、状态持久化以及熔断机制，以确保在长时间运行的异步任务（如 AI 生成、模型下载）中能够优雅地处理异常。

### 1. 核心策略：`Result<T, String>` 与命令边界
- **统一返回类型**：绝大多数 Tauri 命令（`#[command]`）和内部辅助函数使用 `Result<T, String>` 作为返回类型。错误信息通常通过 `format!` 宏构造，包含上下文描述（例如：`"Failed to create HTTP client: {e}"`）。
- **错误传播**：使用 `?` 操作符在调用链中快速传播错误。在命令边界处，错误会被转换为字符串返回给前端，或由前端根据返回的 `Err` 状态进行 UI 提示。
- **无自定义 Error Enum**：目前未发现全局统一的自定义 `Error` 枚举类型，而是直接使用 `String` 承载错误信息。这种方式简化了跨模块的错误传递，但牺牲了类型安全的错误匹配能力。

### 2. 异步长任务的状态管理
对于耗时较长的操作（如 Wiki 生成、语音模型下载），代码库不依赖简单的同步返回，而是采用“状态驱动”的错误处理：
- **事件通知（Event Emission）**：通过 `app.emit()` 向前端推送进度和错误状态。例如，`asr://status` 事件携带 `{ "state": "download_error", "error": "..." }`，`wiki-progress` 事件携带失败详情。
- **状态持久化（Meta Persistence）**：在 Wiki 生成等断点续传场景中，错误发生时会将当前进度和失败记录写入 `_meta.json`。即使进程崩溃或重启，系统也能从持久化的状态中恢复，避免重复执行已成功的步骤。
- **取消信号（Cancellation）**：使用 `AtomicBool` 作为取消标志。在循环中定期检查 `check_cancel()`，如果检测到取消信号，则立即停止任务并保存中间状态，防止资源泄漏。

### 3. 容错与熔断机制
- **连续失败熔断（Circuit Breaker）**：在 Wiki 生成器中实现了 `check_circuit_breaker`。当连续失败次数超过阈值（`max_consecutive_failures`）时，系统会自动暂停任务，将状态标记为 `paused`，并通过事件通知前端，防止因环境配置错误导致的无限重试。
- **重试逻辑（Retry Logic）**：AI 调用模块（`run_ai_loop_with_retry`）内置了重试机制。对于网络波动或临时性 API 错误，系统会自动重试，直到达到最大重试次数（`max_retries`）。
- **软失败处理**：在批量处理（如多 Repo Wiki 生成）中，单个子任务的失败（如某个 Repo 的 Catalog 生成失败）不会导致整个流程中断，而是记录错误并跳过该子任务，继续处理下一个。

### 4. 关键文件与模块
- **`src-tauri/src/voice.rs`**：展示了网络下载错误的捕获与事件推送，以及 VAD/ASR 初始化失败的早期返回处理。
- **`src-tauri/src/wiki/generator/helpers.rs`**：定义了 `check_cancel` 和 `check_circuit_breaker` 等核心容错辅助函数。
- **`src-tauri/src/wiki/generator/repo.rs`**：演示了如何在循环中结合取消检查、熔断检查和错误记录，实现健壮的批量任务处理。
- **`src-tauri/src/gitnexus.rs`**：展示了子进程执行错误的捕获，包括 stdout/stderr 的诊断信息提取。

### 5. 开发规范建议
- **错误信息丰富化**：在构造错误字符串时，务必包含足够的上下文（如文件名、URL、操作阶段），以便于调试。
- **避免静默失败**：除非有明确的业务理由（如可选文件缺失），否则不应忽略 `Result`。对于非关键错误，应至少记录日志（`eprintln!` 或 `println!`）。
- **前端错误映射**：由于后端返回的是 `String`，前端需要建立一套错误关键词映射机制，将后端返回的自然语言错误转换为用户友好的提示信息。