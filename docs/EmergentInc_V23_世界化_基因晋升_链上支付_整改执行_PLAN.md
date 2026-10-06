# EmergentInc V23 整改执行 Plan
## 千机世界化 + Body→Gene 公共遗传 + 四链 USDT 收款闭环

> 仓库：`lx00018310/EmergentInc`  
> 审阅基线：`db73e0f31b675b578d7ffa566c94d4f772d340bc`  
> 日期：2026-10-01  
> 执行者：本地 Codex / AI  
> 核心原则：本次允许架构明显扩展，以先实现目标能力为优先；但必须分阶段、可回滚、保留现有数据与 V22 信任根，禁止一次性推翻后重写。

---

# 0. V23 最终要形成什么

V23 不再把“千机”理解成一个 Pixel。

新的核心模型固定为：

```text
EmergentInc
│
├─ L1 Root of Trust                全局唯一
│
├─ L2 Genome                       全局共享
│
├─ L3 Evolution                    全局共享
│
└─ L4 Body
    │
    ├─ Qianji A
    │   └─ World A
    │       ├─ Pixel 0_0_0
    │       ├─ Pixel 1_0_0
    │       ├─ Pixel ...
    │       └─ 可继续繁衍
    │
    ├─ Qianji B
    │   └─ World B
    │       └─ N Pixels
    │
    └─ Qianji C
        └─ World C
            └─ N Pixels
```

固定语义：

1. **千机 = 对外人格 / 世界入口。**
2. **一个千机当前只拥有一个 World。**
3. **一个 World 内拥有 0~N 个 Pixel；Pixel ID 只在本 World 内唯一。**
4. **Pixel 可以繁衍、协作、死亡、积累资料和能力，但外部用户不直接面对 Pixel。**
5. **外部聊天、任务、订单、收入首先归属 Qianji / World，再由 World 内部自行调度 Pixel。**
6. **Root / Genome / Evolution 不复制到每个千机；它们属于整个 EmergentInc。**
7. **每个 World 只拥有自己的 Body 状态和历史。**
8. **所有 World 共享当前 Genome 和当前 Generation。**
9. **World 内产生的优秀知识、技能、程序、代码、规则、可公开数据，可经过“晋升”进入全局 Genome。**
10. **一旦进入 Genome，它就不再属于某一个 Pixel，而成为后续所有 World 可以继承的公共能力。**

一句话：

> **Genome 是物种，Qianji World 是个体，Pixel 是个体内部可繁衍的智能细胞。**

---

# 1. 当前 V22 与目标之间的真实差距

当前代码基线已经具备：

- `qianji_profiles`
- `qianji_bindings`
- Pixel / Run / Message / Effect / Reproduce
- `LifeContext`
- `LineageStore`
- `CurrentStore`
- `DreamService`
- `MemoryGate`
- `BodyGrowthService`
- `GenerationSupervisor`
- `/GENE` 四层页面
- Business Order / Payment Evidence
- V22 冻结发布、Gene Hash、出生、失败拒绝和回退基础

但存在四个核心结构差距。

## 1.1 Qianji 仍是 1:1 Pixel 身份壳

当前：

```text
Qianji
  ↓ qianji_bindings
Pixel
```

数据库还存在：

```text
一个 Qianji 当前只能绑定一个 Pixel
一个 Pixel 当前只能绑定一个 Qianji
```

V23 必须改为：

```text
Qianji
  ↓
World
  ↓
N Pixels
```

`qianji_bindings` 不再作为当前身份核心，只保留旧历史兼容。

---

## 1.2 当前只有一个 World 命名空间

当前 `pixel_id = x_y_z`，例如：

```text
0_0_0
1_0_0
0_1_0
```

如果多个世界共用同一 DB / live 目录，所有 World 都需要 `0_0_0`，必然冲突。

因此 V23 不采用“大表全部增加 world_id + 组合主键”的路线。

固定采用：

> **每个 Qianji World 拥有独立 runtime workspace。**

这样现有 Pixel、Topology、Reproduce、Message、Effect 等代码可以最大程度复用。

---

## 1.3 当前“Body 跨代携带”不等于“公共基因”

当前 `migrateCurrentState()` 会迁移：

- carry_forward working state
- carry_forward objective
- carry_forward body need
- 已激活 body skill / candidate

这是：

> **同一 Body 状态跨代保存。**

不是：

> **某一个 Pixel / World 的优秀能力成为全体世界共同 Genome。**

V23 必须新增独立的 **Gene Promotion Pipeline**。

---

## 1.4 当前支付仍是人工付款证据

当前：

```text
business_orders
business_payment_events
source = owner_confirmed
currency = CNY
providerVerificationAvailable = false
```

V23 要新增真实链路：

