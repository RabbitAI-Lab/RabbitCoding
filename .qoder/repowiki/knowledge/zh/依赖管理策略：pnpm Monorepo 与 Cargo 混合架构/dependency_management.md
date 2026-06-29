该项目采用 **JavaScript/TypeScript** 与 **Rust** 混合技术栈，分别使用 **pnpm** 和 **Cargo** 进行依赖管理。

### 1. JavaScript/TypeScript 依赖管理 (pnpm)
- **包管理器**: 使用 `pnpm@11.5.2`，通过 `packageManager` 字段在 `package.json` 中锁定版本，确保环境一致性。
- **Monorepo 结构**: 根目录包含 `pnpm-workspace.yaml`，定义了工作区配置。项目包含一个子工作区 `sidecar/`，用于处理 Claude Agent SDK 相关的逻辑。
- **依赖声明**: 
  - 根目录 `package.json` 声明了前端 UI 库（如 `antd`, `@ant-design/x`）、Tauri API 插件以及构建工具（`vite`, `typescript`）。
  - `sidecar/package.json` 独立声明了其运行时依赖（如 `@anthropic-ai/claude-agent-sdk`, `zod`）。
- **锁文件**: `pnpm-lock.yaml` 位于根目录，统一管理整个工作区的依赖版本和完整性校验。
- **构建优化**: 在 `pnpm-workspace.yaml` 中针对 `better-sqlite3` 和 `esbuild` 等原生模块配置了 `allowBuilds`，以优化安装过程。

### 2. Rust 依赖管理 (Cargo)
- **核心后端**: `src-tauri/Cargo.toml` 定义了 Tauri 应用的后端依赖。
- **关键依赖**:
  - **Tauri 生态**: `tauri`, `tauri-build` 以及各类插件（`tauri-plugin-shell`, `tauri-plugin-fs` 等）均使用版本 `2`。
  - **系统交互**: 使用 `rusqlite` (SQLite), `tokio` (异步运行时), `reqwest` (HTTP 客户端), `xcap` (截图) 等。
  - **条件编译**: 针对 Windows ARM64 平台 excluded `sherpa-onnx` 依赖，体现了跨平台依赖的精细化控制。
- **锁文件**: `src-tauri/Cargo.lock` 确保了 Rust 依赖树的确定性构建。

### 3. 开发者规范
- **版本同步**: 修改依赖后必须提交对应的 lock 文件 (`pnpm-lock.yaml` 或 `Cargo.lock`)。
- **工作区命令**: 使用 `pnpm -C sidecar run <script>` 来执行子工作区的特定任务（如资源设置）。
- **私有源**: 目前配置主要依赖公共注册表（crates.io 和 npm/pnpm 默认源），未见明显的私有仓库配置（如 `.npmrc` 中的 registry 指向）。
