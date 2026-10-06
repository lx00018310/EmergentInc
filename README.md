# EmergentInc 元胞会社

EmergentInc 探索元胞在明确目标、预算与权限内协作、生长，并经人的批准把通用经验变成可遗传的基因。

当前执行依据是 [V23 世界化、基因晋升与链上支付 Plan](docs/EmergentInc_V23_世界化_基因晋升_链上支付_整改执行_PLAN.md)。V22 的受控升级与冻结发布机制保留；V23 实现和验收证据见 [V23 实施记录](docs/EmergentInc_V23_实施记录.md)。

**当前真实 workspace 仍运行已批准的 G0005。V23 开发代码和隔离副本正在验收；首次迁移须批准准确候选哈希。尚未确认任何真实链上付款，也未完成 Linux 实机验收。**

## 三个地址

| 地址 | 用途 |
| --- | --- |
| `/QIAN` | 千机阁：人物、招募、对话、所属 World、内部入口与人物收入 |
| `/YUAN?world=<world_id>` | 选定 World 的元胞、Run、消息、文件、协作与恢复操作 |
| `/GENE` | 全局生命管理、预算、方案、资料、资产晋升审查和收款 Rail |

默认进入千机阁，经营工作台只在 `/GENE`。Root、Genome、Evolution 在水下全局共享，日常产品导航不拆成多个技术层页面。

每个千机对应一个独立 World；World 内可以有多个 Pixel。不同 World 可以同时拥有 `0_0_0`，其数据库、消息和文件互不混用。千机身份不再等于入口 Pixel，入口死亡后人物仍存在，可由 Owner 更换为本 World 的另一个活跃 Pixel。聊天启动本 World 的有限额度 Run，经本 World outbox 返回答复。

V23 尚不启用 V22 的跨人物会议入口；旧会议、绑定、费用与运行历史保留在只读归档，不依据当前 binding 重新分配旧账。现有预算、方案与资料管理仍在全局 `/GENE`，CNY 手工经营凭据与 USDT 链上收入分别保留来源。

## 生命循环与遗传

一代由经批准且实际生效的 Gene 变化定义。Body 技能的生成、测试、激活及失败回退只影响本 World 的 Body Revision。

当前最小自主执行契约是 `pure-ast-json@1`：元胞可以生成真正的 JavaScript 函数、用 JSON 用例验证并运行；由 AST 解释器执行，不使用 eval/VM，不接触主机文件、凭据、网络、进程或依赖安装。支持受控表达式、分支与集合操作。它没有实现任意前端组件、后端源码或新依赖的自主修改。

晋升支持 knowledge、template、dataset、skill、code。文件提名立即冻结不可变快照，记录 World、Pixel、代号、来源哈希。Body Skill 还须有实际成功运行证据。Owner 审查隐私、共享许可与通用性；共享资产只在原 World 可读。随后形成 Gene 方向提案。

Owner 批准方向后，系统生成通用 Gene Patch；需要去个体化时使用已有、有限额度的模型授权，失败或未知费用不会偷偷重试。纯程序资产明确声明接口、测试、执行引擎和空外部权限。完整 release 经类型检查、测试、构建与既有/全新 World 烟测后，Owner 再批准**准确候选哈希**，由 Supervisor 换代。

所有 World 的下一代 Current 全部准备成功才切换唯一全局指针。任一失败整体回退。Lineage、真实付款与失败经历不回滚。后来出生且没有旧代 Current 的 World 被明确标记待恢复，保留所有文件，不伪造旧代状态。

真正遗传的验收条件是：全新 World 的 Body 目录为空，仍能从 Gene 调用已晋升能力并返回来源、版本和实现哈希。把私有 Body 复制到下一代只算身体延续。

## 数据布局

```text
workspace/
  workspace-layout.json
  system/
    active-generation.json
    lineage/lineage.sqlite3         # 全局谱系与经营事实
    control/control.sqlite3        # 人物、World 注册与对外对话投影
    payment/payment.sqlite3        # rail、invoice、观察、回执和收入 outbox
    generations/Gxxxx/current.sqlite3  # 管理投影，无 World 工作状态
    evolution/promotions/          # 不可变候选快照
    evolution/requests/            # 已批准方向生成的 GeneRequest
    legacy/v22/{raw,snapshots}/     # 原始字节与规范数据库，只读旧历史
  worlds/<world_id>/
    world.json
    ledger/v9_core.sqlite3
    live/{pixels,artifacts,shared}/
    runtime/
    generations/Gxxxx/{current.sqlite3,body/skills}/
```

control 为复用既有 Qianji repository 保留 Core 兼容空表，World 运行事实不写入这些表。每个 World 的 Current 才是其工作状态真值。旧人物、Pixel 文件、画像、Run、消息与账本保留；无归属证据的数据拒绝自动分配。

## 本机启动和升级

Windows，Node.js 24；命令使用 `pnpm.cmd`。配置根 `.env` 的 Owner 口令及模型，口令至少 32 个随机字符。不要把凭据写入仓库或发到聊天中。

```powershell
node scripts/launch-approved.mjs --check
node scripts/launch-approved.mjs
```

也可运行 `EmergentInc_UI.bat`。日常启动只选择匹配谱系、指针、Current 和 Owner 批准凭据的冻结版本。修改开发源码不会自动改变正在运行的代，也不能覆盖存储的 Gene Hash。新安装按 Genome 的 World 契约初始化 V23 空谱系；已有 V22 必须显式迁移。