```text
Invoice
→ Solana Pay QR
→ USDT Transfer
→ Chain Monitor
→ Finalized
→ World Revenue
→ Memory / Business Outcome
```

服务器只监控钱包，不保存私钥。

---

# 2. V23 固定目录结构

最终目标：

```text
workspace/
│
├─ system/
│   ├─ active-generation.json
│   ├─ lineage/
│   │   └─ lineage.sqlite3
│   ├─ control/
│   │   └─ control.sqlite3
│   └─ payment/
│       └─ payment.sqlite3
│
├─ worlds/
│   ├─ world_<idA>/
│   │   ├─ world.json
│   │   ├─ live/
│   │   │   ├─ world_state.json
│   │   │   ├─ environment.md
│   │   │   ├─ pixels/
│   │   │   │   ├─ 0_0_0/
│   │   │   │   └─ ...
│   │   │   └─ artifacts/
│   │   └─ generations/
│   │       └─ G0005/
│   │           ├─ current.sqlite3
│   │           └─ body/
│   │               └─ skills/
│   │
│   └─ world_<idB>/
│       └─ ...
│
└─ migration/
    └─ v23/
```

Release 源码仍放现有受信发布目录，不移动到普通 Body workspace。

---

# 3. 三个数据库职责必须拆清楚

## 3.1 control.sqlite3：谁是谁

只保存全局控制面关系：

```text
qianji_profiles
qianji_worlds
qianji_chat_turns
world_registry
world_gateway_state
```

核心新表：

```text
qianji_worlds
- world_id PK
- qianji_id UNIQUE
- status
- workspace_relpath
- gateway_pixel_id nullable
- created_at
- archived_at nullable
```

约束：

- 一个 Qianji 当前一个 World。
- World 内不保存另一个 Qianji。
- Qianji 身份和 World 生命周期不依赖某个 Pixel 是否死亡。

---

## 3.2 每个 World 自己的运行 DB

每个 World 继续使用现有 CoreStore 模型：

```text
pixel_accounts
runs
messages
effects
ledger_entries
model_calls
tool_executions
executions
...
```

Pixel ID 保持原格式：

```text
0_0_0
1_0_0
...
```

不增加全仓 `world_id + pixel_id` 组合键。

World 隔离由 workspace 和 DB 边界保证。

---

## 3.3 global lineage：整个物种的生命史

保留并扩展：

```text
generations
memories
dream_runs
gene_proposals
life_events
```

增加：

```text
gene_promotion_candidates
gene_assets
gene_asset_sources
gene_asset_versions
```

所有全球进化事实必须可追溯到：

```text
world_id?
pixel_id?
source type
source ref
content hash
generation
```

---

# 4. Qianji World 的运行机制

## 4.1 创建人物 = 创建世界

未来新建 Qianji：

```text
Create Qianji
↓
Create world_id
↓
创建独立 world workspace
↓
创建 G 当前代 CurrentStore
↓
创建 Genesis Pixel 0_0_0
↓
gateway_pixel_id = 0_0_0
↓
Qianji ACTIVE
```

失败必须整体回滚，禁止出现：

```text
有 Qianji，没有 World
```

或者：

```text
有 World，没有 Qianji
```

---

## 4.2 千机不是 gateway Pixel

V23 第一版允许使用：

```text
gateway_pixel_id
```

作为外部消息进入世界的默认入口。

但必须明确：

> gateway Pixel 只是“门”，不是人物身份。

因此：

- gateway Pixel 可以被替换。
- gateway Pixel 可以死亡后重建。
- Qianji 的名字、人格、历史、收入不会随 gateway Pixel 消失。
- `qianji_chat_turns` 不再绑定 `binding_id`。
- 新聊天记录至少包含：

```text
turn_id
qianji_id
world_id
request
reply
entry_pixel_id
run_id
created_at
```

---

## 4.3 外部只面对 Qianji

外部输入：

```text
User
↓
Qianji
↓
World Gateway
↓
World 内 Pixel 协作
↓
World Outbox
↓
Qianji Reply
```

V23 不要求立即做复杂“多 Pixel 投票决定回复”。

第一版：

1. gateway Pixel 接收外部任务；
2. 它可以正常向邻居发送消息、繁衍、调用已有机制；
3. 最终通过 World Outbox 产生一个对外答复；
4. Qianji UI 只展示该答复。

未来可以替换 world 内的组织方式，但不改变 Qianji↔World 契约。

---

# 5. 四层架构在 V23 中的最终职责

## L1 Root of Trust：全局唯一

负责：

- Owner 最终批准。
- 发布候选 Hash 审批。
- Recovery。
- 钱包收款地址变更批准。
- Chain / Token allowlist。
- RPC Secret 读取边界。
- 禁止 Body 改 Root。
- 禁止 LLM 获得私钥/助记词。

Root 不属于任何 World。

---

## L2 Genome：全局公共遗传物

