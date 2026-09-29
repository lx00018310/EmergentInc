# EmergentInc Linux 自演化营收闭环整改 Plan

> 基线：`lx00018310/EmergentInc` main  
> 审阅基线提交：`c324acd8d1a9dea423dce2682e5048d8ba287c5f`（2026-09-29）  
> 执行者：本地 Codex  
> 原则：**最小更改、先闭环、不要重构现有主链、不要提前建设多平台/多链能力。**

---

## 0. 本次整改目标

把当前 EmergentInc 改造成可以长期运行在 Linux 服务器上的真实实验系统，并形成以下闭环：

```text
Pixel 产生商业想法
    ↓
需要营销时，通过现有 Pixel 消息网络请求“唯一营销 Pixel”
    ↓
唯一营销 Pixel 使用全体共用的真实营销账号对外行动
    ↓
产生客户/订单
    ↓
客户向系统统一数字货币收款地址付款
    ↓
订单与链上交易确认
    ↓
收入归因到发起业务的 Pixel
    ↓
Pixel / 系统根据真实反馈继续行动
```

同时允许系统修改自己的业务代码：

```text
Pixel / Agent 产生代码修改
    ↓
受控 self_update 工具
    ↓
独立候选 worktree
    ↓
typecheck + test + build
    ↓
切换新版本
    ↓
健康检查
    ├─ 成功 → 保留新版本
    └─ 失败 → 自动切回上一版本并重启
```

### 本次明确的三个业务约束

1. **代码可以自修改，但必须失败自动回滚。**
2. **全系统只有一个 Pixel 拥有公用营销账号权限；其他 Pixel 必须通过 Pixel 消息请求它执行。**
3. **数字货币只用于收款，不允许 Agent 转账、提现、签名或持有私钥。**

---

# 1. 不要改变的现有架构

当前 V11 主链已经适合继续扩展，不做大规模重构：

```text
React UI
  ↓
Fastify API
  ↓
RunService / RoundScheduler
  ↓
AgentStepRunner
  ↓
DecisionCompiler
  ↓
EffectRuntime
  ↓
ToolRuntime
  ↓
SQLite / Files / External Tools
```

继续保留：

- `pixel.md` 作为 Pixel 长期心智。
- `tips.md` 作为未解决提醒。
- Pixel 只能通过 ToolRuntime 对现实世界产生副作用。
- SQLite 继续作为权威事实源。
- ToolRegistry 的 enabled 开关继续作为第一层工具授权。
- execution tool snapshot 机制继续保留。
- Pixel 之间继续使用当前 6-neighborhood 消息机制。
- 不新增“全局营销请求总线”。

### 已有能力直接复用

当前数据库已经存在：

- `external_revenues`
- `revenue_contributions`
- `ledger_entries`
- `messages`
- `qianji_bindings`
- `world_events`

因此不要重新设计一套经济账本。

---

# 2. 核心安全边界

本次只增加一条真正的系统级边界：

## 可自修改层 / 不可自修改层分离

### Agent 可以修改

主要业务代码：

```text
apps/
packages/
frontend/
resources/prompts/
docs/
```

### Agent 永远不能修改

Linux 服务器上的“物理法则层”：

```text
/opt/emergentinc-supervisor/
/etc/systemd/system/emergentinc.service
/etc/emergentinc/
/var/lib/emergentinc/workspace/private/
```

并且生产环境默认：

```text
vps_exec = disabled
list_private_files = disabled
read_private_file = disabled
inspect_private_image = disabled
```

Pixel 不直接获得 Shell，不直接获得服务器 root 权限。

---

# 3. Phase 1：Linux 部署 + 不可自修改监管层

## 目标

先让系统在 Linux 上具备：

- 固定运行目录
- systemd 守护
- 数据与代码分离
- 版本切换
- 健康检查
- 自动回滚

这一阶段不先做“AI 改代码”，只把基础设施建好。

---

## 3.1 Linux 目录

建议统一：

```text
/srv/emergentinc/
├─ current -> releases/<release-id>
├─ releases/
│  ├─ <release-a>/
│  └─ <release-b>/
└─ candidates/

/var/lib/emergentinc/
└─ workspace/
   ├─ live/
   ├─ ledger/
   ├─ runtime/
   ├─ evidence/
   └─ private/

/opt/emergentinc-supervisor/
├─ deploy.sh
├─ rollback.sh
└─ supervisor.env

/etc/emergentinc/
└─ app.env
```

