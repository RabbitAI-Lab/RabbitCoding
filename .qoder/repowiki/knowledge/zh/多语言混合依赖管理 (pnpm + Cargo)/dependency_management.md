## 1. 核心系统与工具
该项目采用 **Monorepo** 架构，同时管理前端（React/Vite）、后端（Rust/Tauri）以及独立 Sidecar 进程（Node.js）的依赖。主要使用以下包管理器：
- **pnpm**: 用于所有 JavaScript/TypeScript 模块（根目录 `rabbit-coding` 和 `sidecar`）。通过 `packageManager` 字段锁定版本为 `pnpm@11.5.2`。
- **Cargo**: 用于 Rust 后端 (`src-tauri`)，通过 `Cargo.toml` 和 `Cargo.lock` 管理原生依赖。

## 2. 关键文件与配置
- **`package.json` / `pnpm-lock.yaml`**: 根目录定义了主应用的前端依赖（如 `antd`, `@tauri-apps/api`, `vite`）。
- **`sidecar/package.json` / `sidecar/pnpm-lock.yaml`**: 独立管理 Claude Agent SDK 相关的 Node.js 依赖，确保 Sidecar 进程的隔离性。
- **`pnpm-workspace.yaml`**: 定义了 pnpm 的工作区构建规则，特别允许了 `esbuild` 和 `better-sqlite3` 的原生构建脚本执行。
- **`src-tauri/Cargo.toml`**: 定义了 Tauri 插件（如 `tauri-plugin-shell`, `tauri-plugin-fs`）及 Rust 库（如 `rusqlite`, `reqwest`）。
- **`.pnpm-store/v10/`**: 项目内包含本地化的 pnpm 存储，表明可能采用了离线安装或内容寻址的缓存策略以加速构建。

## 3. 架构与约定
- **依赖隔离**: Sidecar 进程拥有独立的 `node_modules` 和锁文件，避免与主 UI 进程的依赖冲突。
- **版本锁定**: 严格使用 `pnpm-lock.yaml` 和 `Cargo.lock` 确保跨环境构建的一致性。
- **条件编译依赖**: 在 `Cargo.toml` 中使用了 `[target.'cfg(...)'.dependencies]` 来处理特定平台（如排除 Windows ARM64 上的 `sherpa-onnx`）的依赖。
- **原生模块处理**: 通过 `pnpm-workspace.yaml` 显式授权 `esbuild` 等需要编译原生二进制文件的包运行构建脚本。

## 4. 开发者规范
- **添加前端依赖**: 必须在根目录或 `sidecar` 目录下分别运行 `pnpm add <pkg>`，严禁手动修改 `package.json` 而不更新锁文件。
- **添加 Rust 依赖**: 在 `src-tauri` 目录下运行 `cargo add <crate>`。
- **同步更新**: 修改任何 `package.json` 或 `Cargo.toml` 后，必须提交对应的 `.lock` 文件以保持团队环境一致。
- **Sidecar 资源**: 注意 `sidecar` 中的 `setup-resources` 脚本，它负责将打包后的 JS 资源移动到 Tauri 可访问的位置。