Genome 不只是代码 Hash。

V23 后 Genome 应包含两部分：

```text
A. Engine Gene
- packages
- apps
- frontend
- protocol
- tool contracts
- runtime rules

B. Gene Assets
- 公共知识
- 公共模板
- 公共规则
- 公共数据定义
- 公共技能
- 公共程序
- 公共工具
```

建议目录：

```text
genome/
├─ manifest.json
└─ assets/
    ├─ knowledge/
    ├─ templates/
    ├─ datasets/
    ├─ skills/
    └─ policies/
```

`gene_hash` 必须覆盖会影响真实遗传行为的 Gene Asset。

---

## L3 Evolution：决定什么值得成为基因

负责：

```text
World Body Facts
↓
Memory
↓
Gene Nomination
↓
Promotion Candidate
↓
Owner Direction Approval
↓
Exact Gene Candidate
↓
Validation
↓
Owner Candidate Hash Approval
↓
Birth
```

Evolution 是：

> **个体经验进入物种遗传的筛选器。**

---

## L4 Body：每个 Qianji World 自己活

每个 World Body 拥有：

- N Pixels
- pixel.md
- tips.md
- artifacts
- local datasets
- Body Skills
- working state
- messages
- missions
- products
- local experience

默认全部：

> **World 私有，不自动成为 Genome。**

---

# 6. V23 最重要部分：Body → Gene 晋升机制

这是本版本必须真正做出来的核心。

## 6.1 四级资产状态

任何 Pixel 产生的东西都先属于 Body。

固定状态：

```text
BODY_PRIVATE
    ↓
WORLD_SHARED
    ↓
GENE_CANDIDATE
    ↓
GENE
```

含义：

### BODY_PRIVATE
只属于一个 Pixel。

例如：

```text
临时草稿
客户原始资料
个人工作记录
调试代码
未验证技能
```

### WORLD_SHARED
整个 Qianji World 可以用。

例如：

```text
内部 SOP
World 共用模板
已验证本地技能
World 数据集
```

仍然不进入其他 World。

### GENE_CANDIDATE
认为值得让所有 World 继承，但尚未成为基因。

必须被冻结成不可变候选快照。

### GENE
经过完整进化审批，进入下一代 Genome。

---

# 6.2 哪些东西可以申请晋升

固定支持五类：

```text
knowledge
template
dataset
skill
code
```

### knowledge
Markdown / JSON 知识。

### template
可复用提示结构、业务模板、任务模板。

### dataset
只允许：

- 公共数据；
- 人工明确授权共享的数据；
- 已脱敏/聚合的数据。

禁止默认晋升：

- 客户原始数据；
- 身份信息；
- Token / Cookie；
- 私钥；
- 聊天原文；
- 未确认版权来源的大型数据。

### skill
当前 Body Skill 或可执行能力。

### code
经过实战证明有价值的代码/程序。

进入 Gene 后不能简单复制一份“某 Pixel 的临时代码”，必须变成：

```text
稳定接口
+
测试
+
权限声明
+
通用化实现
```

---

# 6.3 Gene Promotion Candidate 数据结构

新增：

```text
gene_promotion_candidates
```

建议字段：

```text
id
generation_id
world_id
pixel_id nullable

asset_type
source_kind
source_ref

source_hash
snapshot_path
snapshot_hash

title
point
reason
effect

visibility
sensitivity
license_status
genericity_status
validation_status

state
created_at
```

状态：

```text
NOMINATED
SNAPSHOTTED
REJECTED_POLICY
READY_FOR_PROPOSAL
PROPOSED
APPROVED_DIRECTION
IMPLEMENTING
CANDIDATE_READY
PROMOTED
REJECTED
```

这里保存的是：

> **“到底是哪一个东西准备进入基因”**

而现有 `gene_proposals` 保存：

> **“为什么我们要改变基因”**

两者不能继续混为一个表。

---

# 6.4 Pixel 如何提出晋升

增加一个受限 Effect / Service：

```text
NOMINATE_GENE_ASSET
```

输入只能是：

```text
source_ref
asset_type
point
reason
effect
```

Pixel 不允许：

```text
直接指定 genome 写入路径
直接改 manifest
直接改 packages
直接把整个 workspace 打包
```

系统根据 `source_ref` 从本 World 读取候选资产并创建只读 Snapshot。

---

# 6.5 Snapshot 是关键安全边界

申请晋升时必须立刻冻结：

```text
内容
Hash
来源 World
来源 Pixel
Generation
时间
```

以后 Dream、AI、Owner、Codex 看到的都是 Snapshot。

原 Body 后续继续修改，不得改变已经提交的候选。

建议位置：

```text
workspace/system/promotion/<candidate_id>/
```

不允许符号链接逃逸。

---

# 6.6 晋升前自动过滤

固定检查：

