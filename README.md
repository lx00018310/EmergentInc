# Emergent Inc AI 元胞自动会社 (V9 本地核心版)

Emergent Inc 是一个基于认知沙盒的 3D AI 元胞自动机系统。每个元胞（Pixel）作为独立的认知主体，在严格的物理与信息隔离沙盒中运行。

实验与推理结构：

```text
World Engine (3D 物理网格 & 消息路由器)
   ↓ allow-list context (仅自身状态 + 3D六邻域活跃度 + 收到的消息)
Context Sandbox
   ↓ single stateless API call
LLM API
```

元胞在每次调用中均无宿主 shell、无全局世界状态、无非邻居元胞数据、无历史聊天记忆。元胞的一切状态沉淀于自身的心智文件（`pixel.md`）及本地隔离交付物（`artifacts/`）。

---

## 1. 目录架构

```text
EmergentInc元胞会社/
├─ emergentinc/                 # 核心稳定程序
│  ├─ paths.py                  # 集中不可变路径契约
│  ├─ engine/                   # 运行引擎 (scheduler, router, core_store, operations 等)
│  ├─ ui/                       # Web UI、API 路由与运行控制器
│  └─ cli/                      # 初始化与系统自检入口
├─ resources/                   # 静态资产与版本化配置
│  ├─ schemas/                  # JSON Schemas (V9 元胞响应规范)
│  ├─ prompts/                  # System Prompts (V9 认知沙盒提示词)
│  └─ bootstrap/                # 新工作区初始创世模板 (pixel.md, state.json, environment.md)
├─ workspace/                   # 运行工作区 (.gitignore 保护)
│  ├─ live/                     # 当前可变世界 (pixels, environment.md, artifacts 等)
│  │  ├─ pixels/                # 各元胞独立目录 (state.json, pixel.md)
│  │  ├─ environment.md         # 外部环境客观真理
│  │  └─ artifacts/             # 元胞交付物沉淀目录 (按 pixel_id 隔离)
│  ├─ ledger/                   # 权威核心存储 (v9_core.sqlite3)
│  ├─ runtime/                  # 运行时队列与 LLM 调用归档
│  ├─ ui_state/                 # UI 指令与流动轨迹
│  └─ private/                  # 私密凭据与密钥
├─ tests/                       # 自动化测试套件
├─ docs/                        # 设计文档与重构规范
├─ EmergentInc_UI.bat           # Windows 双击启动入口
├─ requirements.txt
└─ README.md
```

---

## 2. 快速上手

### 2.1 安装依赖
```bash
pip install -r requirements.txt
```

### 2.2 配置大模型 API
在项目根目录创建或编辑 `.env` 文件（参考 `.env.example`）：

```bash
MCL_API_KEY=your_api_key_here
MCL_BASE_URL=https://api.openai.com/v1
MCL_MODEL=gpt-4o-mini
```

### 2.3 工作区初始化
在目标工作区目录建立初始创世元胞与唤醒队列：
```bash
python -m emergentinc.cli.init_workspace --workspace .\workspace
```
> 注：命令会自动生成初始创世元胞（`0_0_0`）、环境文件（`environment.md`）、交付物目录以及初始创世唤醒消息，并在权威数据库登记账户。

### 2.4 系统自检
检查运行环境与沙盒配置：
```bash
python -m emergentinc.cli.self_check --workspace .\workspace
```

### 2.5 启动视觉控制台 (UI)
Windows 用户可直接双击运行根目录下的 `EmergentInc_UI.bat`，或在终端执行：
```powershell
python -m emergentinc.ui.app --workspace .\workspace
```
浏览器访问 `http://127.0.0.1:8000` 即可进入控制台。

---

## 3. 核心主路径与演化流程

在 Web 控制台中：
1. **设置硬预算**：设定“本次运行上限 (Tokens)”与“累计总上限 (Tokens)”，系统具备强校验硬预算拦截，超限自动安全熔断；
2. **启动演化**：设定轮次数并点击“运行 X 轮”，RunController 将调用单一 V9 调度器消费消息流并触发模型推理；
3. **观察元胞与交付物**：
   - 3D 视图中悬停或点击元胞卡片，可查阅当前元胞心智（`pixel.md`）、能量与状态；
   - 点击“查看交付物”按钮，直接浏览与查阅该元胞使用 `save_artifact` 写入的本地文件内容。

---

## 4. 能力边界与当前收敛说明

为保证本地核心演化与交付物主干绝对轻量、稳定且可信，当前版本收敛如下：

### 4.1 当前主干开放能力
- **物理拓扑与感知**：3D 六邻域（`±x, ±y, ±z`）邻居活跃度感知，环境主动读取（`environment_read`）；
- **心智自我演化**：元胞完全自主覆写与迭代自身记忆心智（`pixel.md`，上限 2000 字符）；
- **邻里协作与繁衍**：直接邻接空格无损复制子代（`reproduce`），邻居间消息定向通信与能量划转；
- **本地隔离交付物**：提供三项受限文件工具（`save_artifact`、`read_artifact`、`list_artifacts`），严格按元胞 ID 隔离并防范路径穿越；
- **真实闭环**：工具调用后由系统自动投递 `[ENGINE_FEEDBACK]` 回执消息，元胞在下一 Hop 可感知执行结果。

### 4.2 暂从主干断开的支线能力（代码保留，不阻塞主流程）
- **外部审批 (Owner Action)**：模型产生的 `owner_request` 自动归一化为非阻塞提示，不再生成阻断性审批单，不中断或停机 UI 运行；
- **Loop 快照分支历史**：运行脱离旧版 Loop 快照打包与分支树，状态由 `v9_core.sqlite3` 与 `live/` 文件系统权威保障；
- **宿主代码执行**：禁用任意命令与外部宿主环境脚本执行；
- **外部真实回款流**：不接入外部支付渠道，内部使用纯净能量与 Token 记账。
