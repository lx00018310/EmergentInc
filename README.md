# Emergent Inc 元胞会社

![EmergentInc 概念图](Imag_EmergentInc.png)

## AI 创业矩阵

> **做 AI 的老板，从第一笔生意开始。**
>
> 这套 AI 创业矩阵的第一项业务，就是为自己的首发找到第一位付费用户。

EmergentInc 让用户提出商业目标，提供预算与现实权限，再观察 AI 元胞在有限能量、局部通信和受控工具下尝试形成分工、产出交付物并推进业务。它的目标是探索 AI 如何参与建立业务；当前仍处于首发筹备阶段，不能承诺使用后必然赚钱、组织必然形成或完全无人干预。

这个开源仓库是产品说明、技术验证和公开案例入口；服务器上的首发业务是 EmergentInc 服务真实用户的第一个应用。计划中的闭环是：仓库 README 引导用户到业务页，EmergentInc 生成营销或交付材料，外部反馈推动系统和文档改进，再将经过脱敏的案例反馈回仓库。首发页面已上线，先接咨询、确认后付款；外部收入仍为 0。

当前首发体验：**1 元，首批 3 个名额，人工协助运行 EmergentInc**。提交一个小型商业目标，获得目标拆解和一份材料，包含一次原需求修订；确认需求及排期后 48 小时内交付，模型成本由项目承担，无法交付则退回体验费。每位最多两个单轮 Run、目标预算累计 100,000 token。当前先接咨询，确认可承接和真实支付方式后才收款。公开源码不属于付费专属内容。

**[查看首发业务页](http://47.116.139.252/) · [提交体验咨询](https://github.com/lx00018310/EmergentInc/issues/1) · [范围与交付说明](docs/launch/DELIVERY.md)**

首发商品说明、页面初稿、宣传稿与 FAQ 已由 Pixel 实际生成，Codex 核对修订并部署。见[产物与来源](docs/launch/)和[首发尝试记录](docs/cases/first-customer.md)。尚无外部付款、交付或客户反馈，收入闭环仍未完成。

基于 TypeScript 的 3D 元胞自动机世界：元胞在有限能量与预算下自主决策、互相通信、积累资产。全栈 Node.js + SQLite + React，无 Python 组件。

架构主链路：

```text
            React UI (frontend)
                │
                ▼
           Fastify API (apps/server)
                │
                ▼
            RunService
                │
                ▼
          RoundScheduler
                │
           claim Message
                │
                ▼
          AgentStepRunner
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
    Context   Model   Protocol
    Runtime  Runtime
       │        │
       └────┬───┘
            ▼
      AgentDecision
            │
            ▼
     DecisionCompiler
            │
            ▼
        Effects[]
            │
            ▼
      EffectRuntime
            │
  ┌─────────┼───────────┐
  ▼         ▼           ▼
Tool      Energy      Router
Runtime   Domain      Domain
  │
  ▼
SQLite / Files
```

元胞每次调用都没有宿主 shell、没有全局世界状态、没有非邻居元胞数据、没有聊天记忆。它的状态只沉淀在自身心智文件 `pixel.md` 与本地隔离交付物 `artifacts/` 中。

---

## 1. 目录结构

```text
EmergentInc元胞会社/
├─ apps/
│  └─ server/                   # Fastify HTTP API、RunService、静态托管
├─ packages/
│  ├─ protocol/                 # 统一数据结构、状态机枚举、DTO
│  ├─ domain/                   # 纯领域规则（3D 拓扑、能量守恒、繁殖、路由）
│  ├─ persistence/              # SQLite 单一事实源与事务 Repository
│  ├─ model/                    # Prompt 组装、OpenAI 兼容适配器、用量计费
│  ├─ tools/                    # 内置工具运行时（artifact、私有文件、网页、GitHub、VPS）
│  └─ runtime/                  # RoundScheduler / AgentStepRunner / EffectRuntime
├─ frontend/                    # React + TypeScript + Vite 控制台
├─ resources/
│  ├─ config/model_pricing.json     # 模型定价（预算计量依据）
│  └─ prompts/v9_system_prompt.md   # 系统提示词基线
├─ tests/
│  └─ parity/golden_scenarios.test.ts   # 端到端主链场景测试
├─ docs/                        # 当前架构与规则文档
├─ workspace/                   # 运行数据，不进 Git（见下）
├─ EmergentInc_UI.bat / .ps1    # Windows 启动脚本
└─ package.json                 # pnpm workspace 根
```

所有内置工具始终注册，`workspace/private/tools.json` 的 `enabled` 是唯一的工具授权配置；未配置的 VPS 工具默认禁用。`GET /api/tools` 显示每个工具的有效状态。VPS 工具由系统 OpenSSH 客户端执行；凭据、远端路径和读写能力以实际调用回执为准。`vps_exec` 启用后可执行任意远端命令。`webfetch` 可只读抓取公开网页；`github_repo` 可只读查看公开 GitHub 仓库的目录和文本文件。

---

## 2. workspace 约定

`workspace/` 被 `.gitignore` 完全排除，是唯一运行数据区，结构与代码仓库分开演进：

```text
workspace/
├─ live/
│  ├─ world_state.json          # round 与外部记账计数器
│  ├─ environment.md            # 全局环境描述（元胞可读）
│  ├─ pixels/<id>/              # 每个元胞：state.json + pixel.md + tips.md
│  └─ artifacts/<id>/           # 元胞私有交付物
├─ ledger/v9_core.sqlite3       # 权威事实源（账户、run、消息、调用、效应、预算）
├─ runtime/genesis_prompt.json  # 创世提示词
└─ private/                     # 工具开关、Owner 资料、收款码（禁止进入 artifact 与消息）
```

* 能量与 `active` 以 SQLite `pixel_accounts` 为准，`state.json` 与之保持一致。
* 邻居由 `getNeighbors6()` 按坐标实时计算，不写入磁盘。
* 运行历史、实验过程、旧日志不进仓库，也不做归档。

---

## 3. 快速上手

### 3.1 环境要求

* Node.js >= 22（SQLite 驱动为 Node 原生 `node:sqlite`）
* pnpm >= 9（可用 `npx pnpm`）

### 3.2 安装与构建

```bash
npx pnpm install
npx pnpm build
```

### 3.3 启动服务与界面

双击 `EmergentInc_UI.bat`（会先构建前端再启动），或：

```bash
npx pnpm --filter @emergentinc/server start
```

服务监听 `http://127.0.0.1:8765`，同时托管前端。模型配置读取根目录 `.env`（`MCL_API_KEY` 等）；上游支持 SSE 时可配置 `MCL_STREAM=1`，中断仍保留为结果未知，不自动重试。缺少有效 key 时服务以保护模式启动，Run 请求会被拒绝。

### 3.4 测试与类型检查

```bash
npx pnpm test          # vitest：apps/server、frontend、packages/*、tests/parity
npx pnpm typecheck
```