### 安全检查

禁止包含：

```text
private key
seed phrase
API secret
token
cookie
.env
pem/key
credential
绝对宿主路径
workspace 外部符号链接
```

### 隐私检查

默认拒绝：

```text
客户个人数据
原始聊天全文
付款人的隐私身份数据
未明确授权的文件
```

### 通用性检查

必须回答：

```text
这个东西是否只对 World A 有效？
删除 World A 的名字、路径、ID 后还能不能使用？
新 World 是否能理解和调用？
```

### 价值证据

至少有一个：

```text
实际成功运行
真实交付
重复使用
真实付款相关结果
Owner 指定
多个 World 独立出现相同 Need
```

没有证据：

```text
可以成为 Memory
但不直接成为 Gene Candidate
```

---

# 6.7 不同资产的晋升方式

## A. 文档 / 知识

Body：

```text
worlds/A/live/artifacts/x.md
```

晋升后：

```text
genome/assets/knowledge/<asset_id>/content.md
genome/assets/knowledge/<asset_id>/manifest.json
```

manifest 保存：

```text
source_hash
version
origin worlds
purpose
license
tests/evidence
```

---

## B. 数据

不直接把 Body SQLite / 客户库变成 Gene。

只允许生成：

```text
schema
公共样本
聚合数据
脱敏快照
可重复构建脚本
```

如果真实数据不断变化：

> Genome 保存“数据定义/获取方式/处理规则”，而不是把动态业务数据硬编码进 Gene。

---

## C. Body Skill

当前 Body Skill 已有：

```text
candidate_json
tests
validation
body_interface_version
```

这是很好的晋升入口。

新增：

```text
PROMOTE_BODY_SKILL
```

流程：

```text
ACTIVE Body Skill
↓
使用次数 / 成功证据
↓
Snapshot
↓
Gene Promotion Candidate
↓
转换为 Gene Skill
↓
放入 genome/assets/skills 或正式 packages/tool
↓
全 release test
↓
出生
```

新一代验证必须证明：

```text
删除原 World 的 Body Skill 副本
↓
创建一个全新 World
↓
它仍能通过 Genome 调用该能力
```

只有通过这个测试，才叫：

> **真正遗传成功。**

---

## D. 程序 / 代码

不能把任意 Pixel 生成代码直接写进源码。

固定流程：

```text
Body code artifact
↓
Snapshot
↓
AI/Codex Generalizer
↓
Gene Patch
↓
typecheck
↓
tests
↓
build
↓
security boundary
↓
candidate hash
↓
Owner approval
```

当前 `GenerationSupervisor` 和 `ReleaseBuilder` 继续承担最后的可信发布。

---

# 6.8 Gene 不是“复制”，而是“去个体化”

晋升时必须执行一个重要过程：

> **Generalization / 去个体化**

例如 World A 产生：

```text
“帮张三统计 2026 年湖州门店 Excel”
```

不能作为 Genome。

应该提炼为：

```text
“表格字段完整性 + 重复行 + 数值汇总能力”
```

Gene 保存的是：

> 可跨 World 重复使用的抽象能力。

---

# 6.9 Gene Asset 必须保留来源谱系

一个 Gene 可能来自多个 World。

例如：

```text
World A 产生 Skill X
World B 也产生类似 Skill
World C 再次提出同 Need
```

`gene_asset_sources`：

```text
gene_asset_id
world_id
pixel_id
promotion_candidate_id
source_hash
evidence_ref
```

这样 `/GENE` 可以真实显示：

```text
该基因最早来自 World A / Pixel ...
后来被 3 个世界验证
G0007 正式进入 Genome
```

这就是 EmergentInc 真正的“物种经验积累”。

---

# 7. Dream 在 V23 中的变化

当前 Dream 已经可以：

```text
事实
→ Memory
→ Gene Proposal
```

保留这一思想，但数据源改成跨 World。

V23 全局 Dream 输入：

```text
world life events
promotion nominations
body skill evidence
business outcomes
payment confirmed
generation events
security boundary
owner correction
```

每条必须带：

```text
world_id
pixel_id?
generation_id
source_ref
```

Dream 可以：

```text
产生 Memory
建议 Gene Proposal
建议把某个 Promotion Candidate 提交审核
```

但 Dream 不能：

```text
直接把 Body 文件写进 Genome
直接批准 Gene
直接修改 Root
```

---

# 8. 多 World 的 Generation 出生机制

这是 V23 第二个重要难点。

当前一个 Generation 只有一个 `CurrentStore`。

V23 改成：

```text
Global Generation G0006
│
├─ World A / G0006 / current.sqlite3
├─ World B / G0006 / current.sqlite3
└─ World C / G0006 / current.sqlite3
```

Generation Supervisor 出生流程固定为：

