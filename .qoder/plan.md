# 修复 Sender 用量统计弹出面板超出窗口右边界

## Context（背景）

当侧边栏关闭时，内容区（ContentArea）变宽，Sender footer 中的 ContextIndicator（上下文用量指示器）会更靠近应用窗口右边缘。该组件 hover 后通过通用 `Popover` 组件弹出一个宽度 `240px` 的用量面板。由于 `Popover` 当前的定位逻辑直接使用锚点元素的左边界作为面板 `left`，未做窗口右边界溢出检测，导致 `锚点left + 240px` 超出窗口右边界，面板被裁切/溢出。

预期结果：弹出面板始终完整显示在窗口内，靠近右边缘时自动左移贴合边缘。

## 根因

文件：`src/components/common/Popover.tsx`（第 20-31 行）

```js
useLayoutEffect(() => {
  if (open && anchorRef.current) {
    const anchorRect = anchorRef.current.getBoundingClientRect();
    setPosition({
      left: anchorRect.left,           // 仅取锚点左边界，未考虑面板宽度是否会溢出右边
      bottom: window.innerHeight - anchorRect.top + 4,
    });
  }
  ...
}, [open, anchorRef]);
```

`Popover` 被 3 处使用，其中只有 ContextIndicator（位于 footer 右侧）会触发右溢出；SidebarFooter、ModelSelector 位于左侧，不受影响。

## 修改方案

**仅修改一个文件：`src/components/common/Popover.tsx`**

在现有定位逻辑基础上，增加"渲染后测量实际宽度 + 边界溢出修正"，并补充窗口 resize 监听：

1. **初次定位**：保持现有逻辑（基于锚点左边界 + bottom 间距），但重置测量标记。
2. **渲染后测量修正**：新增一个依赖 `position` 的 `useLayoutEffect`，在面板已渲染（`popoverRef.current` 存在）后测量实际 `offsetWidth`：
   - 检测右溢出：若 `position.left + width > window.innerWidth - MARGIN`，则 `left = max(MARGIN, innerWidth - width - MARGIN)`
   - 检测左溢出：若 `position.left < MARGIN`，则 `left = MARGIN`
   - 用 `measuredRef` 标记确保每次 open 只测量修正一次，避免与 `setPosition` 形成循环
3. **窗口 resize 监听**：在 open 期间监听 `window.resize`，重新计算锚点位置并触发一次完整的定位+修正流程，使面板跟随窗口尺寸变化始终保持在视口内。
4. `MARGIN` 取 `8px` 作为安全边距。

### 关键代码结构（示意）

```tsx
const measuredRef = useRef(false);

// 初次定位
useLayoutEffect(() => {
  if (open && anchorRef.current) {
    measuredRef.current = false;            // 每次打开重置测量标记
    const anchorRect = anchorRef.current.getBoundingClientRect();
    setPosition({
      left: anchorRect.left,
      bottom: window.innerHeight - anchorRect.top + 4,
    });
  }
  if (!open) setPosition(null);
}, [open, anchorRef]);

// 渲染后测量实际宽度并修正边界溢出
useLayoutEffect(() => {
  if (!position || measuredRef.current || !popoverRef.current) return;
  measuredRef.current = true;
  const width = popoverRef.current.offsetWidth;
  const innerWidth = window.innerWidth;
  const MARGIN = 8;
  let newLeft = position.left;
  if (newLeft + width > innerWidth - MARGIN) {
    newLeft = Math.max(MARGIN, innerWidth - width - MARGIN);
  } else if (newLeft < MARGIN) {
    newLeft = MARGIN;
  }
  if (newLeft !== position.left) {
    setPosition(prev => (prev ? { ...prev, left: newLeft } : prev));
  }
}, [position]);

// resize 时重新定位（open 期间）
useEffect(() => {
  if (!open) return;
  const handleResize = () => {
    if (anchorRef.current) {
      measuredRef.current = false;
      const anchorRect = anchorRef.current.getBoundingClientRect();
      setPosition({
        left: anchorRect.left,
        bottom: window.innerHeight - anchorRect.top + 4,
      });
    }
  };
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, [open, anchorRef]);
```

### 影响面评估（零回归）

- `SidebarFooter`（usage/settings popover）：锚点在左侧，不会触发右溢出分支，行为不变。
- `ModelSelector`：锚点在 footer 左侧，不会溢出，行为不变。
- `ContextIndicator`：右溢出时自动左移贴合右边缘，问题修复。

## 验证方式

1. 启动开发环境：`pnpm dev`（前端）+ Tauri 运行。
2. **关闭侧边栏**，选中一个 Rabbit 进入会话，鼠标 hover Sender 右下角的圆形用量指示器（ContextIndicator）。
3. 确认弹出的用量面板（240px 宽）完整显示在窗口内，右边缘不再被裁切。
4. 打开侧边栏后再次 hover，确认面板仍能正常定位（不溢出场景不受影响）。
5. 面板打开状态下拖拽缩小窗口宽度，确认面板随 resize 自动左移，保持在视口内。
6. 回归验证：点击侧边栏底部的用量统计按钮与设置按钮、以及 footer 左侧的 ModelSelector，确认其弹出面板定位正常。
