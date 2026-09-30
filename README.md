# EmergentInc 元胞会社

EmergentInc 探索 AI 元胞如何在明确目标、预算和权限内形成分工、执行任务、积累经验，并在人的参与下进化。

**产品正常使用只有一套前端、两个主要地址：千机阁 `/QIAN` 与元胞界面 `/YUAN`。** 经营、记忆和进化机制服务于这套界面。用户日常操作不需要进入另一套经营工作台或生命管理后台。

另设独立的 **`/GENE`** 管理与恢复入口。Owner 正常时可手动访问，Body 日常导航不列出；Body 前端或后端崩溃时，它仍应独立提供登录、诊断与恢复。唯一整改依据是 [V22 生命循环执行 Plan · 修订版](docs/EmergentInc_V22_生命循环执行_PLAN.md)，整改已开始，完整目标尚未实现。原 V22R 已合并。

![EmergentInc 概念图](Imag_EmergentInc.png)

## 产品边界：水上与水下

水上是身体层提供的产品界面：

- **`/QIAN` 千机阁**：人物、目标、经营关系和必要的人类决定的入口。招募、会议等作为其中的局部视图。
- **`/YUAN` 元胞界面**：元胞、任务、协作和交付结果的观察与操作入口。
- 登录、预算授权、方案确认和反馈应融入这两个入口，表达用户需要决定的事情。

水下是支撑身体运行的机制：

- **Root of Trust**：保护不可绕过的边界，验证准确候选，控制切版和恢复。
- **Genome**：身份、权限、基础接口、生命规则和可遗传的能力。
- **Body**：在基因边界内生长的技能、函数、界面和流程。
- **Current**：这一代正在使用的工作状态。
- **Memory / Lineage**：跨代经营事实、重要经历和经验。
- **Dream**：整理新事实、提炼记忆、形成等待人类决定的基因提案。

这些层不应变成日常导航中的一组技术管理页面。用户提出目标、授权资源、观察结果、纠正判断；系统在底层组合相应能力。

**Body 不能正常服务时，正常入口应明确指向独立 `/GENE`。** Owner 也可以在健康时直接打开它进行基因提案审批与管理。该入口不依赖 Body 的页面资源、登录或后端进程，并继续遵守可信审批边界。故障判定与独立运行尚未实现，不把任意业务错误都当成身体崩溃。

## 当前状态：V22 尚未达到上述产品边界

更新日期：2026-09-30。

当前代码已经实现部分生命循环基础设施，但前端、运行链和身体界面的边界仍未整改到位。不能把“自动测试通过”解释为产品目标已经完成。

修订计划已开始执行：完成只读数据盘点和副本迁移演练，新增独立 `/GENE` 登录与诊断服务的基础部分；当前只读，尚未接入恢复执行器、准确审批或统一 Body 入口。启动方式、验证证据和未完成项见 [V22 整改实施记录](docs/EmergentInc_V22_整改实施记录.md)。

| 项目 | 当前实现 | 与目标的差距 |
| --- | --- | --- |
| 产品入口 | `legacy` 模式显示千机阁和元胞界面；默认 `business` 模式显示独立经营工作台 | 两套运行链尚未统一，日常入口仍偏离目标 |
| 经营流程 | 已有预算授权、方案版本审批、任务、反馈、经营凭据和策略恢复 | 尚未融入 `/QIAN`、`/YUAN`；旧人物与新经营任务的关系尚未打通 |
| 身体生长 | 动态纯 JSON Skill 的候选、沙箱验证、自动激活和失败回退 | 尚未实现真实前端组件、后端业务和流程源码的自主修改；前端源码目前整体计入 Gene Hash |
| 生命数据 | 独立 Lineage DB、每代 Current DB、白名单部分迁移与 LifeContext | 生命周期能力目前接在 `business` 运行链上，尚未支撑统一产品界面 |
| Memory / Dream | 选择性记忆、每日/手动/Final Dream、增量游标和 Gene Proposal | 缺少系统自动生成 Gene Patch 与能力真正遗传的闭环；技术管理尚未沉入水下 |
| 出生与回退 | 独立 Supervisor 模板、准确 Hash 审批、候选双库烟测、切代和恢复 | Linux 实机验收未进行；身体界面溃败后显露基因恢复入口尚未实现 |