```text
1. Quiesce 所有 World
2. Final Dream
3. 冻结当前 World 列表
4. 构建 Gene Candidate Release
5. 对每个 World 创建 next CurrentStore
6. migrateCurrentState(world)
7. 迁移/验证 Body Skills
8. 对候选 Release 跑 typecheck/test/build
9. 对全新空 World 跑 inheritance smoke
10. 对现有 World 跑最小 smoke
11. 全部成功
12. Owner 批准 candidate hash
13. 原子切 active-generation + release
14. 启动所有 World
15. 健康检查
16. 失败则整体恢复旧 Generation
```

原则：

> **任何一个 World 的迁移失败，都不能悄悄丢掉该 World 再继续出生。**

V23 阶段先采用 all-or-nothing。

以后 World 数量巨大时再设计分批迁移。

---

# 9. Body Skill 的两种跨代路径必须区分

V23 以后必须有两个完全不同的概念。

## 路径 A：Carry Forward

```text
World A 的 Skill
G0005
↓
G0006
```

仍只属于 World A。

这是个体记忆。

---

## 路径 B：Gene Promotion

```text
World A 的 Skill
↓
Promotion
↓
Genome
↓
G0006
↓
World A / B / C / 新 World 都可使用
```

这是物种遗传。

UI、数据库和代码中不得再把这两种行为都称为“继承”。

---

# 10. 四链 USDT 收款架构（2026-10-06 Owner 修订）

Owner 已明确：只收 USDT，支持 Solana、BSC/BEP-20、Polygon PoS、TRON/TRC-20；收款地址在 `/GENE` 分链输入设置，不要求实施前提供地址。原单链 USDC 目标被此要求替代，已存在的 USDC 事实只作归档，不转换、不删除。

## 10.1 合约与安全边界

- Solana：Tether 官方 USDT，6 位精度；独立 Reference + Memo。
- BSC：规范 Binance-Peg USDT 合约，18 位精度；chainId 56。
- Polygon PoS：原 USDT 地址上的 USDT0，6 位精度；chainId 137。
- TRON：Tether 官方 TRC-20 USDT，6 位精度；主网 Genesis 固定。
- 页面标清链与实际代币名称。不能使用代币 symbol 识别币种，按受信合约白名单核验。
- 仅设置公开收款地址；RPC/API Key 位于服务环境，不进入 Prompt、日志、Git。没有私钥、资金签名或转出能力。

## 10.2 Owner 选择的自动归属方式

Solana 延用 Solana Pay Reference。其他三链普通 Transfer 不带订单编号，Owner 已选择唯一金额尾数自动匹配：报价 10 USDT，首张可能应付 10.000001 USDT。尾数增量上限 0.009999 USDT，页面明确显示实际应付值。

唯一性绑定 chain + network + 合约 + 收款地址 + 原子金额，并覆盖所有历史状态。取消、过期和更改配置都不释放原金额，防止迟到付款错配。达到有限尾数容量时明确拒绝创建，不猜测归属。金额使用字符串与整数，BSC 18 位精度不经过浮点。

## 10.3 发票、监控、收入

全局 payment DB 保存配置修订、冻结发票、观察、回执、扫描游标、未归属到账与跨库 outbox。Receipt 的 chain/transaction/log index 防止跨链混淆和重复记账。发票固定 World / Qianji，工具不能指定其他 World。

- Solana：Reference 分页补扫和 WS 提示；confirmed 只观察，finalized 验证经典 Token Transfer、ATA、Mint、Memo、准确净收入。
- BSC / Polygon：按收款地址及规范合约分批读取 finalized 区块日志，再读取 receipt 和真实区块验证。失败不推进游标。
- TRON：分页读取已确认 TRC-20 历史，再用 Solidity 交易信息和区块验证，完成后重放历史以捕捉索引延迟。重复数据不重复记账。
- 错链、假币、错误收款地址、自转账、失败或不确定交易不能记收入。
- 正确但迟到、取消或日期不明的付款留待审核；未知金额不猜 World。
- Finalized 回执固定原始 Generation，经 outbox 产生 World 范围内 Memory / life event，重启换代重投仍去重。
- EVM 二维码为 ERC-681；TRON 二维码为公开地址，页面显示链、币种及精确应付金额，不声称支持未实现的钱包 URI。

## 10.4 页面与 World 工具

`/GENE` 提供四条链各自的地址输入、保存、启用/停用、配置版本、发票和未归属到账。`/QIAN` 显示 USDT 已核验收入。World 通过 `LIST_PAYMENT_RAILS` 读取公开可用配置，`CREATE_PAYMENT_INVOICE` 只为自身 World 开票。旧 CNY 和旧 USDC 不混入新 USDT 收入。

---

# 11. V23 API 目标

## Qianji / World

