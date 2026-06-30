该项目采用 **JavaScript/TypeScript (Frontend & Sidecar)** 与 **Rust (Tauri Backend)** 的双语言技术栈，因此依赖管理分为两套独立的体系：

### 1. JavaScript/TypeScript 依赖管理 (pnpm)

- **包管理器**: 使用 `pnpm` (版本 `11.5.2`)，通过 `packageManager` 字段在 `package.json` 中明确指定，确保团队环境一致性。
- **Monorepo 结构**: 项目根目录包含 `pnpm-workspace.yaml`，定义了 workspace 配置。目前主要包含两个部分：
  - **主应用 (`.`)**: 位于根目录，负责 Tauri 前端界面。
  - **Sidecar (`sidecar/`)**: 位于 `sidecar` 目录，是一个独立的 Node.js 子项目，用于运行 Claude Agent SDK。
- **锁定文件**: 
  - 根目录 `pnpm-lock.yaml`: 管理主应用及 workspace 全局依赖。
  - `sidecar/pnpm-lock.yaml`: 管理 sidecar 子项目的独立依赖。
- **依赖策略**:
  - **主应用**: 依赖 React 19, Ant Design, Tauri API 插件等。使用 `@tauri-apps/cli` 进行构建和开发。
  - **Sidecar**: 依赖 `@anthropic-ai/claude-agent-sdk` 和 `zod`。由于涉及原生二进制或特定平台构建，`sidecar/package.json` 中配置了 `pnpm.onlyBuiltDependencies` 以优化构建过程。
  - **资源同步**: 通过 `scripts/setup-resources.mjs` 脚本将 sidecar 的构建产物同步到 Tauri 的资源目录中。

### 2. Rust 依赖管理 (Cargo)

- **包管理器**: 使用标准的 `cargo`。
- **核心配置**: `src-tauri/Cargo.toml` 定义了 Tauri 后端应用的依赖。
  - **Tauri 核心**: `tauri` v2 及其插件系统 (`plugin-opener`, `plugin-shell`, `plugin-fs` 等)。
  - **关键库**: `rusqlite` (数据库), `tokio` (异步运行时), `reqwest` (网络请求), `sherpa-onnx` (语音识别，针对非 Windows ARM64 平台条件编译)。
- **锁定文件**: `src-tauri/Cargo.lock` 确保了 Rust 依赖版本的确定性。
- **构建脚本**: `build.rs` 用于在编译前执行必要的设置（如 Tauri 代码生成）。

### 3. 开发者规范

- **安装依赖**: 在根目录运行 `pnpm install` 会同时处理主应用和 workspace 内的子项目依赖。
- **添加依赖**:
  - 前端: `pnpm add <package>`
  - Sidecar: `pnpm -C sidecar add <package>`
  - Rust: `cd src-tauri && cargo add <crate>`
- **版本控制**: 所有的 `lock` 文件 (`pnpm-lock.yaml`, `Cargo.lock`) 均应提交到版本控制系统，以保证构建的可复现性。
- **私有源**: 目前配置主要依赖公共注册表 (npm/crates.io)。若需使用私有源，需在 `.npmrc` 或 `cargo config.toml` 中额外配置。