### 关键原则

代码版本可以被替换。

`workspace` 永远独立于 release，升级和回滚不能删除运行数据。

---

## 3.2 systemd

新增模板：

```text
deploy/linux/emergentinc.service
```

安装时复制到：

```text
/etc/systemd/system/emergentinc.service
```

服务使用非 root 用户：

```text
User=emergentinc
WorkingDirectory=/srv/emergentinc/current
```

`workspace` 通过固定环境变量或启动参数指向：

```text
/var/lib/emergentinc/workspace
```

不要再依赖“代码目录旁边就是 workspace”的隐式假设。

如当前代码存在该假设，只做最小修改，让 workspaceRoot 可由：

```text
EMERGENTINC_WORKSPACE_ROOT
```

覆盖。

---

## 3.3 增加健康检查

增加：

```http
GET /api/health
```

只返回必要信息：

```json
{
  "status": "ok",
  "version": "<git-sha-or-release-id>"
}
```

不得返回：

- API Key
- 钱包配置
- 私有路径
- marketing credentials

---

## 3.4 独立 supervisor

仓库中可以保存安装模板：

```text
deploy/linux/supervisor/
```

但安装后必须复制到：

```text
/opt/emergentinc-supervisor/
```

并设置：

```text
owner = root
app user = 不可写
```

Agent 后续即使修改 Git 仓库中的 supervisor 模板，也不能改变服务器真正运行的 supervisor。

---

## Phase 1 验收

必须全部通过：

