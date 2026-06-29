## 1. 核心系统与工具
- **CSS 框架**: 使用 **Tailwind CSS v4** (`@tailwindcss/vite`) 进行原子化样式开发。通过 `src/index.css` 中的 `@import "tailwindcss"` 引入。
- **组件库**: 基于 **Ant Design (antd) v6** 及其扩展库 `@ant-design/x`（用于 AI 对话界面）和 `@ant-design/x-markdown`（用于 Markdown 渲染）。
- **主题引擎**: 采用 **自定义 React Context (`useTheme`)** 结合 **CSS Custom Properties** 和 **Tailwind `dark:` 变体** 实现深色/浅色模式切换。

## 2. 关键文件与架构
- **全局样式入口**: `src/index.css`
  - 定义了品牌色变量（`:root` 与 `.dark`），如 `--brand-primary`（胡萝卜橙 `#E07B00`）。
  - 引入了第三方库样式（xterm, x-markdown）。
  - 定义了复杂的动画关键帧（如 `pet-rabbit-breathe`, `pet-circuit-pulse`）用于“赛博兔子”宠物组件。
  - 配置了 Tailwind 的 `dark` 变体：`@custom-variant dark (&:where(.dark, .dark *));`，支持基于 class 的深色模式。
- **主题管理 Hook**: `src/hooks/useTheme.tsx`
  - 提供 `ThemeProvider` 上下文，支持 `'system' | 'light' | 'dark'` 三种模式。
  - 监听系统偏好变化，并将 `resolvedTheme` 同步到 `document.documentElement` 的 `class` 和 `style.colorScheme`。
- **Ant Design 适配**: `src/App.tsx`
  - 通过 `AntdThemeSync` 组件将 `resolvedTheme` 映射到 `antd` 的 `ConfigProvider`，确保原生 Antd 组件跟随系统主题。

## 3. 设计约定与规范
- **品牌色系**: 
  - 主色为“胡萝卜橙”（Carrot Orange），在亮色模式下为 `#E07B00`，暗色模式下调整为更亮的 `#F5824C` 以保证对比度。
  - 所有自定义按钮、链接应优先使用 `var(--brand-primary)` 等 CSS 变量。
- **深色模式策略**:
  - 采用 **Class-based** 策略。当主题为 dark 时，`<html>` 标签会添加 `.dark` 类。
  - Tailwind 类名中广泛使用 `dark:bg-[#1a1a1a]`、`dark:text-gray-200` 等变体来适配背景与文字颜色。
  - 背景色约定：亮色 `#F8F8F8` / `white`，暗色 `#1a1a1a` / `#1e1e1e`。
- **滚动条定制**:
  - 定义了 `.thin-scrollbar` 类，将滚动条宽度压缩至 3px，并适配深浅色模式，用于知识库等侧边栏区域。
- **动画与交互**:
  - 宠物组件（Cyber Rabbit）包含复杂的 SVG 动画（呼吸、工作脉冲、电路发光），需遵循 `prefers-reduced-motion` 媒体查询以尊重用户无障碍设置。

## 4. 开发者指南
- **新增样式**: 优先使用 Tailwind 实用类。若需复杂状态或动画，请在 `index.css` 中定义语义化类名。
- **主题适配**: 在 JSX 中编写样式时，必须同时考虑 `dark:` 变体。例如：`className="bg-white dark:bg-[#1e1e1e] text-black dark:text-white"`。
- **品牌色使用**: 避免硬编码橙色值，统一使用 `var(--brand-primary)`、`var(--brand-solid)` 等 CSS 变量，以确保主题切换时的一致性。