[修订版主 Plan](docs/EmergentInc_V22_生命循环执行_PLAN.md) 已纠正原版对 Body 和 Gene 自我迭代的收窄，保留现有基础设施，明确保留多 Pixel 主动 Run 与协作。原版计划可从提交 `21e2635` 追溯；该提交只增加计划，没有修改代码。实施记录继续描述实际做过的工程工作。

### 已验证的工程行为

本机 Windows、Node.js `v24.14.1`：65 个测试文件、457 个测试通过；类型检查与前端构建通过。已补充对指针权限设置、迁移早期中断、回退后的保存响应恢复、Body 资源接续及跨代关联的回归测试。

测试中的模型、沙箱执行和 Release 切换使用替身；候选服务器烟测使用真实编译后的本地进程。真实 Linux 权限、rootless 隔离、切版和端到端生命循环仍待验收。前端构建仍有大 chunk 提示。

工程证据和限制见 [V22 实施记录](docs/EmergentInc_V22_实施记录.md)。这些结果不证明真实经营成功，也不能据此宣布系统“已经活过一代”。

## 生命循环的基本规则

- **一代由 Gene 变化定义。** 经批准并实际发生的基因变化形成下一代；同代 Body 生长只增加 Body Revision。
- **身体可以自主修改自身代码。** 目标范围包括真实前端组件、后端业务、工具、函数和流程；在 Gene 的权限、接口和已有依赖环境内自动生成、测试、激活、回退，不逐次要求批准。当前代码仍只实现纯 JSON Skill。
- **多 Pixel 是运行核心。** 保留 Run、通信、协作、决策和效应链；经营目标与预算接入该链，不能以固定经营工作流取代元胞运行。
- **系统写 Gene 候选，人批准生效。** Pixel / Dream 使用“要点、原因、效果”提案；Owner 批准方向后，系统自动编写和验证 Patch，再由 Owner 在可信 `/GENE` 批准准确候选。当前自动编写链尚未实现。
- **进入 Gene 才算能力遗传。** 下一代新 Pixel 不复制原 Body 插件，也应能从 Gene 调用已提升的能力。兼容 Body 的跨代复制只算身体状态延续。
- **出生必须经过验证与接管。** 包括准确候选绑定、Final Dream、部分迁移、候选烟测、切版及正式健康检查。
- **身体可以回退，历史不能回退。** 代码、Skill 和 Current 可以恢复；已确认费用、订单、付款、记忆和代际历史保留在 Lineage。
- **未知结果不能自动重放。** 模型费用或外部动作结果未知时保留证据；费用核实且响应已保存时恢复原响应，不再次付费调用。

目标运行关系：

```text
用户
  │
  ├── /QIAN 千机阁
  └── /YUAN 元胞界面
          │
          ▼
     多 Pixel Run / 通信 / 协作 / 决策 / 效应
          │
          ├── Body 源码 → 隔离验证 → 同代激活 → 实际调用
          │
          └── Genome / LifeContext / Current
                   ├── MemoryGate / Dream → Lineage
                   └── Gene Proposal → Owner 批准方向
                          → 系统生成并验证 Gene Patch
                          → /GENE 批准准确候选 → 下一代

身体界面无法服务
  → 独立 /GENE 管理与恢复入口
  → 可信恢复
  → 回到正常产品界面
```

上图描述目标架构；当前分离模式尚未完成这条产品链。可变 Body 前端脚本与后端代码需分别隔离运行；`/GENE` 的认证、准确审批和恢复底座独立安装，不能依赖待恢复的 Body。详细故障和权限边界见主 Plan。

## 本机运行：当前的临时验证方式