- [ ] Linux 重启后 EmergentInc 自动启动。
- [ ] `/api/health` 正常。
- [ ] `workspace` 与 release 目录物理分离。
- [ ] 手动部署 release B 后可以切回 release A。
- [ ] release B 无法启动时 supervisor 能恢复 A。
- [ ] `emergentinc` 用户无法修改 `/opt/emergentinc-supervisor`。
- [ ] 生产 tools 配置中 `vps_exec` 和私有文件工具默认关闭。
- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`

---

# 4. Phase 2：受控自修改代码 + 自动回滚

## 目标

让 Pixel/Agent 可以真正提出代码修改并让服务器部署，但绝不开放任意 Shell。

---

## 4.1 新增一个窄工具

新增：

```text
packages/tools/src/builtin/self_update.ts
```

工具名称建议：

```text
self_update
```

输入只接受：

```json
{
  "patch_artifact": "change.diff",
  "reason": "..."
}
```

不要接受：

```text
command
shell
script
sudo
arbitrary_path
```

Pixel 先使用现有 `save_artifact` 保存 unified diff，再调用 `self_update`。

---

## 4.2 self_update Tool 只负责提交请求

Tool handler 不自己执行：

```bash
git
pnpm
systemctl
rm
cp
```

它只负责：

1. 检查 artifact 属于当前 Pixel。
2. 检查扩展名 `.diff` / `.patch`。
3. 限制 patch 大小，例如 256 KiB。
4. 生成 `update_id`。
5. 把 patch 复制到 supervisor 固定 intake 目录。
6. 调用唯一允许的 supervisor 入口。
7. 返回最终状态。

---

## 4.3 supervisor 执行流程

不可修改的 supervisor 固定执行：

```text
1. 获取部署锁 flock
2. 记录 current release
3. 创建 candidate worktree
4. git apply --check
5. 检查 patch 是否触碰禁止目录
6. git apply
7. pnpm install --frozen-lockfile
8. pnpm typecheck
9. pnpm test
10. pnpm build
11. 创建新 release
12. 原子切换 current symlink
13. systemctl restart emergentinc
14. 请求 /api/health
15. 成功 → COMMITTED
16. 失败 → current 切回 previous
17. systemctl restart emergentinc
18. 再次 health check
19. 记录结果
```

---

## 4.4 第一版禁止自修改的仓库内容

supervisor 对 patch 做路径检查。

第一版禁止修改：

```text
deploy/linux/
.env
.env.*
workspace/
.git/
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
```

理由：

第一阶段先允许 Agent 改现有业务逻辑，不允许它自行增加依赖或修改自己的部署监管机制。

以后确实有需要，再单独开放依赖升级。

---

## 4.5 回滚不是应用自己执行

这一点必须坚持。

错误设计：

```text
新版本启动
→ 新版本发现自己坏了
→ 新版本自己执行 rollback
```

正确设计：

```text
supervisor 启动新版本
→ supervisor 从进程外检查 health
→ health 失败
→ supervisor 切回旧版本
```

因为坏掉的新版本本身不能作为恢复机制。

---

## 4.6 更新审计

不要新增复杂数据库子系统。

supervisor 只维护简单 JSONL：

```text
/var/lib/emergentinc/self_updates.jsonl
```

至少记录：

```json
{
  "update_id": "...",
  "pixel_id": "...",
  "run_id": "...",
  "reason": "...",
  "base_release": "...",
  "new_release": "...",
  "status": "COMMITTED|ROLLED_BACK|REJECTED",
  "created_at": "..."
}
```

成功 patch 同时保留：

```text
/var/lib/emergentinc/self_updates/<update_id>.diff
```

暂时不要做 UI。

---

## Phase 2 验收

至少写以下自动测试：

### A. 正常升级

合法 patch：

```text
apply
→ typecheck
→ test
→ build
→ restart
→ health OK
```

结果：

```text
COMMITTED
```

### B. 编译失败

结果：

```text
REJECTED
current 不变化
```

### C. 新版本启动失败

结果：

```text
ROLLED_BACK
current 恢复 previous
旧版本 health OK
```

### D. 试图修改 supervisor

patch 包含：

```text
deploy/linux/supervisor/*
```

结果：

```text
REJECTED_PROTECTED_PATH
```

### E. Pixel 尝试直接 vps_exec

结果：

```text
TOOL_DISABLED
```

---

# 5. Phase 3：唯一营销 Pixel + 公用账号 + 数字货币只收款

这是形成真实营收闭环的阶段。

---

# 5.1 唯一营销 Pixel

在：

```text
workspace/private/marketing_account.json
```

增加：

```json
{
  "operator_pixel_id": "x_y_z",
  "provider": "<first-real-platform>",
  "enabled": true
}
```

账号 Token / Cookie / API Key 继续保存在 `private` 或服务器环境变量中。

**绝对不要把凭据放进：**

```text
pixel.md
tips.md
artifact
message
environment.md
SQLite message
```

---

## 5.2 权限不是提示词约束，而是代码强制

营销工具执行前必须：

```ts
if (ctx.pixelId !== operatorPixelId) {
    return MARKETING_OPERATOR_ONLY;
}
```

因此：

```text
普通 Pixel
  ↓
不能使用营销账号
  ↓
通过现有 send_to / Pixel 消息网络
  ↓
把请求传给营销 Pixel
  ↓
营销 Pixel 自己判断并执行
```

不要新建：

```text
global marketing request bus
特殊跨 Pixel RPC
直接替别人调用账号
```

这样保留 EmergentInc 原本的局部通信和涌现机制。

---

# 5.3 营销工具

新增：

```text
packages/tools/src/builtin/marketing.ts
```

第一版只做实际需要的最少动作。

推荐接口：

```text
marketing_read
marketing_publish
marketing_reply
```

不要一开始建设多个社交平台。

定义统一 `MarketingAdapter`，然后**只实现第一个真正要使用的平台**。

以后增加平台，只增加 adapter。

---

## 5.4 营销操作审计

新增最小表：

```sql
marketing_actions
```

字段：

```text
action_id
operator_pixel_id
requesting_pixel_id
platform
action_type
external_target
content_hash
external_result_id
status
created_at
```

其中：

- `operator_pixel_id` = 真正操作账号的唯一营销 Pixel。
- `requesting_pixel_id` = 这笔营销业务最初为哪个 Pixel 服务。

如果营销 Pixel 自己发起：

```text
requesting_pixel_id = operator_pixel_id
```

### requesting_pixel_id 如何传递

不要增加复杂工作流引擎。

营销请求消息约定一个极简结构即可：

```json
{
  "type": "MARKETING_REQUEST",
  "requesting_pixel_id": "x_y_z",
  "objective": "...",
  "material": "..."
}
```

营销 Pixel 自己解析消息并决定是否执行。

---

# 5.5 数字货币：只收款

第一版禁止：

```text
send
transfer
withdraw
swap
sign
private_key
seed_phrase
```

系统中甚至不应存在钱包私钥。

配置只包含：

```text
PAYMENT_NETWORK
PAYMENT_ASSET
PAYMENT_RECEIVE_ADDRESS
PAYMENT_READ_PROVIDER
```

例如未来可以配置某条链的 USDT，但本次代码不要写死具体链。

---

## 5.6 新增 payment_orders

因为同一个公用收款地址需要知道“一笔钱属于哪个业务 Pixel”，新增最小订单表：

```sql
payment_orders (
    order_id TEXT PRIMARY KEY,
    pixel_id TEXT NOT NULL,
    binding_id TEXT,
    asset TEXT NOT NULL,
    network TEXT NOT NULL,
    receive_address TEXT NOT NULL,
    expected_amount REAL NOT NULL,
    status TEXT NOT NULL,
    external_tx_id TEXT,
    created_at REAL NOT NULL,
    confirmed_at REAL
)
```

状态只需要：

```text
PENDING
CONFIRMED
EXPIRED
```

不要增加完整支付系统状态机。

---

## 5.7 Payment Tool

新增：

```text
packages/tools/src/builtin/payments.ts
```

第一版两个动作即可：

```text
payment_create_order
payment_check_order
```

### payment_create_order

任何 Pixel 可以创建自己的订单。

系统自动绑定：

```text
pixel_id = ctx.pixelId
binding_id = 当前 binding
```

Pixel 不允许传入另一个 pixel_id。

返回：

```json
{
  "order_id": "...",
  "network": "...",
  "asset": "...",
  "receive_address": "...",
  "expected_amount": 1.0
}
```

---

## 5.8 链上确认

`payment_check_order`：

通过只读 RPC / explorer API 查询。

只验证：

```text
交易存在
目标地址 == PAYMENT_RECEIVE_ADDRESS
资产正确
金额 >= expected_amount
交易达到最低确认数
tx_hash 未被其他订单使用
```

不要做任何签名操作。

---

# 5.9 复用已有 external_revenues

付款确认成功以后：

```text
payment_orders
      ↓
external_revenues
      ↓
revenue_contributions（需要多人归因时）
```

`external_tx_id` 直接使用链上 `tx_hash`，天然幂等。

`external_revenues.pixel_id` 记录订单所属 Pixel。

网络、币种、订单 ID 等放到 `details`。

### 第一版不要做

```text
自动提现
自动换币
自动给钱包转账
自动把收入换成 Pixel energy
```

真实收入先作为独立事实记录。

以后要建立“赚 1 USDT = 获得多少 Token 能量”的经济规则，再单独设计。

---

# 5.10 收入归因链

最终数据库必须能还原：

```text
requesting Pixel
    ↓
MARKETING_REQUEST
    ↓
marketing Pixel
    ↓
marketing_action
    ↓
customer / external interaction
    ↓
payment_order
    ↓
tx_hash
    ↓
external_revenues
```

这是整个项目真正重要的数据。

---

# 6. 需要修改/新增的主要文件

Codex 以当前实际代码为准，不要求机械照抄文件名，但控制改动范围。

## 修改

```text
packages/tools/src/builtin/index.ts
packages/tools/src/runtime.ts                 # 仅必要时
packages/persistence/src/migrations/init_schema.ts
packages/persistence/src/core_store.ts
apps/server/src/app.ts
apps/server/src/routes/api_routes.ts          # 如需只读观察接口
docs/runtime_invariants.md
README.md
.env.example
```

## 新增

```text
packages/tools/src/builtin/self_update.ts
packages/tools/src/builtin/marketing.ts
packages/tools/src/builtin/payments.ts

packages/persistence/src/repositories/payment_repository.ts
packages/persistence/src/repositories/marketing_repository.ts

deploy/linux/emergentinc.service
deploy/linux/install.sh
deploy/linux/supervisor/deploy.sh
deploy/linux/supervisor/rollback.sh

packages/tools/tests/self_update.test.ts
packages/tools/tests/marketing.test.ts
packages/tools/tests/payments.test.ts
```

如果可以直接放入已有测试文件，不强制新增测试文件。

---

# 7. 明确禁止的过度设计

本次整改不要做：

- 不重构 RoundScheduler。
- 不重构 AgentStepRunner。
- 不重新设计 Pixel。
- 不增加中心化任务总线。
- 不增加多营销账号。
- 不增加多营销 Pixel 权限系统。
- 不同时做 Twitter / Facebook / Reddit / Telegram 等多个 adapter。
- 不建设钱包私钥管理。
- 不建设链上转账。
- 不建设 DEX。
- 不建设智能合约。
- 不建设复杂财务系统。
- 不建设 Kubernetes。
- 不建设微服务体系。
- 不因为 Linux 部署改成 Docker/K8s，除非当前环境已有明确需要。
- 不允许 Agent 使用通用 root shell 代替 `self_update`。
- 不允许新版本自己负责自己的 rollback。
- 不自动 push 到 GitHub main。

先证明：

```text
AI 能行动
→ 能找到真实客户
→ 能收到真实钱
→ 能知道是谁赚的钱
→ 能安全修改自己
→ 改坏了可以自己恢复
```

---

# 8. 最终验收场景

本次整改完成后必须实际跑一次完整实验。

## 场景

### Pixel A

产生一个可以销售的小服务：

```text
A → 形成产品/材料
```

A 没有营销权限，因此：

```text
A → 消息网络 → Marketing Pixel M
```

### Marketing Pixel M

M 是唯一拥有公用营销账号能力的 Pixel：

```text
M → marketing_publish / marketing_reply
```

系统产生：

```text
marketing_action
requesting_pixel_id = A
operator_pixel_id = M
```

客户愿意购买。

A 或 M 创建订单：

```text
payment_create_order
```

但订单业务归属必须是 A。

客户向统一收款地址付款。

系统只读验证链上交易：

```text
payment_check_order
```

确认后：

```text
payment_order = CONFIRMED
external_revenues += tx
pixel_id = A
```

最终可以回答：

```text
谁真正操作账号？      → M
是谁提出并拥有业务？  → A
哪次营销产生客户？    → marketing_action
哪个订单？            → order_id
哪笔真钱？            → tx_hash
赚了多少？            → external_revenues
```

---

# 9. 自修改最终验收场景

让某个 Pixel 发现一个简单代码问题。

它生成：

```text
fix.diff
```

然后：

```text
self_update(fix.diff)
```

必须观察到：

```text
candidate
→ typecheck
→ test
→ build
→ switch
→ restart
→ health
```

再人为提供一个“可以编译但启动后 health 失败”的 patch。

必须自动出现：

```text
new release
→ health failed
→ rollback
→ previous release
→ health ok
```

整个过程中：

```text
workspace 数据不丢
SQLite 不回滚
营销账号凭据不暴露
收款配置不暴露
supervisor 不被修改
```

---

# 10. 完成定义（Definition of Done）

只有以下全部成立，才算本次整改完成：

- [ ] EmergentInc 稳定运行在 Linux + systemd。
- [ ] 代码与 workspace 数据分离。
- [ ] supervisor 位于 Agent 不可写区域。
- [ ] Pixel 没有通用 Shell/root 权限。
- [ ] Pixel 可以通过 `self_update` 修改业务代码。
- [ ] build/test/typecheck 失败不会发布。
- [ ] 新版本运行失败会自动恢复上一版本。
- [ ] 全系统只有指定 `operator_pixel_id` 可以调用营销账号。
- [ ] 其他 Pixel 必须通过现有消息网络请求营销 Pixel。
- [ ] 营销账号凭据不会进入模型上下文。
- [ ] 所有真实营销动作可审计。
- [ ] 数字货币系统只有 receive/read 能力。
- [ ] 系统中没有钱包私钥和签名功能。
- [ ] 每笔付款绑定 `order_id`。
- [ ] `tx_hash` 全局幂等。
- [ ] 收入最终进入现有 `external_revenues`。
- [ ] 可以从收入反查业务 Pixel。
- [ ] 完成一次真实“Pixel → 营销 → 客户 → 数字货币收款 → 收入归因”的闭环。
- [ ] `pnpm test` 全绿。
- [ ] `pnpm typecheck` 全绿。
- [ ] `pnpm build` 成功。

---

## 给 Codex 的执行要求

严格按 **Phase 1 → Phase 2 → Phase 3** 顺序执行。

每完成一个 Phase：

1. 先跑测试。
2. 修复当前阶段问题。
3. 确认验收项全部通过。
4. 再进入下一 Phase。

遵循仓库 `AGENTS.md`：

> 简洁优先，最小更改优先，最小功能实现优先。

不要为了“未来可能会用”增加抽象。

本次目标不是建设一个完整 AI 商业平台，而是让 **EmergentInc 第一次拥有安全的自修改能力、唯一真实营销出口、真实收款能力和可验证的收入归因闭环。**
