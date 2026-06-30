## 1. 构建系统概览
本项目采用 **Tauri v2** 作为核心桌面应用框架，结合 **Vite** (前端) 和 **Rust/Cargo** (后端) 进行混合构建。依赖管理统一使用 **pnpm** (通过 Corepack 锁定版本)，并包含一个独立的 **Sidecar** (Node.js) 子模块用于处理 AI Agent 逻辑。

### 核心技术栈
- **前端构建**: Vite + React + TypeScript + TailwindCSS
- **后端构建**: Rust (Cargo) + Tauri CLI
- **Sidecar 构建**: esbuild (将 Node.js Agent 打包为单文件 ESM)
- **包管理器**: pnpm (v11.5.2)
- **CI/CD**: GitHub Actions (多平台并行构建、自动签名、自动发布)

## 2. 关键构建流程

### 2.1 本地开发
- **启动前端**: `pnpm dev` (Vite 监听 1420 端口)
- **启动 Tauri**: `pnpm tauri dev` (自动调用 `beforeDevCommand`)
- **资源准备**: `pnpm setup:resources` (构建 Sidecar 并复制原生二进制到 `src-tauri/resources`)

### 2.2 生产构建
1. **前端打包**: `pnpm build` (生成 `dist/`)
2. **Sidecar 打包**: `sidecar/pnpm run bundle` (esbuild 生成 `sidecar-bundle.js`)
3. **资源注入**: 执行 `setup-resources.mjs` 将 Sidecar Bundle、平台特定的 Node.js Runtime 和 Claude SDK 原生二进制复制到 `src-tauri/resources/`。
4. **Tauri 打包**: `tauri build` (编译 Rust 代码，绑定前端资源，生成平台安装包)

## 3. CI/CD 自动化 (GitHub Actions)

### 3.1 多平台矩阵构建
`.github/workflows/build.yml` 定义了以下构建矩阵：
- **macOS**: `aarch64` (Apple Silicon) 和 `x86_64` (Intel)
- **Windows**: `x86_64` (MSVC) 和 `aarch64` (ARM64)

### 3.2 版本策略
- **正式版本**: 推送 `v*` 标签时触发，版本号取自 `tauri.conf.json`。
- **Nightly 版本**: 推送到 `main` 分支时触发，版本号格式为 `0.1.0-{days_since_2024}`，确保 MSI 安装程序兼容性（预发布段为纯数字）。

### 3.3 自动化发布
- **自动签名**: macOS 构建自动进行代码签名和公证 (Notarization)；Updater Manifest 使用私钥签名。
- **滚动发布**: `sync-nightly` 任务维护一个名为 `nightly` 的滚动 Tag 和 Release，始终指向最新构建，方便用户通过 Updater 插件获取最新测试版。
- **资源同步**: 自动下载 Node.js Runtime 并嵌入安装包，确保离线环境下 Sidecar 能正常运行。

## 4. 开发者规范

### 4.1 资源管理
- **禁止手动修改** `src-tauri/resources/` 下的文件。所有资源（Sidecar、Node Runtime）必须通过 `sidecar/scripts/setup-resources.mjs` 脚本生成。
- **Sidecar 开发**: 修改 `sidecar/src` 后需重新运行 `pnpm run bundle` 或 `setup:resources` 才能生效。

### 4.2 版本控制
- **版本号同步**: 修改 `src-tauri/tauri.conf.json` 中的 `version` 字段会同时影响 Rust Crate 和前端元数据。
- **Tag 规范**: 正式发版必须使用 `v` 前缀的 Tag (如 `v1.0.0`)。

### 4.3 跨平台注意事项
- **Windows ARM64**: 由于 `sherpa-onnx` 缺乏预编译库，语音识别功能在 Windows ARM64 上被条件编译禁用 (`Cargo.toml` 中的 `target.'cfg(...)'`)。
- **Node Runtime**: CI 会自动下载对应平台的 Node.js 二进制文件并嵌入资源目录，开发者无需本地安装特定版本的 Node.js 即可构建跨平台包，但需确保 `NODE_VERSION` 环境变量与 `package.json` 兼容。