# Rabbit Coding Hero 落地页网站

## Context

Rabbit Coding 是一个基于 Rust/Tauri 的桌面端 AI 编程助手，目前已具备多厂商大模型、Code Wiki、语音输入、桌面宠物、插件市场等核心能力，并通过 GitHub Actions 构建 macOS/Windows 多平台安装包发布到 GitHub Releases。但目前**缺少一个面向公众的产品落地页**来展示能力与引导下载。

本次将在仓库根目录新建独立的 `website/` 目录，使用 React + Tailwind v4 + Vite 构建一个**现代深色科技风**的单页落地页，包含 Hero 首屏、核心特性展示、平台下载区、页脚四个板块，可独立构建并部署为公开访问的产品官网，不影响桌面应用构建。

## 已验证的关键事实

- 品牌主题色（胡萝卜橙）：来源 `src/index.css` L30-46，Dark 模式 `--brand-solid: #F5824C`、`--brand-solid-hover: #E87238`。落地页统一深色，采用 `#F5824C` 为主色。
- GitHub 仓库：`https://github.com/RabbitAI-Lab/RabbitCoding`（已通过 `git remote -v` 确认）。Releases 页：`https://github.com/RabbitAI-Lab/RabbitCoding/releases`。
- 当前仓库仅 nightly 预发布 Release，无 `v*` 正式 tag → 下载区需支持「正式版优先、无正式版回落 nightly」逻辑。
- 图标资源：`src-tauri/icons/128x128.png`（favicon）、`src-tauri/icons/128x128@2x.png` 或 `icon.png`（logo）可拷贝复用。
- pnpm-workspace.yaml 当前无 packages 列表；根 .gitignore 已忽略 `node_modules`/`dist`（对子目录自动生效）。

## 实施方案

### Task 1: 初始化 website/ 独立项目骨架

新建 `website/` 目录及基础配置文件，版本与根项目对齐（React 19 / Vite 7 / TS 5.8 / Tailwind 4.3.1 / pnpm 11.5.2）。

文件清单：
- `website/package.json` — 依赖：react、react-dom、tailwindcss、lucide-react；devDeps：@tailwindcss/vite、@types/react、@types/react-dom、@vitejs/plugin-react、typescript、vite。**不依赖** antd/Tauri/xterm/monaco，保持极小体积。
- `website/vite.config.ts` — 使用 `@tailwindcss/vite` + `@vitejs/plugin-react`，支持 `WEBSITE_BASE` 环境变量注入 `base`（适配 GitHub Pages 子路径），dev 端口 5173。
- `website/tsconfig.json` / `website/tsconfig.node.json` — 复用根配置（ES2020 / react-jsx / strict / bundler），`include: ["src"]`。
- `website/index.html` — 引入 `/favicon.png`，标题「Rabbit Coding — 桌面 AI 编程伙伴」。
- `website/.gitignore` — 忽略 node_modules、dist。

更新 `pnpm-workspace.yaml`，将 `website` 纳入 workspace：
```yaml
packages:
  - website
allowBuilds:
  esbuild: true
```

### Task 2: 全局样式与设计 token

新建 `website/src/styles/globals.css`：
- `@import "tailwindcss";`
- `@theme` 暴露设计 token（深色科技底色阶 + 胡萝卜橙品牌色）：
  - `--color-brand: #F5824C` / `--color-brand-strong: #E8702A` / `--color-brand-hover: #FF9360`
  - 深色底：`--color-ink-950: #07080D` / `ink-900: #0B0E16` / `ink-800: #11151F` / `ink-700: #1A2030`
  - 文字：`--color-fg: #E7EAF0` / `--color-fg-muted: #9AA3B2`
- 动效 keyframes：`fade-up`、`float`（光晕漂移）
- `@media (prefers-reduced-motion: reduce)` 下禁用动画
- 字体：`ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei"`（中英文兼顾，零外部请求）

### Task 3: 资源复用

拷贝图标到 `website/public/`：
- `src-tauri/icons/128x128.png` → `website/public/favicon.png`
- `src-tauri/icons/128x128@2x.png` → `website/public/logo.png`（256px 高清，用于 Navbar/Footer）

### Task 4: 基础组件 — Background + Navbar

- `src/components/Background.tsx` — fixed 定位：双层胡萝卜橙 radial-gradient 光晕 blob（右上 78%/18%、左下 12%/82%）+ 细网格层（56px，mask 边缘衰减）+ 冷色点缀。纯 CSS 零运行时。
- `src/components/Navbar.tsx` — 顶部固定栏：Logo + 文字「Rabbit Coding」+ 锚点（特性/下载）+ GitHub 星标按钮（外链）。半透明毛玻璃背景。

### Task 5: Hero 首屏

- `src/components/Hero.tsx` — 大标题「为开发者而生的桌面 AI 编程伙伴」（关键词渐变填充）+ 副标题（Rust/Tauri 构建、多模型/知识库/语音/宠物）+ 双 CTA（「立即下载」实心橙锚点 / 「GitHub 查看」描边外链）+ 信任徽章行。
- `src/components/HeroMockup.tsx` — 产品截图容器，带橙色渐变边框 + `float` 动画 + 外发光投影。初期用纯 CSS mockup 占位（应用窗口模拟）。
- 标题/CTA 错峰渐入动画。

