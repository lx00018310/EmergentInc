# EmergentInc V5 — API Sandbox

V5 的核心变化不是增加更多 Agent，而是把每一次 AI 推理真正关进认知沙盒。

正式实验结构：

```text
World Engine
   ↓ allow-list context
Context Sandbox
   ↓ single stateless API call
LLM API
```

模型在每次调用中都没有：仓库、文件系统、shell、browser、全局 world_state、非邻居 Pixel、未来计划或历史聊天。

---

## 1. 目录架构

项目采用四层分离架构：

```text
EmergentInc元胞会社/
├─ emergentinc/                 # 核心稳定程序
│  ├─ paths.py                  # 集中不可变路径契约
│  ├─ engine/                   # 运行引擎 (runner, storage, sandbox, actions 等)
│  ├─ ui/                       # Web UI 与视觉控制台
│  └─ cli/                      # 运维、初始化、自检与迁移入口
├─ resources/                   # 版本化静态输入
│  ├─ config/                   # world_config.json
│  ├─ schemas/                  # JSON Schemas
│  ├─ prompts/                  # System Prompts
│  ├─ templates/                # 模板文件
│  ├─ experiments/              # 实验配置
│  └─ bootstrap/                # 新工作区最小初始状态模板
├─ workspace/                   # 单一运行工作区 (受 .gitignore 保护，不污染 Git)
│  ├─ live/                     # 当前可变世界 (world_state.*, pixels, problems 等)
│  ├─ loops/                    # Loop 元数据、分支与检查点
│  ├─ runtime/                  # LLM 请求/响应及运行日志
│  ├─ cache/                    # 运行时缓存
│  ├─ ui_state/                 # UI 指令历史
│  ├─ scratch/                  # 临时交互区
│  └─ private/                  # 私密凭据与密钥 (绝不进入快照/API/Git)
├─ tests/                       # 自动化测试套件
├─ docs/                        # 文档与历史记录
│  ├─ guides/                   # 开发与指南
│  └─ history/                  # 历史报告与 Manifest
├─ EmergentInc_UI.bat           # Windows 双击启动入口
├─ EmergentInc_UI.ps1           # PowerShell 启动脚本
├─ README.md
├─ requirements.txt
├─ .env.example
└─ .gitignore
```

---

## 2. 快速上手

### 2.1 安装依赖
```bash
pip install -r requirements.txt
```

### 2.2 工作区初始化
若创建全新工作区或在空目录初始化：
```bash
python -m emergentinc.cli.init_workspace --workspace .\workspace
```
> 注：若目标工作区非空，该命令会自动拒绝覆盖以保护现有实验数据。

### 2.3 系统自检
```bash
python -m emergentinc.cli.self_check --workspace .\workspace
```

### 2.4 运行实验
在终端直接运行指定轮次：
```bash
python -m emergentinc.engine.runner --workspace .\workspace --rounds 10
```

### 2.5 启动视觉控制台 (UI)
Windows 用户可直接双击运行根目录下的 `EmergentInc_UI.bat`，或在终端执行：
```powershell
python -m emergentinc.ui.app --workspace .\workspace
```

---

## 3. 数据备份与恢复

- **Loop 检查点**：运行中的快照会自动保存在 `workspace/loops/checkpoints/<LoopID>/before` 和 `after` 中，包含当时完整业务世界；私有凭据（`workspace/private/`）绝不进入快照。
- **分支与回滚**：UI 支持在 Loop 树上进行 checkout 与 branch，一键将 `workspace/live/` 恢复至特定检查点状态。
- **整库备份**：如需完整归档某次长线实验，直接打包复制整个 `workspace/` 目录即可。

---

## 4. API 配置

可在项目根目录 `.env` 文件中配置（参考 `.env.example`）：

```bash
MCL_API_KEY=YOUR_KEY
MCL_BASE_URL=YOUR_OPENAI_COMPATIBLE_ENDPOINT
MCL_MODEL=YOUR_MODEL
```

可分别指定各任务模型：

```bash
MCL_DECISION_MODEL=...
MCL_VALIDATOR_MODEL=...
MCL_MEMORY_MODEL=...
```

---

## 5. Owner 边界

Owner 只负责现实权限和客观事实，不负责商业策略。

- Owner 可以批准 VPS / 域名 / 邮箱 / API / 支付观察能力，也可以记录客观访问量和真实外部交易。
- 如果 Problem 要求真实外部客户，则 Owner 自己付款、测试转账、模型自述都不能完成验收。
- 所有敏感凭据必须存放于 `workspace/private/`，API 与快照层对其做严格物理隔离。
