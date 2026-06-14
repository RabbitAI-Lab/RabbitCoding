# 在 Spec 生成提示词中说明不要生成 Plan 副产物

## Context（背景）

Spec 生成流程使用 Claude SDK 的 `permissionMode: 'plan'` 来限制工具权限（只允许只读工具 + WriteSpec）。但在 plan 模式下，模型倾向于调用 `ExitPlanMode` 呈现一份 plan，并可能在 `.claude/plans/` 目录留下 plan 副产物文件。

虽然 sidecar（`sidecar/src/agent.ts`）已经在 `canUseTool` 中拦截了 `ExitPlanMode`（返回 deny），但从提示词层面直接告知模型「不要生成 plan」更干净，可减少模型浪费 turn 去构造 plan、避免无谓的 token 消耗和副产物文件。

本次改动仅针对 spec 生成的提示词，**不修改** spec 文档内部的「实现计划」章节结构（那是 spec 文档的合法组成部分），也**不修改** plan 模式本身。

## 目标文件

- `src/utils/specGenerator.ts` — 仅修改 [buildSpecPrompt](src/utils/specGenerator.ts#L93-L114) 函数

## 具体改动

在 `buildSpecPrompt` 返回的提示词中，增加一条明确指令，要求模型：

1. **不要生成 plan** —— 不要调用 `ExitPlanMode`，不要生成任何 plan 文档或 `.claude/plans/` 副产物。
2. **只产出 spec 文档** —— 唯一的产出方式是通过 `WriteSpec` 工具把规范文档写入 `.rabbit/specs/`。

### 拟新增的提示词文本（英文，与现有提示词语言保持一致）

在现有 `IMPORTANT: ...` 段落之后、`User Request` 之前，插入：

```
Do NOT generate a plan. Do not call ExitPlanMode, and do not produce any plan document or leave any files under a .claude/plans/ directory. Your only deliverable is the specification document saved via the WriteSpec tool.
```

其余内容（包含「4. **实现计划**」章节在内的 spec 结构、Steps 流程）保持不变。

## 不在本次范围

- 不改动 `sidecar/src/agent.ts` 中对 `ExitPlanMode` 的拦截逻辑（已存在的兜底保护保留）。
- 不改动 plan 模式的 `permissionMode` 配置。
- 不改动 spec 文档的章节结构。

## 验证方式

1. 启动应用（`pnpm tauri dev`），触发一次 spec 生成（发送一条任务消息，进入 spec 流程）。
2. 观察生成的 spec 文档是否正常写入 `.rabbit/specs/` 目录，且内容结构完整（仍包含「实现计划」章节）。
3. 确认 `.claude/plans/` 目录下没有因本次 spec 生成而产生新的 plan 副产物文件。
4. 查看 sidecar stderr 日志，确认模型不再尝试调用 `ExitPlanMode`（即 `[agent] Blocked ExitPlanMode` 日志不再频繁出现）。
