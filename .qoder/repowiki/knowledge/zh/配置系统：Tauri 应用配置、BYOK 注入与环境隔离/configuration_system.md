## 1. 核心架构与策略

RabbitCoding 采用 **分层配置架构**，将静态应用元数据、运行时权限控制与动态业务配置（如 AI 模型密钥）解耦。其核心设计理念是 **BYOK (Bring Your Own Key)** 与 **环境隔离**，确保用户敏感信息不泄露且不受全局系统环境干扰。

*   **静态配置层**：基于 Tauri v2 标准，使用 `tauri.conf.json` 定义应用标识、窗口行为、安全策略及插件端点。
*   **权限配置层**：通过 `capabilities/default.json` 声明前端可访问的系统能力（如文件系统范围、通知、深度链接）。
*   **动态运行时层**：前端 UI 管理模型与 MCP 服务器配置，通过 Rust 后端以环境变量形式动态注入到 Sidecar 进程中。

## 2. 关键配置文件

| 文件路径 | 作用描述 |
| :--- | :--- |
| `src-tauri/tauri.conf.json` | 应用主配置：定义 productName、版本、窗口标签（main/pet）、Updater 端点及 Deep Link schemes。 |
| `src-tauri/capabilities/default.json` | 权限清单：限制前端对 `$HOME/.agents` 等目录的读写权限，以及窗口拖拽、事件监听等原生能力。 |
| `package.json` / `sidecar/package.json` | 依赖与脚本管理：定义了 `setup-resources` 等构建期资源配置脚本。 |

## 3. 运行时配置加载逻辑

### 3.1 环境变量注入 (Sidecar)
应用在启动 Claude Agent Sidecar 时，会在 `src-tauri/src/sidecar.rs` 中执行严格的环境变量管理：
1.  **清理继承变量**：主动移除父进程继承的 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` 等变量，防止 Shell 环境残留干扰。
2.  **配置根目录重定向**：设置 `CLAUDE_CONFIG_DIR` 指向应用专用的空目录（如 `.rabbit-claude-home`），彻底切断对用户全局 `~/.claude/` 目录下插件、技能的加载，实现沙箱化运行。
3.  **BYOK 注入**：将前端传入的 `api_key`、`base_url` 及自定义 `env_vars` 映射为进程环境变量。

### 3.2 SDK 级隔离
在 `sidecar/src/agent.ts` 中，调用 `query()` 时显式设置 `settingSources: []`。这是一种冗余兜底策略，确保即使文件系统存在配置，SDK 也不会加载，从而保证所有模型行为完全由应用代码控制。

### 3.3 前端配置管理
前端通过 `ModelEditModal` 和 `McpEditModal` 维护复杂的配置表单，支持：
*   **多厂商预设**：自动填充 GLM、OpenAI 等厂商的默认 Base URL 和 Model ID。
*   **自定义环境变量**：允许用户为特定模型或 MCP 服务器添加额外的 `key-value` 环境变量对。

## 4. 开发者规范

*   **敏感信息处理**：严禁在前端代码中硬编码 API Key。所有密钥必须通过 `StartSidecarPayload` 经由 Rust 后端安全注入。
*   **环境一致性**：若新增需要传递给 Agent 的配置项，需同步更新 `StartSidecarPayload` 结构体及 `sidecar.rs` 中的 `cmd.env()` 调用。
*   **隔离原则**：不要依赖用户本地的 Claude Code 全局配置。任何影响 Agent 行为的参数都应在应用内显式定义并注入。