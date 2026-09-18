# Emergent Inc 元胞会社

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
│  ├─ tools/                    # 内置工具运行时（artifact 读写转移、私有文件）
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

`vps_*` 工具已原生实现（系统 OpenSSH 客户端），但只有启动时的离线探测 `probeVpsAvailability()` 判定 `workspace/private/owner_vps_profile.json` 可用（密钥认证 + `allowed_operations` 命中）才注册；当前该配置只有密码，因此实际不注册，服务端启动日志会打印确切原因。

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

服务监听 `http://127.0.0.1:8765`，同时托管前端。模型配置读取根目录 `.env`（`MCL_API_KEY` 等）；缺少有效 key 时服务以保护模式启动，Run 请求会被拒绝。

### 3.4 测试与类型检查

```bash
npx pnpm test          # vitest：apps/server、frontend、packages/*、tests/parity
npx pnpm typecheck
```