```text
POST /api/qianji
GET  /api/qianji
GET  /api/qianji/:id

GET  /api/qianji/:id/world
GET  /api/worlds/:worldId
GET  /api/worlds/:worldId/pixels
POST /api/qianji/:id/chat
```

不再要求调用者知道绑定 Pixel。

---

## Gene Promotion

```text
POST /api/worlds/:worldId/gene-nominations
GET  /api/evolution/promotions
GET  /api/evolution/promotions/:id
POST /api/evolution/promotions/:id/propose
```

Owner 最终审批仍走受信 `/GENE`。

普通 Body API 不提供：

```text
approve
write genome
switch generation
```

---

## Payment

```text
GET  /api/payments/rails
POST /api/payments/invoices
GET  /api/payments/invoices/:id
GET  /api/payments/invoices/:id/qr
GET  /api/payments/invoices/:id/status
```

Rail 修改走 `/GENE` Owner 控制面，不暴露为 Pixel Tool。

---

# 12. 前端改造

## /QIAN

大厅保持“人物”视角。

卡片显示：

```text
Qianji
World 状态
Pixel 数量
Generation
最近活动
收入
```

点击人物：

```text
人格
聊天
世界概览
Pixel 群落
任务
收入
历史
```

用户默认不需要理解某一个 Pixel 正在充当人物。

---

## /YUAN

改成：

> 当前选中 Qianji World 的 Body 显微镜。

页面顶部必须明确：

```text
Qianji: ...
World: ...
Generation: ...
Pixels: N
```

支持 World 切换。

---

## /GENE

继续是全局控制台。

四层显示：

```text
L1 Root
全局

L2 Genome
全局

L3 Evolution
来自所有 World 的进化输入

L4 Body
按 World 汇总
```

新增：

```text
Gene Promotion Candidates
Gene Assets
Origin Worlds
Payment Rail
Chain Monitor Health
```

---

# 13. V23 分阶段执行

本地 AI 必须按阶段执行。未明确要求继续时，每阶段完成后停止并报告。

---

# Stage 0：冻结基线与迁移演练

目标：

> 在不改变现有行为前，先建立 V23 可迁移边界。

任务：

1. 记录 commit `db73e0f3...`。
2. 完整备份现有：
   - core DB
   - lineage DB
   - generation DB
   - live/pixels
   - qianji profiles/bindings
   - business/payment evidence
3. 建立 `V23 migration dry-run`。
4. 输出：
   - Qianji 数
   - 当前 binding
   - Pixel 数
   - orphan Pixel
   - active generation
   - body skill
   - payment evidence
5. 不修改真实 workspace。
6. 增加回归测试锁定 V22 关键事实。

验收：

```text
迁移前后仅 dry-run
任何真实文件 Hash 不变化
```

---

# Stage 1：Qianji World 化

目标：

> 去掉 Qianji = Pixel 的核心假设。

任务：

1. 新增 `WorldRegistry`。
2. 新增 `qianji_worlds`。
3. 创建 `WorldRuntimeManager`：
   - open(worldId)
   - close(worldId)
   - list()
   - quiesceAll()
4. 每 World 独立：
   - live/
   - CoreStore
   - RunService
   - WorldService
5. Qianji 新建同时创建 World。
6. 旧 `qianji_bindings`：
   - 不删除；
   - 标为 legacy history；
   - 新逻辑不再依赖 current binding。
7. 迁移现有人物：
   - 每个现有 Qianji 创建一个 World；
   - 原绑定 Pixel 移入该 World；
   - 当前绑定 Pixel 作为 gateway Pixel；
   - 保留原 Pixel 文件和历史。
8. 无法确定归属的 Pixel：
   - dry-run 报告；
   - 不自动猜测；
   - 可放 legacy-world 前必须有明确迁移规则。

验收：

```text
每个现有 Qianji = 1 World
每个 World = 独立 0_0_0 命名空间
两个 World 可以同时存在 0_0_0
原 Pixel 内容 Hash 不变
```

---

# Stage 2：Qianji 世界入口

目标：

> 用户只对接 Qianji，不对接 Pixel。

任务：

1. 改 `qianji_chat_turns`：
   - 新增 world_id
   - binding_id 只保留 legacy nullable
2. Qianji Chat：
   - 找 world
   - 找 gateway pixel
   - 启动该 world run
   - 收集 world outbox
3. 增加 World Outbox。
4. gateway pixel 可替换，不影响 Qianji ID。
5. QIAN 页面不再把 Pixel 身份显示成人物身份。
6. YUAN 支持选 World。

验收：

```text
Qianji A 与 B 都有各自 0_0_0
聊天不会串 World
Qianji A 的消息绝不进入 World B DB
```

---

# Stage 3：Global Life / Body→Gene Promotion

目标：

> 真正实现个体经验进入公共 Genome。

任务：

