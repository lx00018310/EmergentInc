[English](README.md) | 中文

# EmergentInc 元胞会社

**一个帮助每个人利用 AI 开启并运营线上生意的开源系统。**

你提供想法、资源和最终决策。EmergentInc 提供 AI 人物与元胞，帮助探索机会、构建产品、推广销售、服务客户，并在真实经营中持续进化。

- **用户：**部署 EmergentInc，建立自己的 AI 线上生意。
- **客户：**EmergentInc 本身也是一门生意，提供定制服务。
- **开发者：**EmergentInc 是开源项目。

## 一门生意，一个对外网站

| 地址 | 用途 |
| --- | --- |
| `/` | 无需 Owner 登录的商城、商品详情、下单与查单入口 |
| `/QIAN` | 内部人物、对话、World 与人物收入 |
| `/YUAN?world=<world_id>` | 内部元胞、Run、消息、交付物、Body 与协作 |
| `/GENE` | 内部经营、信任根、基因、进化、记忆、支付与 Public Site 设置 |

四个入口均支持英文与中文，首次访问默认英文，主动切换后保存到 localStorage。用户资料、对话与经营记录保持原文。

官网属于整个实例。所有人物与 World 服务于同一门生意，可用现有能力协作与分工。官网订单及收入归属实例，不随意挂到某个人物；旧 World 发票与收入保留原归属。

商城支持多个商品，初始展示两个空商品占位，名称、说明与价格留空、购买关闭。Owner 在 `/GENE` → 对外网站中逐个编辑中英文内容、价格与上下架，也可新增空商品。主页顶部“后台”要求输入 `.env` 中的 `EMERGENTINC_OWNER_SECRET`，通过服务端验证后进入 `/QIAN`；口令不会打包进前端。QIAN / YUAN / GENE 顶部均提供三个页面的切换入口。

## World、千机与元胞

千机是拥有稳定身份、人设与独立 World 的人物。一个 World 内可有多个元胞，其运行记录、消息与文件独立。入口元胞死亡后人物仍存在，Owner 可以更换为本 World 的活跃元胞。对话启动有限额度 Run，经 outbox 返回答复。

信任根、Genome 与 Evolution 全局共享。各 World 的 Current、Body 技能与账本独立，相同坐标不共享消息或文件。V23 旧会议历史归档保留；V24 不新增协作架构。

## Body、Gene 与进化

Body 技能在遗传权限内生成、测试和执行。最小契约 `pure-ast-json@1` 用 JSON 用例验证 JavaScript 函数，通过解释器执行；不使用 eval，不访问主机文件、凭据、网络、子进程或安装依赖。Body Revision 不形成新一代。

除可执行的 pure Skill 外，Pixel 还能按需加载基于 Markdown 的工作方法 Skill（`LIST_SKILLS` / `READ_SKILL`）；与可执行 Skill 不同，它们只是参考文档，不构成执行许可。

资产晋升冻结不可变快照，记录 World、元胞、代号与来源哈希。Owner 审查隐私、共享许可和通用性，批准的方向形成 Gene Patch。完整 release 必须通过类型检查、测试、构建和烟测，可信 Supervisor 才能接受**准确候选哈希**审批。

所有 World 准备好下一代 Current 后才切换全局指针。失败回退代码与投影；谱系、付款与失败事实保留。新 World 从 Gene 继承已晋升能力，不复制私有 Body 文件。

自进化受已验证契约和审批约束；Agent 不能编辑运行中的正式 Release，或悄悄增加任意依赖。

8766 升级页并排显示已批准版本谱系与本地 Git 提交图；可对可 fast-forward 的提交固定 SHA 准备候选，发布成功后安全同步 git `main`（绝不 rebase 或强推）。

## 订单与 USDT 收款

商城 → 选择已上架商品 → 客户信息 → Order → USDT Invoice / 二维码 → 现有监听 → 确认到账 → 订单已付款 → `/GENE` 可见实例收入。

先在 `/GENE` 启用收款 Rail。系统不提供默认商户地址，不保存钱包私钥、不签名、不转出资金。继续使用现有 Solana USDT、BSC Binance-Peg USDT、Polygon PoS USDT0、TRON TRC-20 USDT 主网实现。

Solana 用独立 Reference；其他链增加永久唯一的 0.000001–0.009999 USDT 尾数。必须支付**页面显示的完整金额**。TRON 二维码仅含收款地址，钱包中选择 TRC-20 USDT 并手动输入完整金额。到账遵循现有链终局和 Transfer 核验；迟到或取消后付款待审核，未确认观察不计收入。

公开购买用不可预测 token 查询付款状态，请保管返回的订单链接。公开接口仅暴露网站、商品与 token 授权的付款信息；其余 `/api/*` 需要 Owner 登录，已有 session/login 接口继续开放。

私有 RPC 环境变量：`EMERGENTINC_SOLANA_RPC_MAINNET`、`EMERGENTINC_SOLANA_WS_MAINNET`、`EMERGENTINC_BSC_RPC_MAINNET`、`EMERGENTINC_POLYGON_RPC_MAINNET`、`EMERGENTINC_TRON_RPC_MAINNET`、`EMERGENTINC_TRON_API_KEY`。凭据不进入公开响应或模型。