### Task 6: 核心特性展示

- `src/data/features.ts` — 9 条特性数据（图标 key + 标题 + 描述），对应：AI 编程助手、多厂商大模型、Code Wiki、语音输入、桌面宠物、插件市场、MCP/Skills、GitNexus 索引、Worktree 隔离。
- `src/components/Features.tsx` — 3 列响应式网格（移动 1 列 / 平板 2 列 / 桌面 3 列）+ 板块标题。
- `src/components/FeatureCard.tsx` — 单卡片：lucide 图标 + 标题 + 描述；hover 边框渐变为橙色透明描边 + 图标上浮 4px + drop-shadow；`IntersectionObserver` 滚动渐入。

### Task 7: 平台下载区（GitHub Releases 动态对接）

- `src/lib/platform.ts` — UA 平台/架构嗅探（mac arm/intel、win x64/arm64），返回当前推荐平台。
- `src/lib/releases.ts` — 纯函数，从 assets 按正则匹配四平台安装包 URL：
  - `Rabbit.Coding_*_aarch64.dmg`、`Rabbit.Coding_*_x64.dmg`、`Rabbit.Coding_*_x64-setup.exe`、`Rabbit.Coding_*_arm64-setup.exe`
- `src/hooks/useReleases.ts` — 调用 `https://api.github.com/repos/RabbitAI-Lab/RabbitCoding/releases?per_page=10`，筛选正式版（`prerelease===false`，优先）与 nightly（`tag_name==="nightly"` 回落）；8s 超时 + sessionStorage 缓存（按日期 key）。
- `src/components/Download.tsx` — 标题 + 版本号 + 4 个 `PlatformButton`；当前平台按钮 `ring-2 ring-brand` 高亮 + 「推荐」角标；底部「查看所有版本 / Nightly」链接。
- `src/components/PlatformButton.tsx` — 图标 + 平台名 + 架构 + 文件大小。
- **三级降级**：API 成功且匹配 → 直链下载；API 成功未匹配 → 指向 release html_url；API 失败 → 统一指向 Releases 页 `https://github.com/RabbitAI-Lab/RabbitCoding/releases`。loading 时骨架占位。

### Task 8: 页脚 Footer

- `src/components/Footer.tsx` — 三列链接（产品：特性/下载/更新日志/Deep Link `rabbitcoding://`；资源：GitHub/文档/问题反馈；社区：Discussions）+ 底栏版权「© 2026 RabbitAI-Lab · Built with Rust + Tauri」。顶部渐变分隔线。

### Task 9: 应用入口组装

- `website/src/App.tsx` — 组装 Background + Navbar + Hero + Features + Download + Footer，锚点 `id` 贯通。
- `website/src/main.tsx` — 挂载 React，引入 globals.css。
- `website/src/vite-env.d.ts` — Vite 类型声明。

### Task 10: 本地验证与依赖安装

- 在仓库根目录执行 `pnpm install`（更新 lockfile，纳入 workspace）
- `cd website && pnpm dev` 本地预览
- `cd website && pnpm build` 验证构建产物输出到 `website/dist/`
- 检查：深色背景 + 胡萝卜橙光晕渲染、四板块布局、特性卡片滚动渐入、下载区 API 调用与降级、移动端响应式。

## 关键文件路径

**新建：**
- `website/package.json`、`website/vite.config.ts`、`website/tsconfig.json`、`website/tsconfig.node.json`、`website/index.html`、`website/.gitignore`
- `website/src/styles/globals.css`、`website/src/App.tsx`、`website/src/main.tsx`、`website/src/vite-env.d.ts`
- `website/src/components/` 下：`Background.tsx`、`Navbar.tsx`、`Hero.tsx`、`HeroMockup.tsx`、`Features.tsx`、`FeatureCard.tsx`、`Download.tsx`、`PlatformButton.tsx`、`Footer.tsx`
- `website/src/hooks/useReleases.ts`、`website/src/lib/releases.ts`、`website/src/lib/platform.ts`、`website/src/data/features.ts`
- `website/public/favicon.png`、`website/public/logo.png`

**修改：**
- `pnpm-workspace.yaml` — 新增 `packages: [website]`

**参考（只读）：**
- `src/index.css`（L30-46 品牌色变量来源）
- `src-tauri/icons/128x128.png`、`src-tauri/icons/128x128@2x.png`（图标复用来源）
- `vite.config.ts`、`tsconfig.json`、`package.json`（配置配方对齐）
- `.github/workflows/build.yml`（CI 发布机制参考）

## 验证方式

1. **本地启动**：仓库根目录 `pnpm install` → `cd website && pnpm dev` → 浏览器访问 `http://localhost:5173`
2. **视觉检查**：深色科技底 + 胡萝卜橙光晕、Hero 标题渐变、特性卡片 hover 浮起、滚动渐入动画
3. **功能检查**：下载区 GitHub API 调用成功显示 nightly 版本与安装包直链；断网/限流时按钮降级指向 Releases 页；当前平台按钮高亮
4. **响应式**：Chrome DevTools 切换移动端/平板/桌面，布局正常
5. **构建**：`cd website && pnpm build` 成功输出 `website/dist/`，`pnpm preview` 预览无报错
6. **无障碍**：开启系统「减少动态效果」后动画禁用