以下说明当前代码如何启动。两种运行模式是现状，不能把切换模式当成完成产品整合。

### 环境与构建

本机验证使用 Node.js `v24.14.1`。项目为 TypeScript / Node.js / Fastify / SQLite / React / Vite；服务器不是 Python 或 FastAPI。

首次安装需使用 pnpm 工作区安装依赖：

```powershell
pnpm.cmd install --frozen-lockfile
```

本机依赖已安装时可直接构建：

```powershell
npm.cmd run build
npm.cmd --prefix frontend run build
```

### 本地配置

根目录 `.env` 不进入 Git。首次配置可从 [.env.example](.env.example) 复制；已有文件应保留现有配置。

至少设置：

```dotenv
EMERGENTINC_OWNER_SECRET=<至少32字符的随机口令>
HOST=127.0.0.1
EMERGENTINC_SECURE_COOKIES=0
```

随机口令可在本机生成，再填入 `.env`：

```powershell
node -p "require('node:crypto').randomBytes(32).toString('hex')"
```

`SECURE_COOKIES=0` 只用于本机 HTTP。对外访问须使用 HTTPS 和 Secure Cookie。环境变量优先于 `.env`；登录使用该实例的 Owner 口令。

### 查看现有千机阁与元胞界面

当前需在 `.env` 中显式设置：

```dotenv
EMERGENTINC_RUNTIME_MODE=legacy
```

停止当前服务后，重新运行：

```powershell
.\EmergentInc_UI.bat
```

该脚本先构建后端和前端，再启动服务器。登录后访问：

- 千机阁：`http://127.0.0.1:8765/QIAN`
- 元胞界面：`http://127.0.0.1:8765/YUAN`

这些页面是目标产品需要保留的入口。当前通过 `legacy` 才能显示，是待整改的实现限制。

### 验证当前 V22 基础设施

目前需设置：

```dotenv
EMERGENTINC_RUNTIME_MODE=business
```

重启后会进入现有经营工作台，可验证资料、预算、方案、结果和生命记录。该工作台是当前工程验证入口，需要将其有效功能融入两处正常产品界面。

`business` 模式只注册业务接口，不注册原 Run / 世界接口。仅修改浏览器地址不会切换运行链。切换模式须先停止服务，并处理在途请求；同一 workspace 使用进程锁防止重复启动。

本机可以检查页面、数据和业务流程；真实 Body 沙箱执行依赖 Linux rootless worker。Gene 出生与 Release 切换由已安装的可信 Supervisor 执行，网页不能绕过准确候选审批。

### 模型与费用

模型连接读取 `MCL_API_KEY`、`MCL_BASE_URL`、`MCL_DECISION_MODEL` 等配置。当前业务模式还需要管理员提供明确的模型报价，以及 Owner 的费用授权；仅填写 API Key 不代表已具备经营权限。

报价、资源连接、方案审批和费用核实的当前操作见 [业务模式指南](docs/guides/BUSINESS_GUIDE.md)。涉及付费模型或外部写入前，应核对实际授权与费用状态。

## 运行数据与迁移

代码、私有配置与运行数据分别管理。默认数据目录为 `workspace/`，可通过 `EMERGENTINC_WORKSPACE_ROOT` 指定独立目录。

```text
workspace/
├─ lineage/
│  └─ lineage.sqlite3             # 跨代业务事实、记忆、提案和代际历史
├─ generations/
│  └─ G0001/
│     ├─ current.sqlite3           # 当代工作状态
│     └─ body/skills/              # 当代动态技能
├─ active-generation.json          # 本机代际指针；生产指针由 root 在 workspace 外控制
├─ ledger/
│  ├─ v9_core.sqlite3              # 现有千机阁 / 元胞运行链的数据库
│  └─ business.sqlite3             # V21 原业务库；迁移后保留源库
├─ live/                           # 现有元胞、环境和交付物
├─ runtime/                        # 进程锁等运行状态
└─ private/                        # 凭据、业务报价和私有配置
```

