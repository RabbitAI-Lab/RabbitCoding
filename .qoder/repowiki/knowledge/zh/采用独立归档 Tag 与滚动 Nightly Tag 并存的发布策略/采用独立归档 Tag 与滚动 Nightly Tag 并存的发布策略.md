---
kind: design
name: 采用独立归档 Tag 与滚动 Nightly Tag 并存的发布策略
source: session
category: adr
---

# 采用独立归档 Tag 与滚动 Nightly Tag 并存的发布策略

_来源：ea7418e → 31586ac 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
原有的 CI 流程将所有 main 分支的构建产物上传至固定的 `nightly` tag，导致历史版本被覆盖，无法追溯。同时，项目需要支持 Tauri updater，要求有一个稳定的入口指向最新构建，而开发者也需要保留每次推送的历史记录以便回溯或调试。

## 决策驱动
- 版本历史可追溯性
- 自动更新机制稳定性
- CI/CD 自动化维护成本

## 备选方案
- **仅使用唯一 Tag (nightly-{date}-{sha})** _（已否决）_ — 优点：每个构建都有独立记录，无覆盖风险；缺点：Tauri updater 需要硬编码或动态获取最新 tag，配置复杂；用户下载入口不固定
- **仅使用固定 Tag (nightly)** _（已否决）_ — 优点：Updater 配置简单，下载链接恒定；缺点：历史构建被覆盖，无法回溯之前的 nightly 版本
- **双 Tag 策略：独立归档 + 滚动 Nightly** — 优点：既保留了每次推送的独立历史记录（nightly-{date}-{sha}），又通过强制移动 `nightly` tag 始终指向最新构建，满足 updater 需求；缺点：CI 流程稍复杂，需增加 sync-nightly job 来同步资产

## 决策
在 `.github/workflows/build.yml` 中实施双 Tag 策略：每次 push 到 main 时生成唯一的 `nightly-{DATE}-{SHORT_SHA}` tag 用于归档；同时新增 `sync-nightly` job，将 `nightly` tag 强制移动到最新提交，并重建 release 以复制最新的安装包和 `latest.json`。Updater endpoint 继续指向固定的 `nightly` tag。

## 影响
Releases 页面将包含大量独立的 nightly 归档版本，便于历史回溯；Tauri updater 可通过固定的 `nightly` tag 稳定获取最新版本信息。CI 流水线增加了 tag 同步和资产复制的步骤，但实现了历史保留与更新便利性的平衡。