## 持久 Workspace

**代码可以变化，业务数据持续存在。**

```text
workspace/
  workspace-layout.json
  system/
    active-generation.json
    control/control.sqlite3       # 人物、World、网站、商品、订单
    payment/payment.sqlite3       # Rail、发票、回执、收入、outbox
    lineage/lineage.sqlite3        # 共享谱系、记忆与经营证据
    generations/Gxxxx/current.sqlite3
    evolution/{promotions,requests}/
    legacy/v22/{raw,snapshots}/
  worlds/<world_id>/
    world.json
    ledger/v9_core.sqlite3
    live/{pixels,artifacts,shared}/
    runtime/
    generations/Gxxxx/{current.sqlite3,body/skills}/
```

网站配置与订单使用现有 control 数据库，付款继续使用现有 payment 数据库。业务数据不存进前端源码、Git JSON 或 Release 目录。

## 启动与开发

使用 Node.js 24 与 pnpm，Windows 命令使用 `pnpm.cmd`。本机 `.env` 配置至少 32 个随机字符的 Owner 口令以及模型报价，凭据不入 Git。

```powershell
pnpm.cmd install --frozen-lockfile --ignore-scripts
pnpm.cmd typecheck
pnpm.cmd test --maxWorkers=4
pnpm.cmd --dir frontend build
node scripts/launch-approved.mjs --check
node scripts/launch-approved.mjs
```

`EmergentInc_UI.bat` 也可以启动批准版本。启动核对冻结代码、代号、Current、指针与 Owner 审批回执，编辑开发源码不会更新正式实例。

Windows 启动器会等待本次启动的进程就绪、首页正常响应后再打开网页。Linux 运行 `bash ./EmergentInc_UI.sh`，同样在前台启动；桌面会话使用 `xdg-open` 打开网页，无桌面会话则显示访问地址。先安装 Node.js 24 和 pnpm，并将 `.env` 与 Owner 发布配置中的路径改为 Linux 路径。这个本机启动器不替代生产 systemd 服务，也不迁移 Windows Workspace。

受控升级替换启动进程后，启动器核对切换记录、准确批准及新进程就绪状态，确认成功后显示交接提示。新服务独立运行，输出写入提示中的运行日志。普通崩溃仍返回错误。

日常升级使用独立网页 `http://127.0.0.1:8766/`。`EmergentInc_Upgrade.bat` 保留为可选的命令行查看版本、回退和恢复入口；网页升级服务不依赖这个批处理文件。

版本标签支持中文、空格和符号，最多 200 个字符。标签留空时自动生成时间标签，修改说明仍须填写。显示标签与系统生成的内部版本编号分别保存。

Owner 与 Agent 使用独立 branch / worktree。正式 Release 永远冻结，不修改 `/srv/emergentinc/current`，不在运行目录 `git pull`。测试与本地提交完成后再合并、审批发布。禁止多人同时直接编辑同一 working tree。

## 升级与回退

Linux 代码位于 `/srv/emergentinc/releases/<release_id>`，`current` 指向批准版本；数据位于 `/var/lib/emergentinc/workspace`，升级不得覆盖它。

顺序：类型检查 → 测试 → 前端构建 → 冻结候选 → 停机 → Workspace 备份 → 必要迁移 → 切换版本 → 启动 → 健康检查。失败回退代码，订单、付款、收入、记忆与谱系事实保留。

V22 Workspace 必须显式迁移至 V23：

```powershell
node scripts/v23-migration-dry-run.mjs <已停止的V22-workspace> <新备份目录>
node scripts/v23-upgrade.mjs prepare <V22-workspace> <已验证备份目录> <新的Owner目录>
node scripts/v23-upgrade.mjs approve <Owner目录> <准确候选哈希> "批准原因"
node scripts/v23-upgrade.mjs apply <Owner目录> <准确候选哈希>
```

V23 → V24 及保持此 Workspace 布局的后续软件版本，使用根目录 `EmergentInc_Upgrade.bat`：status / prepare / show / approve / apply / rollback / recover。完整命令和历史版本入口见 [版本升级入口](docs/版本升级入口.md)。World 的 Gene 变更仍使用 `scripts/v23-generation.mjs` 的 submit / validate / approve / birth，不能修改 Root。

Owner 软件维护保留未整理事实及快照，不调用模型或生成虚假 Dream。V24 出现实例发票后拒绝直接回退 V23；兼容性和验证证据见 [V24 实施记录](docs/EmergentInc_V24_实施记录.md)。

## 验证状态

V24 在准确 Release 获批且部署前仍是开发候选。本地测试使用隔离 Workspace 与模拟 RPC，不证明真实客户付款或 Linux 正式环境验收。部署与真实收款必须单独记录。

计划与历史：[V24 Plan](docs/EmergentInc%20V24%20产品化收口执行%20Plan.md)、[V23 实施记录](docs/EmergentInc_V23_实施记录.md)、[V22 整改记录](docs/EmergentInc_V22_整改实施记录.md)、[原始首发材料](docs/launch/README.md)。