1. 将 global lineage 与 per-world current 明确分离。
2. `life_events` / `memories` 增加 world_id。
3. 新增：
   - gene_promotion_candidates
   - gene_assets
   - gene_asset_sources
   - gene_asset_versions
4. 实现 `GenePromotionService`。
5. 增加 `NOMINATE_GENE_ASSET`。
6. 实现 Snapshot。
7. 实现：
   - secret scan
   - privacy gate
   - path containment
   - genericity metadata
   - provenance
8. Dream 改为聚合所有 World 的事实。
9. Body Skill 可以申请晋升。
10. 文档/模板/数据/代码可申请晋升。
11. Gene Candidate 最终仍转为 `GenePatch`，走当前 Supervisor。
12. `gene_hash` 纳入 gene assets。

验收：

### 技能遗传验收

```text
World A 产生 skill X
↓
skill X 晋升 Gene
↓
出生 G+1
↓
创建全新 World B
↓
World B 没有复制 World A Body Skill
↓
World B 仍能调用 X
```

这是本 Stage 最关键验收。

---

# Stage 4：多 World Generation 出生

目标：

> 一个 Gene 升级同时安全覆盖所有 Qianji World。

任务：

1. Generation Supervisor 支持 world registry。
2. quiesceAll。
3. 每 World prepare next CurrentStore。
4. 每 World 迁移 carry-forward Body。
5. Gene Asset 不复制进 Body，作为共享只读资源提供。
6. 对全新空 World 做 inheritance smoke。
7. 对已有 World 做 migration smoke。
8. 全部成功后切换。
9. 任何失败整体回滚。
10. `/GENE` 显示：
   - 本次迁移 World 总数
   - 成功数
   - 失败数
   - 阻塞 World
   - gene asset changes

验收：

```text
任一 World 故意制造迁移失败
→ 整个 Generation 不得切换
→ 所有旧 World 继续在旧 Generation 可启动
```

---

# Stage 5：四链 USDT Payment Rail

目标：

> 真实完成“扫码付款 → 系统自己确认谁付了哪一单”。

任务：

1. 新建 payment package/service。
2. 增加 rail。
3. 增加 invoice。
4. 生成每 Invoice 唯一 reference。
5. 生成 Solana Reference、EVM ERC-681、TRON 地址二维码与明确应付金额。
6. 实现 RPC/WebSocket Monitor。
7. 实现 backfill。
8. 实现 finality 状态。
9. 验证：
   - recipient
   - USDT mint
   - amount
   - reference
10. 去重交易。
11. confirmed/finalized 事件持久化。
12. Finalized 后：
   - 归属 Qianji
   - 归属 World
   - revenue event
   - MemoryGate
13. `/GENE` 增加 Rail 管理。
14. `/QIAN` 增加人物收入。
15. 禁止任何 private key 相关字段。

验收：

```text
A 创建 10 USDT Invoice
B 创建 10 USDT Invoice
同一链的同一个 Treasury Address
Solana 不同 Reference；其他链不同精确应付尾数

模拟核验 / 主网实际付款给 A
→ 只能 A Invoice 变 FINALIZED
→ B 不变化
→ World A revenue 增加该发票的实际 USDT 应付金额
→ World B 不变化
```

以及：

```text
重启 Monitor
→ 不重复记账
```

---

# Stage 6：真实端到端验收

最终必须走一次完整链：

```text
创建 Qianji
↓
自动创建 World
↓
Genesis Pixel 出生
↓
World 运行并繁衍至少 1 个 Pixel
↓
产生一个 Body Skill / Knowledge
↓
申请 Gene Promotion
↓
Owner 批准方向
↓
生成准确 Candidate
↓
验证
↓
Owner 批准 Candidate Hash
↓
出生下一代
↓
创建新的 Qianji World
↓
证明新 World 继承该 Gene
↓
该 Qianji 创建 USDT Invoice
↓
二维码付款
↓
Chain Finalized
↓
World Revenue
↓
Memory
↓
Dream 能看到该真实结果
```

只有这一整条跑通，V23 才算完成。

---

# 14. V23 明确不做

为了避免继续无限扩张，本版本暂时不做：

1. Pixel 自己持有真实 USDT 钱包。
2. AI 自动支出真实资金。
3. 私钥托管。
4. 多签自动签名。
5. 跨链桥。
6. 自动换汇。
7. 每个 Qianji fork 自己的 Genome。
8. 每个 World 独立 Generation。
9. 多租户公网账户系统。
10. 大规模分布式 World 调度。
11. 自动把所有 Body 文件都变成 Gene。
12. 自动批准 Gene。

---

# 15. 不可破坏的安全边界

## Root

```text
Body 不得改 Root
Evolution 不得自动批准 Root
```

## Wallet

```text
服务器不存 private key
LLM 不见 private key
Pixel 不见 RPC secret
```

