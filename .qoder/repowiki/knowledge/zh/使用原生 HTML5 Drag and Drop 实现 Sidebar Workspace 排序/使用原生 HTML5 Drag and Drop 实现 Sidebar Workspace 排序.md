---
kind: design
name: 使用原生 HTML5 Drag and Drop 实现 Sidebar Workspace 排序
source: session
category: adr
---

# 使用原生 HTML5 Drag and Drop 实现 Sidebar Workspace 排序

_来源：dc1bf71 → 717fd1f 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
Sidebar 中的 Workspace 列表默认按创建顺序排列，用户缺乏自定义排序手段。需要一种轻量级的拖拽排序方案，且不引入沉重的第三方依赖库。

## 决策驱动
- 零依赖（避免引入 @dnd-kit 等库增加包体积）
- Tauri 桌面环境特性（无需考虑移动端触摸兼容）
- 利用现有 SQLite 数组索引持久化机制

## 备选方案
- **使用原生 HTML5 Drag and Drop API** — 优点：无额外依赖；浏览器原生支持；与 React 状态集成简单；足以满足桌面端鼠标操作需求。；缺点：API 略显陈旧；自定义拖拽视觉效果（如占位符）需手动实现。
- **引入 @dnd-kit 或 react-beautiful-dnd** _（已否决）_ — 优点：提供完善的无障碍支持和复杂的动画效果。；缺点：显著增加 bundle 大小；对于简单的单列排序而言过度设计。

## 决策
采用原生 HTML5 Drag and Drop API 实现拖拽排序。在 `WorkspaceItem` 左侧添加 `GripVertical` 手柄作为拖拽触发区，通过 `reorderWorkspace` 方法更新内存中的数组顺序，并利用现有的防抖保存机制自动持久化到 SQLite。为解决拖拽时嵌套内容导致的布局冲突，决定在拖拽开始时自动折叠所有 Workspace。

## 影响
以极小的代码代价实现了排序功能，保持了项目的轻量级。但原生 DnD 的视觉反馈（如蓝色边框指示线）需手动 CSS 实现，且拖拽时强制折叠所有工作区虽然解决了布局问题，但改变了用户的展开状态偏好（拖拽后保持折叠）。