该项目采用 **Tauri v2** 框架构建跨平台桌面应用，结合了前端（React/Vite）与后端（Rust）的混合构建流程，并通过 GitHub Actions 实现自动化的多平台编译、签名、公证及发布。

### 1. 核心构建系统
*   **前端构建**：使用 **Vite** + **TypeScript** + **React**。通过 `pnpm build` 生成静态资源至 `dist/` 目录。
*   **后端构建**：使用 **Rust (Cargo)**。`src-tauri/` 目录包含 Rust 源码，负责系统级交互（如文件系统、窗口管理、语音识别等）。
*   **Sidecar 集成**：项目包含一个独立的 Node.js Sidecar 模块（`sidecar/`），用于运行 Claude Agent SDK。构建时需先通过 `esbuild` 打包 Sidecar，再通过脚本将其二进制文件及依赖复制到 Tauri 的资源目录 (`src-tauri/resources/`)。
*   **包管理器**：统一使用 **pnpm** (v11.5.2)，通过 `packageManager` 字段锁定版本，确保环境一致性。

### 2. CI/CD 流水线 (GitHub Actions)
位于 `.github/workflows/build.yml`，主要流程如下：
*   **触发条件**：推送到 `main` 分支或创建 `v*` 标签时触发。
*   **多平台矩阵**：同时构建 macOS (ARM64/Intel)、Windows (x64/ARM64) 四个目标平台。
*   **资源准备**：
    *   下载对应平台的 Node.js 运行时并嵌入到 `src-tauri/resources/node-runtime/`。
    *   构建 Sidecar 并复制原生二进制文件。
*   **版本策略**：
    *   **正式 release**：基于 Git Tag (`v*`)，版本号直接取自 `tauri.conf.json`。
    *   **Nightly 构建**：基于 `main` 分支，版本号格式为 `{base}-{days_since_2024}`，确保 MSI 安装程序兼容性。
*   **签名与公证**：
    *   **macOS**：自动注入 Apple API Key，执行代码签名并上传至 Apple 进行公证 (Notarization)。
    *   **Updater**：构建完成后自动生成 `latest.json` 更新清单，并使用私钥签名，供客户端 `tauri-plugin-updater` 校验。
*   **发布管理**：
    *   使用 `tauri-apps/tauri-action` 将产物上传至 GitHub Releases。
    *   维护一个滚动的 `nightly` Tag 和 Release，始终指向最新的夜间构建，方便用户获取最新测试版。

### 3. 关键配置文件
*   `src-tauri/tauri.conf.json`：定义应用元数据、窗口配置、构建钩子 (`beforeBuildCommand`) 以及打包资源列表。
*   `vite.config.ts`：配置 Vite 开发服务器端口 (1420) 及 HMR，适配 Tauri 开发环境。
*   `sidecar/scripts/setup-resources.mjs`：自动化脚本，负责将 Sidecar 的 ESM bundle 和平台特定的原生二进制文件同步到 Tauri 资源目录，并确保 ESM 兼容性（写入 `package.json` with `type: module`）。

### 4. 开发者规范
*   **本地开发**：运行 `pnpm tauri dev` 会自动触发前端 Vite 服务和 Rust 后端的热重载。
*   **资源更新**：若修改了 Sidecar 代码，需手动或在构建前运行 `pnpm setup:resources` 以确保资源目录同步。
*   **版本管理**：不要手动修改 `tauri.conf.json` 中的版本号，CI 会根据 Tag 自动注入。本地开发保持 `0.1.0` 即可。
*   **跨平台注意**：在 Windows ARM64 上禁用了 `sherpa-onnx` 依赖，需注意条件编译逻辑。