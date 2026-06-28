## 1. 核心构建系统与技术栈
该项目采用 **Tauri v2** 框架构建跨平台桌面应用，结合了 Rust 后端、React (Vite) 前端以及 Node.js Sidecar 进程。构建流程高度自动化，通过 GitHub Actions 实现多平台（macOS ARM/x86, Windows x86/ARM）的并行编译、打包与发布。

- **前端构建**: 使用 `Vite` + `TypeScript` + `React`。通过 `pnpm` 管理依赖，利用 Corepack 锁定包管理器版本 (`pnpm@11.5.2`)。
- **后端构建**: 使用 `Rust` (Cargo) 编译 Tauri 核心逻辑及原生插件（如 `rusqlite`, `sherpa-onnx`）。
- **Sidecar 构建**: 独立的 Node.js 子项目 (`sidecar/`)，使用 `esbuild` 将 TypeScript 代码打包为单文件 ESM bundle，并提取平台特定的原生二进制文件。
- **资源编排**: 通过自定义脚本 `setup-resources.mjs` 将 Sidecar bundle、Node.js 运行时及原生 CLI 二进制文件统一复制到 `src-tauri/resources/` 目录，供 Tauri 打包进最终安装包。

## 2. 关键配置文件
- **`.github/workflows/build.yml`**: CI/CD 核心配置。定义了多矩阵构建策略，处理依赖安装、资源准备、版本注入、代码签名及 GitHub Release 发布。
- **`src-tauri/tauri.conf.json`**: Tauri 应用配置。定义了应用标识符、窗口行为、安全策略以及需要打包的资源路径（`resources/sidecar`, `resources/node-runtime` 等）。
- **`package.json` / `sidecar/package.json`**: 定义前端与 Sidecar 的构建脚本 (`dev`, `build`, `bundle`) 及依赖关系。
- **`src-tauri/Cargo.toml`**: Rust 后端依赖管理，包含条件编译配置（如针对 Windows ARM64 禁用 `sherpa-onnx`）。
- **`sidecar/scripts/setup-resources.mjs`**: 关键的资源桥接脚本，负责在构建前将 Sidecar 产物同步至 Tauri 资源目录。

## 3. 架构与发布约定
### 版本管理与发布策略
- **正式版本**: 当推送 `v*` 格式的 Git Tag 时，触发正式构建。版本号直接取自 Tag（如 `v1.0.0`），生成非预发布（Prerelease: false）的 GitHub Release。
- **Nightly 构建**: 在 `main` 分支推送或手动触发时，生成 Nightly 版本。版本号格式为 `基础版本-距2024-01-01的天数`（例如 `0.1.0-898`），以确保 MSI 安装程序对纯数字预发布段的兼容性。Release 标题包含日期与 Commit SHA。
- **自动更新**: Nightly 构建会自动将 Tauri Updater 的端点指向 `nightly` Tag，实现独立于正式版的更新通道。

### 跨平台资源处理
- **Node.js 运行时嵌入**: CI 流程中会根据目标平台（darwin-arm64, win-x64 等）从 nodejs.org 下载对应版本的 Node.js 运行时，并解压至 `src-tauri/resources/node-runtime/`，确保应用在无 Node 环境的机器上也能运行 Sidecar。
- **Sidecar 二进制提取**: `setup-resources.mjs` 智能解析 `@anthropic-ai/claude-agent-sdk` 的平台特定依赖，提取原生 `claude` 二进制文件并赋予执行权限。

### 代码签名与公证
- **macOS**: CI 集成 Apple API Key 与证书，对 macOS 构建进行代码签名并自动提交公证（Notarization），确保应用在 macOS 上的可信分发。
- **Updater 签名**: 使用 `TAURI_SIGNING_PRIVATE_KEY` 对更新清单（`latest.json`）进行签名，客户端校验以确保更新包的安全性。

## 4. 开发者规范
- **依赖管理**: 必须使用 `pnpm` 进行依赖安装。根目录与 `sidecar/` 目录均使用 `pnpm-lock.yaml` 锁定版本。
- **本地开发**: 
  - 启动前端与 Tauri 窗口：`pnpm tauri dev`
  - 单独构建 Sidecar：`cd sidecar && pnpm run bundle`
  - 同步资源到 Tauri：`pnpm setup:resources`
- **资源同步**: 修改 Sidecar 代码后，若需测试打包效果，必须重新运行 `setup-resources.mjs` 以更新 `src-tauri/resources/` 下的 bundle 和二进制文件。
- **版本控制**: 不要手动修改 `src-tauri/tauri.conf.json` 中的 `version` 字段，CI 会在构建时根据 Tag 或日期自动注入。
