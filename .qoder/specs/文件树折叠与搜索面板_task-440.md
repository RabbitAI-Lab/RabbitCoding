# 条件按钮 margin-top 2px

## Context

搜索输入框内嵌的三个条件按钮（CaseSensitive/WholeWord/Regex）需要向下偏移 2px，以精确对齐输入框水平中心线。

## 修改文件

`src/components/files/SearchPanel.tsx`

将 line 245 的条件按钮容器添加 `mt-0.5`（2px）：

```tsx
// 当前
<div className="absolute right-0.5 top-0 h-6 flex items-center gap-0 leading-none">

// 改为
<div className="absolute right-0.5 top-0 h-6 mt-0.5 flex items-center gap-0 leading-none">
```

## 验证

`npx tsc --noEmit` 编译通过，三个条件按钮向下偏移 2px。
