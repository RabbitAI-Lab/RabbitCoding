## 1. 核心系统与工具链
- **CSS 框架**: 采用 **Tailwind CSS v4** (`@tailwindcss/vite`) 作为主要的原子化样式引擎。通过 `src/index.css` 中的 `@import "tailwindcss"` 引入。
- **UI 组件库**: 深度集成 **Ant Design (antd) v6** 及其扩展包 `@ant-design/x`（用于 AI 对话场景）和 `@ant-design/x-markdown`（用于 Markdown 渲染）。
- **构建工具**: 基于 **Vite**，配合 `@tailwindcss/vite` 插件实现按需编译。

## 2. 主题与色彩体系
- **双模式支持**: 实现了完整的 **Light/Dark** 模式切换。通过 `useTheme` Hook 监听系统偏好或用户手动设置，并将 `.dark` 类同步至 `<html>` 根节点。
- **品牌色设计 (Design Tokens)**: 在 `src/index.css` 中定义了统一的“胡萝卜橙”品牌色系，通过 CSS 变量实现全局复用：
  - `--brand-primary`: 主文字/链接色（如 `#E07B00`）。
  - `--brand-solid`: 实心按钮底色（如 `#E8702A`）。
  - `--brand-soft-bg/border`: 选中态浅底与次级按钮描边。
- **Antd 主题同步**: 在 `App.tsx` 中通过 `ConfigProvider` 将 `resolvedTheme` 映射到 `antdTheme.darkAlgorithm` 或 `defaultAlgorithm`，确保原生 Antd 组件与全局风格一致。

## 3. 布局与架构约定
- **响应式布局**: 采用经典的 **Sidebar + ContentArea** 结构。Sidebar 宽度可通过 `useResizable` Hook 进行拖拽调整（默认 272px）。
- **Tauri 集成样式**: 
  - 使用 `[data-tauri-drag-region]` 属性定义窗口拖拽区域，并强制禁止文字选中 (`user-select: none`)。
  - 针对 Pet Window（宠物悬浮窗）定义了特殊的透明背景与全屏覆盖样式 (`.pet-window-root`)。
- **滚动条定制**: 定义了 `.thin-scrollbar` 工具类，将滚动条宽度压缩至 3px，并适配深浅色模式，以保持界面的极简感。

## 4. 开发者规范
- **样式编写**: 优先使用 Tailwind 原子类（如 `flex`, `bg-[#F8F8F8]`, `dark:bg-[#1a1a1a]`）。对于复杂的动画或全局覆盖（如 XMarkdown 字号、Antd 波纹去除），在 `index.css` 中编写原生 CSS。
- **深色模式适配**: 所有自定义样式必须同时提供 `dark:` 变体。例如：`text-gray-500 dark:text-gray-400`。
- **品牌色引用**: 严禁硬编码橙色值，必须使用 `var(--brand-primary)` 等 CSS 变量，以确保主题切换时的一致性。
- **组件库覆盖**: 若需修改 Antd 组件默认行为（如禁用 Switch 过渡动画），需在 `index.css` 中使用高优先级选择器并添加 `!important`。