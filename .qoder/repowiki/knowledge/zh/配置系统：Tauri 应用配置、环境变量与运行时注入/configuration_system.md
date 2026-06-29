## 1. 核心配置体系

本项目采用 **Tauri v2** 框架，其配置系统由多层组成，涵盖了从构建期到运行时的完整生命周期：

*   **Tauri 核心配置 (`tauri.conf.json`)**: 位于 `src-tauri/tauri.conf.json`，是应用的“主配置文件”。它定义了应用元数据（名称、版本、标识符）、窗口行为（主窗口与宠物窗口的尺寸、透明度、置顶属性）、安全策略（CSP）、资源打包路径（sidecar、node-runtime）以及插件配置（如自动更新端点、深度链接协议）。
*   **前端构建配置 (`vite.config.ts`)**: 负责前端开发服务器的端口（固定为 `1420` 以适配 Tauri）、HMR 设置以及对 `src-tauri` 目录的监听忽略。它通过 `process.env.TAURI_DEV_HOST` 读取开发环境的主机地址。
*   **后端依赖管理 (`Cargo.toml`)**: 管理 Rust 后端的依赖库及特性开关（如 `macos-private-api`, `devtools`），并通过条件编译（`[target.'cfg(...)']`）处理不同平台的特定依赖（如 Windows ARM64 下的语音识别库禁用）。

## 2. 环境变量与运行时配置

项目在不同层级利用环境变量进行动态配置：

*   **前端环境变量**: 使用 Vite 默认的 `import.meta.env`。例如在 `src/utils/portalClient.ts` 中，通过 `import.meta.env.DEV` 区分开发环境（`localhost:5173`）与生产环境（线上 Portal 地址）的 API 基址。
*   **Sidecar 进程环境**: Sidecar（Node.js 子进程）严重依赖宿主环境变量。在 `sidecar/src/index.ts` 和 `agent.ts` 中，代码会读取 `CLAUDE_CONFIG_DIR`、`ANTHROPIC_BASE_URL`、`HOME` 等变量来定位配置目录和模型接口。
*   **Rust 后端环境注入**: 
    *   **PATH 注入**: 在生产模式下（`src-tauri/src/lib.rs`），应用启动时会将内置的 `node-runtime` 路径和用户可写的 `npm-global` 路径注入到进程的 `PATH` 环境变量中。这确保了所有子进程（Sidecar、MCP 服务器等）都能直接调用内置的 Node.js 和 npm 全局包。
    *   **NPM_CONFIG_PREFIX**: 同时设置该变量，将 npm 全局安装目录重定向到用户数据目录，解决 macOS 应用包只读和 Windows 权限问题。

## 3. 动态配置管理

除了静态文件和环境变量，应用还实现了复杂的动态配置逻辑：

*   **模型配置虚拟化**: 在 `src/utils/portalClient.ts` 中，应用通过调用远程 Portal API 获取在线模型列表和 AI 转发密钥（AI Forwarding Key）。这些运行时获取的数据会被动态组装成虚拟的 `ModelConfig` 对象，使得线上模型能像本地配置的模型一样被 Sidecar 调用。
*   **窗口状态持久化**: 利用 `tauri-plugin-window-state`，应用在窗口发生 `Resized`、`Moved` 或 `CloseRequested` 事件时，自动将窗口的位置、大小及所在显示器信息保存到磁盘，并在下次启动时恢复。
*   **CI/CD 动态修改**: 在 `.github/workflows/build.yml` 中，通过 Node.js 脚本直接读写 `tauri.conf.json`，根据 CI 环境变量（如 `APP_VERSION`、`IS_NIGHTLY`）动态修改应用版本号和更新端点。

## 4. 开发者规范

*   **配置分层**: 静态应用结构（窗口、图标、权限）放在 `tauri.conf.json`；跨平台差异逻辑放在 `Cargo.toml` 的条件依赖或 Rust 的 `cfg` 宏中；业务相关的动态参数（如 API 地址）通过环境变量或远程接口获取。
*   **环境变量访问**: 前端统一使用 `import.meta.env`；Rust 后端使用 `std::env::var`；Node.js Sidecar 使用 `process.env`。注意在 Rust 中修改环境变量仅对当前进程及其后续产生的子进程生效。
*   **资源路径**: 在 Rust 代码中引用打包资源时，应使用 `app.path().resource_dir()` 获取基准路径，并根据操作系统拼接子路径（如 Windows 下无 `bin` 子目录，而 Unix 下有）。
