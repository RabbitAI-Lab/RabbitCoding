---
kind: design
name: 采用虚拟模型配置与双Token机制集成Portal线上模型
source: session
category: adr
---

# 采用虚拟模型配置与双Token机制集成Portal线上模型

_来源：31586ac → 7909aa7 提交周期内记录的编码计划——内容为规划时意图，实现可能滞后或有出入。_

**状态：** accepted

## 背景
需要在前端接入 Portal 提供的线上模型，同时保持与现有自定义模型（Sidecar流程）的兼容性。Portal 采用双层鉴权体系：Casdoor AccessToken 用于身份认证，AI Forwarding Key 用于模型接口调用，且后者仅在首次创建时返回明文，后续需客户端缓存。

## 决策驱动
- 兼容现有 Sidecar 调用链路
- 适配 Portal 双层密钥鉴权机制
- 区分线上托管模型与用户自定义模型

## 备选方案
- **运行时构造虚拟 ModelConfig** — 优点：无需修改底层 useAgent/Sidecar 逻辑，通过统一 ModelConfig 接口屏蔽来源差异；支持动态获取 API Key；缺点：需在 UI 层处理 Key 缺失时的异步获取与登录引导逻辑
- **将线上模型持久化到本地配置** _（已否决）_ — 优点：管理方式与自定义模型一致；缺点：无法适应线上模型列表的动态变化；难以处理临时性/轮换性的 AI Forwarding Key

## 决策
1. 定义线上模型 ID 前缀为 `__online__:` 以区分自定义模型 UUID。
2. 新建 `src/utils/portalClient.ts` 封装 Portal 接口，实现 Casdoor Token 到 AI Forwarding Key 的兑换逻辑。
3. 新建 `src/hooks/useOnlineModels.ts`，在 localStorage 中缓存 `ai-forwarding-key`，并在 Key 缺失时自动触发兑换流程。
4. 在 `ContentArea` 中拦截选中事件，若为线上模型且无 Key，则引导登录或异步获取 Key，随后构造虚拟 `ModelConfig`（provider='anthropic'）传入现有流程。

## 影响
前端需维护两套模型数据源（本地配置 vs Portal API）；登出时必须清除 localStorage 中的 `ai-forwarding-key` 以防止跨账号密钥泄露；线上模型的可用性依赖于 Portal 服务的连通性及 Token 的有效性。