现有千机阁人物与 Run 没有自动迁入新生命循环。切换模式不会合并这两套数据库，也不会让旧授权成为新业务授权。

V21 业务数据通过显式离线工具迁移：先停止服务、检查完整性，再做 SQLite online backup、核对表与记录，添加生命表并建立 G0001。保留原 `business.sqlite3`。迁移命令和证据见 [实施记录](docs/EmergentInc_V22_实施记录.md)。

Genome Hash 绑定当前受保护内容。已有代遇到源码变化会拒绝静默更新；开发验证使用独立 workspace，正式基因变更走候选审批流程。不要把修改数据库中的 hash 当成升级。

Windows 本机已有数据遇到 `ACTIVE_GENOME_MISMATCH` 时，可由 Owner 显式执行候选准备、准确 Hash 批准和受控启动；本次已验证 G0001 → G0002，保留人物与 Run 历史。入口是 `scripts/local-upgrade.mjs`，适用条件、备份、恢复和操作顺序见 [本机升级记录](docs/EmergentInc_V22_整改实施记录.md#本机受控升级与启动恢复)。它不由启动脚本自动运行，也不替代 Linux 已安装的可信 Supervisor。

## 代码与维护入口

| 路径 | 职责 |
| --- | --- |
| `frontend/src/App.tsx` | 现有 `/QIAN`、`/YUAN` 路由及局部视图 |
| `frontend/src/OwnerEntry.tsx` | 登录与当前按运行模式选择界面 |
| `frontend/src/features/business/` | 当前独立业务与生命验证界面，待融入正常产品入口 |
| `apps/server/` | Fastify API、业务服务、现有世界运行服务与生命周期装配 |
| `genome/manifest.json` | 受保护路径与能力契约 |
| `packages/protocol/` | 数据契约、权限与状态规则 |
| `packages/persistence/` | 现有数据库、Lineage / Current 与迁移 |
| `packages/model/` | 模型适配与用量计量 |
| `packages/tools/` | 现有工具与受限 Body 沙箱接口 |
| `packages/runtime/`、`packages/domain/` | 现有元胞调度、决策、效应与领域规则 |
| `supervisor/` | 可信出生 / 回退实现的安装模板 |
| `scripts/` | 迁移、维护和可信启动工具 |
| `deploy/linux/` | 权限、服务及隔离部署模板 |

仓库中的 Supervisor 模板不等于已经安装的信任根。应用不能写入可信安装、直接切换 Release，或借 Body 修改权限、依赖与数据库规则。

验证命令：

```powershell
npm.cmd run typecheck
npm.cmd test -- --reporter=dot --maxWorkers=4
npm.cmd --prefix frontend run build
```

## 待完成的产品验收

1. 同一次启动即可使用 `/QIAN`、`/YUAN`，保留至少两个真实 Pixel 的自主 Run、消息与协作；目标、预算、方案与交付融入该链。
2. 系统自动修改真实前端组件和后端 Body 能力，经过独立测试后激活并实际使用；同代更新不改变 Gene Hash。
3. 技术管理沉入水下；独立 `/GENE` 健康时可手动访问，Body 前端损坏或后端被终止时仍可登录、诊断、审批和恢复。
4. Dream 提案、Owner 批准方向、系统生成并验证 Gene Patch、Owner 批准准确候选、下一代接管，全链不依赖人手写 Patch。
5. 新代新 Pixel 在未复制原 Body 插件时从 Gene 调用已提升能力，证明真正遗传；再验证失败出生恢复且 Lineage 事实不丢失。
6. 完成真实 Linux 权限、rootless 隔离、实际生成代码执行与切代验收。该项当前暂缓，本机替身测试不冒充实机通过。

历史首发材料见 [首发来源记录](docs/launch/README.md) 与 [首发尝试记录](docs/cases/first-customer.md)。其中的商品、发布和经营状态属于对应日期的历史记录，不代表当前产品已完成、当前服务仍可用或已有新的收入证明。
