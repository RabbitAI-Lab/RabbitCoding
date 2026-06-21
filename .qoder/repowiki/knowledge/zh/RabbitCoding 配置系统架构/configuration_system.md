## 1. 核心架构与分层

RabbitCoding 采用 **Tauri v2 + React + Node.js Sidecar** 的混合架构，其配置系统呈现出明显的**分层隔离**与**环境注入**特征：

*   **应用层配置 (Tauri)**: 通过 `src-tauri/tauri.conf.json` 定义窗口行为、安全策略（CSP）、资源打包路径及 Deep Link 协议。
*   **前端构建配置 (Vite)**: 使用 `vite.config.ts` 管理开发服务器端口（固定 1420）、HMR 协议以及 TailwindCSS 插件。
*   **运行时状态持久化 (SQLite)**: 摒弃了传统的 JSON 配置文件存储用户数据，转而使用 `rusqlite` 在本地 AppData 目录维护 `rabbit.db`。该数据库通过 Tauri Command (`db_load_all`, `db_save_all`) 暴露给前端，实现了工作区、对话历史（Rabbits）和代码仓库元数据的结构化存储。
*   **Sidecar 进程隔离配置**: Node.js Sidecar 进程通过 Rust 后端动态启动。Rust 层在 `spawn` 子进程时，会显式清理并注入环境变量（如 `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`），确保 AI 代理的运行环境与宿主机的全局配置（如 `~/.claude/`）完全隔离。

## 2. 关键配置文件与逻辑

| 文件路径 | 作用描述 |
| :--- | :--- |
| `src-tauri/tauri.conf.json` | Tauri 应用主配置，定义窗口标签（main/pet）、标题栏样式及资源白名单。 |
| `src-tauri/Cargo.toml` | Rust 依赖管理，引入 `tauri-plugin-window-state` 实现窗口位置/大小的自动持久化。 |
| `src-tauri/src/lib.rs` | 应用入口，初始化 SQLite 数据库路径，并在生产模式下注入内置 Node.js 运行时到 `PATH`。 |
| `src-tauri/src/sidecar.rs` | **核心配置注入点**。负责清理敏感环境变量，设置 `CLAUDE_CONFIG_DIR` 指向应用专用目录，防止插件/技能泄漏。 |
| `sidecar/src/agent.ts` | Sidecar 逻辑，读取 `process.env.CLAUDE_CONFIG_DIR` 加载已启用的插件，并通过 `settingSources: []` 禁用 SDK 的文件系统配置加载。 |
| `src/hooks/useLocalStorage.ts` | 前端轻量级配置 Hook，用于存储 UI 偏好等非关键状态，作为 SQLite 的补充。 |

## 3. 设计约定与安全规则

1.  **BYOK (Bring Your Own Key) 隔离**: 
    *   Rust 后端在启动 Sidecar 前，会强制移除所有 `ANTHROPIC_*` 开头的环境变量，仅保留由前端传入并经后端校验的 `ANTHROPIC_API_KEY`。
    *   通过设置 `CLAUDE_CONFIG_DIR` 到一个空的、应用专用的目录（如 `app_local_data_dir/claude-home`），彻底切断 Sidecar 对用户全局 Claude Code 配置的访问。

2.  **配置优先级**:
    *   **环境变量 > 数据库状态 > 前端 LocalStorage**。例如，模型 API 地址由环境变量 `ANTHROPIC_BASE_URL` 决定，而工作区列表则由 `rabbit.db` 权威管理。

3.  **开发/生产环境适配**:
    *   **开发模式**: Sidecar 通过 `npx tsx` 直接运行 TypeScript 源码，便于调试。
    *   **生产模式**: 使用内置的 Node.js 二进制文件运行预编译的 `sidecar-bundle.js`，并通过 `NPM_CONFIG_PREFIX` 将全局 npm 包安装路径重定向到用户可写目录，解决应用包签名后的只读权限问题。

4.  **窗口状态自动保存**:
    *   利用 `tauri-plugin-window-state`，应用在窗口移动、调整大小或关闭时自动触发 `save_window_state`，无需手动编写配置文件读写逻辑。