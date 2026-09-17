# Emergent Inc AI 元胞自动会社 (V10 Small Runtime 版)

Emergent Inc 是一个基于认知沙盒的 3D AI 元胞自动机系统。V10 版本已完成全栈 TypeScript 核心重构，由基于 Node.js + SQLite 的 Small Core、Protocol-driven 架构驱动。

架构主链路：

```text
            React UI
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

元胞在每次调用中均无宿主 shell、无全局世界状态、无非邻居元胞数据、无历史聊天记忆。元胞的一切状态沉淀于自身的心智文件（`pixel.md`）及本地隔离交付物（`artifacts/`）。

---

## 1. Monorepo 目录结构

```text
EmergentInc元胞会社/
├─ apps/
│  ├─ server/                   # Fastify HTTP API 与静态服务适配层
│  └─ web/                      # React + TypeScript + Vite 前端 (指向 frontend)
├─ packages/
│  ├─ protocol/                 # 统一数据结构、状态机枚举、Unicode 与 DTO
│  ├─ domain/                   # 纯领域规则 (3D拓扑、能量守恒、繁殖规则、路由规则)
│  ├─ persistence/              # SQLite 单一事实源与事务 Repositories
│  ├─ model/                    # Prompt 组装、OpenAI 适配器、响应解析器与用量计费
│  ├─ tools/                    # 12项内置安全工具运行时 (Artifacts, Private, VPS)
│  └─ runtime/                  # Small Scheduler, AgentStepRunner, EffectRuntime
├─ workspace/                   # 数据工作区 (.gitignore 保护)
│  ├─ live/                     # 当前可变世界 (pixels, environment.md, artifacts 等)
│  ├─ ledger/                   # SQLite 权威事实源 (v9_core.sqlite3)
│  ├─ runtime/                  # 运行时提示词版本等
│  └─ private/                  # 私有文件与受保护凭据
├─ tests/                       # 测试套件 (含 fixtures/golden 与 parity 场景测试)
├─ EmergentInc_UI.bat           # Windows 双击启动脚本 (Node 原生)
├─ EmergentInc_UI.ps1           # PowerShell 启动脚本
├─ pnpm-workspace.yaml          # Monorepo Workspace 配置
└─ README.md
```

---

## 2. 快速上手

### 2.1 环境要求
* Node.js: >= 22.0.0 (推荐 22+ 或 24+)
* pnpm: >= 9.0.0 (支持通过 `npx pnpm` 直接运行)

### 2.2 安装依赖与构建
```bash
npx pnpm install
npx pnpm build
```

### 2.3 启动服务与界面
双击 `EmergentInc_UI.bat`，或在终端执行：

```bash
npx pnpm --filter @emergentinc/server start
```
服务将在 `http://127.0.0.1:8765` 启动，并自动托管前端可视化界面。

### 2.4 运行自动化测试
```bash
npx pnpm test
```
包含所有 Package 单元测试、前端测试及 Phase 10 Golden Parity 等价性测试。
