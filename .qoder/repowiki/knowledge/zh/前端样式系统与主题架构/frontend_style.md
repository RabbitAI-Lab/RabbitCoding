## 1. 核心系统与技术栈

该项目采用 **Tailwind CSS v4** 作为主要的原子化 CSS 框架，配合 **Ant Design (antd) v6** 组件库构建 UI。样式系统深度集成了 **Tauri v2** 桌面应用特性，支持原生窗口拖拽、透明背景（宠物窗口）及系统级深色模式同步。

- **CSS 引擎**: Tailwind CSS v4 (通过 `@tailwindcss/vite` 插件集成)。
- **组件库**: Ant Design v6 (`antd`) 及其扩展 `@ant-design/x` (用于 AI 交互界面如 Sender, Markdown)。
- **图标库**: `lucide-react`。
- **代码编辑器**: `monaco-editor` (通过 `@monaco-editor/react` 封装)。
- **终端模拟**: `@xterm/xterm`。

## 2. 主题与深色模式架构

项目实现了一套完整的**三态主题系统**（System / Light / Dark），并通过 React Context 与原生 DOM 操作协同工作。

### 2.1 主题同步机制
- **状态管理**: `src/hooks/useTheme.tsx` 提供 `ThemeProvider`，将用户偏好持久化至 `localStorage` (`app-theme`)。
- **DOM 驱动**: 
  - 在 `index.html` 的 `<head>` 中注入同步脚本，防止首屏闪烁（FOUC），根据本地存储或系统偏好立即设置 `document.documentElement.classList` 和 `colorScheme`。
  - `useTheme` Hook 监听 `prefers-color-scheme` 变化（仅在 System 模式下），并动态切换 `<html>` 上的 `.dark` 类。
- **组件适配**:
  - **Tailwind**: 使用 `@custom-variant dark (&:where(.dark, .dark *))` 定义深色变体，所有 `dark:` 前缀的类名由此驱动。
  - **Ant Design**: `src/App.tsx` 中的 `AntdThemeSync` 组件将 `resolvedTheme` 映射到 `ConfigProvider` 的 `algorithm`（`darkAlgorithm` 或 `defaultAlgorithm`）。
  - **Monaco Editor**: `FileEditor.tsx` 根据主题动态切换 `vs` (Light) 或 `vs-dark` (Dark) 主题。

### 2.2 品牌设计令牌 (Design Tokens)
在 `src/index.css` 中定义了基于 CSS 变量的“胡萝卜橙”品牌色系，支持明暗模式自动切换：
- `--brand-primary`: 主文字/链接色 (`#E07B00` Light / `#F5824C` Dark)。
- `--brand-solid`: 实心按钮底色。
- `--brand-soft-bg/border`: 选中态浅底与次级按钮描边。

## 3. 全局样式约定

### 3.1 Tauri 特定样式
- **拖拽区域**: `[data-tauri-drag-region]` 禁用用户选择 (`user-select: none`)，确保窗口拖拽体验流畅。
- **宠物窗口 (Pet Window)**: 
  - 通过 URL 参数 `?window=pet` 识别，在 `index.html` 中为根元素添加 `.pet-window-document` 类。
  - 强制背景透明 (`rgba(0,0,0,0)`)，禁用溢出，实现异形窗口效果。
  - 包含复杂的 SVG 动画关键帧（呼吸、工作抖动、电路脉冲），用于桌面宠物组件。

### 3.2 滚动条定制
- 定义 `.thin-scrollbar` 工具类，将滚动条宽度压缩至 3px，并适配明暗模式颜色，用于知识库等密集内容区域。

### 3.3 第三方组件覆盖
- **XMarkdown**: 强制缩小字号（13px 正文，12px 代码），统一行高。
- **Ant Sender**: 禁用 Switch 组件的过渡动画与波纹效果，以符合应用整体的即时响应风格。

## 4. 开发规范与建议

1. **样式编写优先序**: 
   - 首选 Tailwind 原子类（如 `flex`, `bg-white`, `dark:bg-gray-800`）。
   - 复杂动画或全局重置使用 `src/index.css`。
   - 避免在组件内使用 `<style>` 标签或内联 `style`（除非是动态计算值，如宠物位置）。

2. **深色模式适配**: 
   - 新增 UI 时，必须同时提供 `dark:` 变体。
   - 颜色应优先引用 CSS 变量（如 `var(--brand-primary)`）或 Tailwind 默认色板，避免硬编码 Hex 值。

3. **组件库主题同步**: 
   - 所有 Ant Design 组件必须包裹在 `ConfigProvider` 内，严禁单独引入未受控的 antd 组件。
   - 自定义 antd 样式时，优先通过 `ConfigProvider` 的 `theme.token` 配置，其次使用 CSS 选择器覆盖。

4. **性能注意**: 
   - `index.html` 中的主题同步脚本应保持轻量，避免阻塞首屏渲染。
   - 宠物窗口的 SVG 动画在 `prefers-reduced-motion: reduce` 环境下应自动禁用。