首次 V23 升级先生成完整备份和独立副本，再执行：

```powershell
node scripts/v23-migration-dry-run.mjs <已停止的V22-workspace> <新备份目录>
node scripts/v23-upgrade.mjs prepare <V22-workspace> <已验证备份目录> <新的Owner目录>
node scripts/v23-upgrade.mjs approve <Owner目录> <准确候选哈希> "批准原因"
node scripts/v23-upgrade.mjs apply <Owner目录> <准确候选哈希>
```

prepare 在冻结候选内执行固定完整检查。apply 校验原数据未增加新事实；仅工作线程的临时租约行不属于业务事实，且切换前必须已释放。人物、账本、订单和运行记录仍逐表核对。保留原 workspace 目录作为回退备份，再启动新版验证；启动失败恢复旧实例并保留失败记忆。成功后在本机 `.env` 记录外部 Owner Supervisor 配置路径，后续正常启动继续核验可信凭据。首次候选变更或原业务数据改变必须重新演练与批准。

后续 GeneRequest 使用 Owner CLI：

```powershell
node scripts/v23-generation.mjs <owner-config.json> submit <request.json>
node scripts/v23-generation.mjs <owner-config.json> validate <候选ID>
node scripts/v23-generation.mjs <owner-config.json> approve <候选ID> <准确候选哈希>
node scripts/v23-generation.mjs <owner-config.json> birth <候选ID>
```

Root 审批状态、冻结 releases 与控制配置位于 World workspace 外。Windows 这是显式 Owner 维护模式，不能等同 Linux 的 OS 权限隔离。Linux Supervisor 继续使用独立安装、root 私有配置、无凭据/无网络的候选校验；V23 配置增加 `workspaceVersion: 23`，实机权限、切版及恢复仍须现场验收。

## 四链 USDT 收款

只支持主网 Solana USDT、BSC Binance-Peg USDT、Polygon PoS USDT0、TRON TRC-20 USDT。先在 `/GENE` 的四张配置表中填写公开收款地址并启用。没有默认商户地址，不保存私钥、不签名、不自动支出。停用地址可以离线保存；启用时核验 RPC 网络和代币精度。

每张发票冻结 World、千机、收款地址/合约/配置版本和实际应付金额。Solana 用 Solana Pay 独立 Reference；其他三条链在报价上加 `0.000001` 至 `0.009999` USDT 的唯一金额尾数，永久保留、过期也不复用。页面明确显示报价与实际应付金额，不省略小数位。EVM 使用 ERC-681；TRON 二维码只含收款地址，钱包中须选择 TRC-20 USDT 并输入完整应付金额。

确认标准：Solana finalized、BSC/Polygon 的 finalized 区块、TRON Solidity 固化数据。核对规范代币 Transfer、真实区块/交易、准确收款地址和金额后只记一次收入。迟到、取消后的付款待审核；未知金额仅列入未归属到账。RPC 故障保留补扫位置，不切换隐式节点。付款 Memory 的来源为 `chain_finalized`，原始代号不随重投改变。旧 USDC 数据只归档，不能重命名为 USDT 收入。

私有 RPC 可在本机环境变量 `EMERGENTINC_SOLANA_RPC_MAINNET`、`EMERGENTINC_BSC_RPC_MAINNET`、`EMERGENTINC_POLYGON_RPC_MAINNET`、`EMERGENTINC_TRON_RPC_MAINNET` 设置；Solana WebSocket 使用 `EMERGENTINC_SOLANA_WS_MAINNET`，TronGrid Key 使用 `EMERGENTINC_TRON_API_KEY`。凭据不返回前端、不进入模型。

合约来源：[Tether 官方](https://tether.to/en/supported-protocols/)、[BNB Chain 合约引用](https://docs.bnbchain.org/bnb-smart-chain/benchmark/design-reference/)、[Polygon USDT0 部署](https://docs.usdt0.to/technical-documentation/deployments)。核验标准：[ERC-20](https://eips.ethereum.org/EIPS/eip-20)、[TRON 钱包集成](https://developers.tron.network/docs/exchangewallet-integrate-with-the-tron-network)。

## 验证与限制

```powershell
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd --dir frontend build
```

自动测试覆盖 World 隔离、真实 scheduler/outbox/繁衍、快照/隐私/去个体化、Body 回退、各 World 部分迁移与整体恢复、空 World 遗传、付款归属/finality/重启去重。另有实际编译进程与 Supervisor 的换代/回退测试；其中模型为明确标注的零价格替身，付款单元测试使用模拟 RPC。

本地测试不是 Linux 实机验收，也不是实际收款证明。`/GENE` 完整工作台目前仍由主应用托管；独立 Recovery Host 保留只读诊断原型，尚无完整工作台的物理进程隔离。对明确的 World 数据故障，Root 页面继续提供诊断，ready 变为失败；不自动填补 Current 或跳过候选验收。

历史材料：[V22 整改记录](docs/EmergentInc_V22_整改实施记录.md)、[V22 最初实施记录](docs/EmergentInc_V22_实施记录.md)、[首发材料及原始产物](docs/launch/README.md)。它们记录对应时期的证据，不代表 V23 当前已上线或已经盈利。
