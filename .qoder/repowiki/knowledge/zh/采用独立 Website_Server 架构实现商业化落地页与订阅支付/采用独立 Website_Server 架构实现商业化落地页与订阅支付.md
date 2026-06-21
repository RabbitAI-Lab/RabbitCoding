---
kind: design
name: 采用独立 Website/Server 架构实现商业化落地页与订阅支付
source: session
category: adr
---

# 采用独立 Website/Server 架构实现商业化落地页与订阅支付

_来源：dc1bf71 → 717fd1f 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
Rabbit Coding 桌面应用需要面向公众的产品落地页及商业化订阅能力，但需避免将 Web 营销页面和支付逻辑耦合进现有的 Rust/Tauri 桌面端代码库，以保持桌面应用的轻量化和独立部署能力。

## 决策驱动
- 关注点分离（营销/支付与桌面应用解耦）
- 独立构建与部署灵活性
- 技术栈适配性（Web 前端与 Node.js 后端更适合营销场景）

## 备选方案
- **新建独立的 website/ 和 server/ 项目并纳入 pnpm workspace** — 优点：完全隔离桌面应用与 Web 业务；可独立选择 React/Vite 和 Node.js/Fastify 技术栈；不影响 Tauri 构建流程；便于单独部署到公有云或 CDN。；缺点：增加了仓库中的项目数量；需要维护两套依赖配置。
- **在现有 Tauri 项目中集成 Web 路由或作为子模块** _（已否决）_ — 优点：代码集中管理。；缺点：导致桌面应用二进制体积膨胀；混淆了桌面端与 Web 端的职责；部署营销页面时需要启动完整的桌面应用环境或复杂的提取流程。

## 决策
在仓库根目录新建 `website/` (React + Tailwind v4 + Vite) 和 `server/` (Node.js + Fastify + better-sqlite3) 两个独立项目，并通过 `pnpm-workspace.yaml` 统一管理。`website/` 负责落地页展示与下载引导，`server/` 负责对接 ZPAY 支付网关、处理订单签名验签及激活码管理。

## 影响
实现了营销站点与桌面应用的物理隔离，提升了各自的技术选型自由度。但需要维护额外的 Node.js 后端服务，且需确保前后端在定价数据（pricing.ts）上的一致性，同时需严格遵循安全规范（如密钥仅存于后端、金额防篡改）。