## World

```text
World A 不能直接读 World B 文件/DB
```

## Gene

```text
Body Artifact 不经 Snapshot + Policy + Proposal + Validation + Owner Approval
不得进入 Genome
```

## Data

```text
客户私有数据默认永不成为 Gene
```

---

# 16. 建议新增核心类

尽量沿现有 packages，不新造大量顶层包。

建议：

```text
apps/server/src/services/
  world_registry_service.ts
  world_runtime_manager.ts
  qianji_world_gateway.ts
  gene_promotion_service.ts
  payment_service.ts
  payment_monitor.ts
```

Persistence：

```text
packages/persistence/src/repositories/
  world_registry_repository.ts
  gene_promotion_repository.ts
  gene_asset_repository.ts
  payment_repository.ts
```

Protocol：

```text
packages/protocol/src/types/
  world.ts
  gene_asset.ts
  payment.ts
```

Domain：

```text
packages/domain/src/gene/
  promotion.ts
  policy.ts
```

不新增“大一统框架”。

---

# 17. 数据迁移原则

1. 永远先 dry-run。
2. 不覆盖 V22 原 DB。
3. V23 首次迁移必须生成 migration receipt。
4. 每个文件迁移保留 SHA-256。
5. Qianji ID 不变。
6. Pixel ID 在各自 World 内不变。
7. 原 binding 历史不删除。
8. 原账本、消息、模型调用不可改写归属。
9. 不确定归属的数据进入 migration conflict，不猜。
10. V23 完成前保留 V22 recovery path。

---

# 18. 测试矩阵

至少新增：

```text
world_registry.test
world_runtime_isolation.test
qianji_world_migration.test
qianji_gateway.test

gene_promotion_snapshot.test
gene_promotion_security.test
gene_asset_provenance.test
gene_skill_inheritance.test
multi_world_generation_migration.test
multi_world_generation_rollback.test

payment_invoice.test
payment_reference.test
payment_monitor_recovery.test
payment_finality.test
payment_idempotency.test
payment_world_attribution.test
payment_secret_boundary.test
```

---

# 19. 执行纪律

1. 每 Stage 单独实施。
2. 不跨 Stage 顺手重构。
3. 每 Stage：
   - 先测试
   - 再真实迁移演练
   - 再报告
4. 不删除兼容表直到 V23 全部完成。
5. 不改无关 UI。
6. 不进行“为了优雅”而无目标的重构。
7. 新架构复杂度只服务于：
   - 多 World
   - 公共 Gene
   - 真链支付
8. 当前目标功能跑通后再考虑 V24 架构精炼。

---

# 20. V23 成功后的系统本质

到 V23 完成时，EmergentInc 应该第一次真正变成：

```text
                ROOT
                 │
              GENOME
                 │
             EVOLUTION
          ┌──────┼──────┐
          │      │      │
       WORLD A WORLD B WORLD C
          │      │      │
        Pixels Pixels Pixels
          │
      实际经验/能力
          │
          └────→ Gene Promotion
                    │
                    └────→ 下一代 Genome
```

外部经济：

```text
Customer
   ↓
Qianji
   ↓
Invoice
   ↓
四链 USDT
   ↓
Treasury
   ↓
World Revenue
   ↓
Memory
   ↓
Evolution
```

最终形成两个闭环：

## 生命闭环

```text
Genome
→ World
→ Pixels
→ Experience
→ Promotion
→ Evolution
→ Genome
```

## 商业闭环

```text
Qianji
→ Customer
→ Product/Service
→ Invoice
→ Payment
→ Revenue
→ Experience
→ Evolution
```

这两个闭环同时跑通，才是 V23 真正的目标。


# 2026-10-02 执行状态补充

本次用户已授权连续执行 Stage 0–6；不再每阶段停下等待继续。原始目标与两次 Owner 审批门槛保持。

Stage 0 的真实离线备份已验收；Stage 1–5 的本地代码、分库/来源边界、受控发布 CLI 与专项验证已实现。Stage 6 的真实进程/真实 Supervisor/空 Body 遗传流程已进行，但模型为测试替身，付款仍为模拟 RPC。首次真实 V23 切换、Owner 商户收款地址与实际 finalized 付款尚需完成，Linux 实机仍暂停。不得把这些结果写成整个计划已经完成。

详细事实与复现入口：[V23 实施记录](EmergentInc_V23_实施记录.md)。

2026-10-06 继续执行：重新离线备份验证原数据，恢复原 G0005；首次切换增加成功/启动后恢复失败的实际进程回归、切换互斥标记、旧代失败记忆和新增文件拒绝。首次 V23 候选在独立冻结目录内跑固定完整检查，具体准确 Hash 以 Owner 目录的 `initial-v23.json` 为准。真实升级与真实链上付款仍保留 Owner 审批门槛。
