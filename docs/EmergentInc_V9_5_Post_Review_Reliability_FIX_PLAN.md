# EmergentInc V9.5 主链可靠性修复计划

> 基线提交：`966d7a11058799813946087707349628a41edff7`  
> 性质：修复计划，不包含业务代码修改  
> 范围：3 个 T0、5 个 T1  
> 安全门：T0 全部关闭前，禁止长期或真实付费实验

---

## 1. 计划定位

本计划是 `EmergentInc_V9_Core_Reliability_and_Genesis_Prompt_FIX_PLAN.md` 的审查后修订版。原计划的功能大多已经接线，但真实费用、消息恢复和账本一致性仍未闭环。

已有能力必须保持不变：

- LLM payload 仍然只有 `state / pixel.md / message.md`；
- Genesis 继续作为可清空、按 Run 锁定的 system prompt 上下文；
- Genesis 不进入 Pixel 消息和 `pixel.md`；
- Pixel 仍只能向自身或直接活跃邻居发消息；
- 未配置真实沙箱时，`run_isolated_code` 继续禁用；
- 不增加人为商业评价、奖励或组织定义。

## 2. 问题范围

| ID | 级别 | 问题 |
|---|---|---|
| R-01 | T0 | 生产入口没有执行 Run / 全局硬预算 |
| R-02 | T0 | 崩溃恢复会重复付费调用和副作用 |
| R-03 | T0 | Energy、账本、回款、退款和复制不是原子事务 |
| R-04 | T1 | `USAGE_UNKNOWN` 记录后仍继续运行 |
| R-05 | T1 | 队列损坏被静默吞掉 |
| R-06 | T1 | 退款缺口不会阻断支出，也不会被后续回款优先填补 |
| R-07 | T1 | 一次预留不足会杀死仍有正余额的 Pixel 并消费消息 |
| R-08 | T1 | 快照缺少队列、artifact 引用，且不能精确恢复 Pixel 集合 |

本次不做：商业规则扩展、新外部工具、宿主代码执行、前端框架重写、邻域规则调整、自动补账或目录重构。

---

## 3. 第一性原理约束

### 3.1 费用授权链

任何真实费用必须严格遵循：

```text
Owner 授权
  → 持久化 Run / 全局额度
  → 调用前原子预留
  → 模型调用
  → 持久化 usage
  → 实际结算
  → 释放剩余预留
```

不得用当前总 Energy 代替 Owner 的全局费用上限；不得在 Round 结束时清零 Run 累计费用；不得在预算为 `None` 时调用真实模型。

### 3.2 消息与副作用

一条消息可以恢复，但同一个副作用只能执行一次：

```text
effect_id = sha256(message_id + effect_type + effect_index + payload_hash)
```

普通 LLM API 通常不提供 Exactly Once。如果请求可能已经到达供应商，但本地没有取得结果，必须标记 `CALL_OUTCOME_UNKNOWN` 并暂停；不能自动退款，也不能自动重试。

### 3.3 Energy 守恒

余额、reservation、settle、transfer、reproduce、revenue、refund、refund deficit 和账本记录必须在同一个数据库事务内提交。

禁止继续用“先写多个 JSON，再追加 JSONL，异常时用 Python 回滚”模拟原子事务。进程退出和断电不会执行异常回滚代码。

### 3.4 Fail-Closed

以下情况必须拒绝继续运行：

- 队列损坏；
- 调用结果或 usage 未知；
- 账本迁移不平；
- 存在无法解释的 reservation；
- Run / 全局预算缺失；
- 当前真实模型没有精确定价或 token estimator；
- checkout 时存在运行中调用或未决外部动作。

不得用空队列、默认价格、自动退款或忽略异常兜底。

---

## 4. 最小可靠架构

### 4.1 单一事务事实源

新增：

```text
workspace/ledger/v9_core.sqlite3
```

使用 Python 标准库 `sqlite3`。它是以下数据的唯一事实源：

- Pixel Energy；
- Run / 全局预算和 reservation；
- 消息执行状态；
- 模型调用结果和 usage；
- 副作用幂等记录；
- 回款、退款和 deficit；
- 不可变账本。

`state.json.energy` 仅作为 UI/兼容投影。发生差异时以数据库为准并阻断审计，禁止用 JSON 反向覆盖数据库。

`energy_ledger.jsonl` 保留为历史输入和可选审计导出，不再作为并发写事实源。

最少数据表：

```text
schema_meta
pixel_accounts
runs
global_budget
reservations
model_calls
messages
effects
ledger_entries
external_revenues
external_refunds
```

关键唯一约束：`entry_id`、`external_tx_id`、`refund_id`、`call_id`、`message_id`、`effect_id` 全部唯一。

写事务使用 `BEGIN IMMEDIATE`。Python `RLock` 只用于减少同进程竞争，不再承担一致性保证。

### 4.2 消息状态机

```text
QUEUED
  → RESERVED
  → CALLING
  → RESPONSE_STORED
  → EFFECTS_APPLIED
  → COMMITTED
```

异常状态：

```text
WAITING_PIXEL_BUDGET
WAITING_RUN_BUDGET
CALL_OUTCOME_UNKNOWN
RECOVERY_REQUIRED
CANCELLED_BY_OWNER
```

恢复规则：

- `QUEUED`：正常执行；
- `RESERVED` 且确认没有发出调用：可以释放或继续；
- `CALLING` 且无持久化结果：转为 `CALL_OUTCOME_UNKNOWN` 并暂停；
- `RESPONSE_STORED`：禁止再次调用模型，只继续未完成副作用；
- `EFFECTS_APPLIED`：只提交消息；
- `COMMITTED`：永不再次执行。

禁止把旧 `in_progress` 直接恢复成普通队列消息后重跑整条链路。

---

## 5. 分阶段实施

## Phase 0：关闭危险入口

### 5.0.1 强制 Run 参数

`RunStartRequest` 增加：

```text
run_budget_tokens: int
global_budget_tokens: int
```

规则：

- 两个预算必须为正整数；
- Mock 和真实模式使用同一预算入口；
- `global_budget_tokens` 是实验累计费用上限，不是当前 Energy 总量；
- 前端只增加两个必要数字输入框；
- Run 启动后预算锁定，中途不能提高；
- 需要调整时先 STOP，再开新 Run。

### 5.0.2 启动审计门

`RunController.start()` 在创建 worker 前检查：损坏队列、open reservation、unknown call、账实不符、重复交易、stale loop 和数据库迁移状态。

存在异常时返回 `409 RECOVERY_REQUIRED`，不得启动线程。

新增明确状态：

```text
PAUSED_RECOVERY_REQUIRED
PAUSED_BUDGET_EXHAUSTED
PAUSED_OWNER_ACTION
```

验收：未传预算返回 400；存在恢复异常返回 409；预算为 `None` 时没有任何真实调用路径。

## Phase 1：事务存储和迁移

建议新增 `emergentinc/engine/core_store.py`，只暴露明确事务方法：

```text
create_run_budget
reserve_call_budget
settle_call_budget
mark_call_unknown
transfer_energy
allocate_reproduction
credit_revenue
refund_revenue
enqueue_message
transition_message
record_effect_once
```

迁移流程：

1. 停止 UI 和所有 runner；
2. 备份 `workspace/live`、`runtime`、`ledger`；
3. 只读扫描 Pixel 状态和 JSONL；
4. 生成迁移报告；
5. 重复 ID、余额差异或未知 reservation 时停止；
6. 审计通过后在单一 SQLite 事务中导入；
7. 写入迁移完成标记；
8. 原 JSONL 保留，不覆盖、不删除；
9. 重复迁移返回 `ALREADY_MIGRATED`。

`api.py` 不再为每个回款请求创建新的 `EnergyManager`。不同请求可使用不同数据库连接，但必须由数据库事务和唯一约束保证一致性。

验收：并发重复回款只生效一次；进程在事务中间退出时全部提交或全部回滚；旧 JSONL 不再被主链追加。

## Phase 2：执行真正的三层硬预算

Run 创建时持久化：

```text
run_id
run_limit / run_spent / run_reserved
global_limit / global_spent / global_reserved
genesis_revision / genesis_hash
pricing_revision
status
```

每个 Round 使用同一个 `run_id`，不得在 `run_round()` 内重新初始化 Run 累计值。

从 `V9LLMClient.step()` 抽出无副作用的 `prepare_prompt(...)`，返回真实要发送的 system/user 内容、prompt hash、token 估值、最大输出、模型和定价版本。Scheduler 和 LLM 必须复用同一个 PreparedPrompt。

Token estimator 优先级：

1. 当前模型明确配置的 tokenizer；
2. 供应商提供的本地 counter；
3. 已验证的保守上界算法。

未知模型不得落到 `default` 价格；没有可验证 estimator 时返回 `PRICING_OR_TOKENIZER_NOT_CONFIGURED`。

预留必须覆盖基础 system prompt、Genesis、完整 state JSON、pixel.md、message.md 和最大输出。

一次预留事务同时校验：

```text
pixel_available >= reserve
run_spent + run_reserved + reserve <= run_limit
global_spent + global_reserved + reserve <= global_limit
refund_deficit == 0
```

结算时更新 Run / 全局累计值并释放差额。实际 usage 大于预留属于严重异常，立即暂停。cached token 必须从供应商 usage 明细读取，历史调用使用调用时锁定的 pricing revision。

验收：预算跨 Round、Run 和重启累计；超长 state/Genesis 增加预留；未知模型/价格/tokenizer 时不调用；生产 UI 的预算实际进入事务预留层。

## Phase 3：消息和副作用崩溃恢复

调用前：原子预留、消息转 `RESERVED`、建立 `model_call`，网络调用前转 `CALLING`。

成功响应必须先持久化以下内容，才能进入 `RESPONSE_STORED`：

- 原始响应和规范化响应；
- usage；
- prompt / response hash；
- Genesis revision/hash；
- model 和 pricing revision。

只有能证明请求尚未发出时才能释放预留，例如本地配置缺失或本地校验失败。

timeout、connection reset、429、5xx、响应损坏、JSON/Schema 错误以及 `CALLING` 中进程退出，一律进入：

```text
message = CALL_OUTCOME_UNKNOWN
run = PAUSED_RECOVERY_REQUIRED
reservation = unresolved
```

禁止自动重试和自动退款。

从已保存响应生成稳定 effect 列表。Energy 转账、reproduction 和消息入队要与 effect 完成标记处于同一事务。

artifact 使用临时文件、hash 校验和原子替换；重放时若 hash 相同视为已完成，hash 冲突则暂停，不覆盖。

旧 queue JSON 过渡期解析失败必须抛出 `QUEUE_CORRUPTED`、保存只读 quarantine 副本并阻止 Run；不得创建空队列覆盖原文件。

故障注入必须覆盖：预留后、调用前、调用中、响应落盘后、单个 effect 后、全部 effect 后以及 commit 前退出。

验收：已保存响应不再次调用；已完成转账/复制不重复；未知调用只暂停；COMMITTED 消息永不重放。

## Phase 4：关闭剩余 T1

### 5.4.1 预算不足不等于死亡

当 Pixel 有正 Energy 但不足当前调用：

```text
Pixel.active 保持不变
message = WAITING_PIXEL_BUDGET
消息不消费
不产生费用
```

获得邻居转账、外部回款或新 Run 授权后再检查。不得每 Round 自旋重试。

### 5.4.2 Refund deficit

`pixel_accounts` 增加 `refund_deficit_tokens` 和 `spend_blocked_reason`。

- 退款超过余额时，余额归零，差额进入 deficit；
- deficit 大于零时禁止模型预留、转账和繁殖；
- Pixel 仍可接收无需费用的消息；
- 后续回款先抵扣 deficit，只有剩余部分增加 Energy；
- deficit 清零后解除支出阻断；
- 每次退款使用唯一 `refund_id`。

### 5.4.3 Genesis API 类型校验

新增 `GenesisPromptUpdateRequest.content: str`。`null`、数组和对象返回 422，不能转为 `"None"`；空字符串仍表示关闭。

验收：正余额 Pixel 不会因一次预留不足死亡；等待消息不丢失；deficit 阻断支出且优先被回款填补；Genesis `null` 被拒绝。

## Phase 5：快照和分支语义

每个快照增加 `snapshot_manifest.json`，记录：

```text
snapshot_id / branch_id / round
pixel_ids 和文件 hash
environment / world_state hash
artifact version references
message checkpoint reference
genesis revision/hash
created_at
```

只记录 Genesis revision/hash，不恢复 Genesis 内容。

恢复时必须对账 `snapshot_pixel_ids` 与 `current_pixel_ids`：

- 快照 Pixel：恢复认知和非财务字段；
- 当前有、快照无：从当前认知拓扑移出并归档，不能继续混入旧世界；
- 快照有、当前无：可恢复认知，但 Energy 为零，除非 Owner 明确划拨；
- Energy 永远不从快照恢复；
- 被移出 Pixel 的当前 Energy 保留在原分支账户，不能消失或复制。

从旧 Loop 创建分支时，API 必须要求 `branch_name + budget_allocations`。每笔额度来自当前尚未花费的明确账户，并通过事务划拨。

Queue 只恢复当时未消费的逻辑消息；completed message/effect 不重放。artifact 使用内容 hash/version 引用。`external_requests` 不直接覆盖回旧状态，已执行的外部事实不可回滚。

验收：checkout 后没有未来 Pixel 混入；branch 不复制余额；pending 消息可恢复但 committed 消息不重放；外部请求与 Genesis 内容不回滚。

## Phase 6：审计和最小 UI

审计输出至少包含：

- Run/global limit、spent、reserved、remaining；
- Pixel balance 和 refund deficit；
- open reservations、unknown calls、未完成 message/effect；
- snapshot manifest 完整性；
- Genesis 和 pricing revision；
- 是否允许启动 Run。

前端只增加：预算输入、当前 Run 花费/剩余、恢复阻断提示、unknown call/open reservation、refund deficit。不要增加新仪表盘或重做布局。

每个 Run 生成只读报告：`run_id`、轮次、状态、停止原因、Genesis/pricing revision、预算、调用数、未知调用数、message/effect 数和审计结果。

---

## 6. 文件级改动建议

| 文件 | 改动 |
|---|---|
| `engine/core_store.py` | 新增 SQLite schema、事务、迁移、幂等约束 |
| `engine/energy.py` | 变为 CoreStore 薄封装，删除跨文件伪事务 |
| `engine/router.py` | 接入消息状态机，损坏时 fail-closed |
| `engine/llm.py` | PreparedPrompt、完整 usage、未知调用分类 |
| `engine/scheduler.py` | 持久预算上下文和 message/effect 状态机 |
| `engine/audit.py` | 审计数据库、unknown call、deficit、manifest |
| `engine/persistence.py` | 精确恢复 Pixel 集合，保留 Energy 非回滚边界 |
| `ui/run_controller.py` | 强制预算、启动审计、持久 Run 状态 |
| `ui/api.py` | 强类型请求、事务存储入口 |
| `ui/loop_store.py` | 显式分支预算、snapshot manifest |
| `ui/snapshot.py` | queue/artifact 引用，禁止恢复外部事实 |
| `ui/static/index.html` | 最小预算输入和恢复信息 |
| `ui/static/app.js` | 传预算并展示实际费用状态 |
| `resources/config/model_pricing.json` | pricing revision、精确模型和 tokenizer 配置 |

禁止在此范围外顺手重构目录、前端或 Pixel 模型。

---

## 7. 测试矩阵

建议新增：

```text
test_run_budget_end_to_end.py
test_global_budget_persistence.py
test_core_store_atomicity.py
test_concurrent_revenue_idempotency.py
test_message_crash_recovery.py
test_unknown_call_pause.py
test_refund_deficit.py
test_waiting_pixel_budget.py
test_snapshot_exact_restore.py
test_branch_budget_allocation.py
test_genesis_request_validation.py
```

T0 必测：

1. 生产 API 未提供预算时不能启动；
2. Run 预算跨多个 Round 累计；
3. 全局预算跨 Run 和重启累计；
4. 完整 prompt 进入预留；
5. 每个事务步骤注入异常都不会半提交；
6. 并发重复回款只成功一次；
7. 响应保存后崩溃不再次调用；
8. effect 后崩溃不重复转账/复制；
9. `CALLING` 中崩溃必须暂停；
10. 未知调用不自动退款。

T1 必测：队列损坏阻断、预算不足不死亡、等待消息不丢不自旋、deficit 阻断及优先填补、checkout 精确集合、branch 不增发、committed 动作不重放、Genesis `null` 拒绝、cached usage/pricing revision 留痕。

全部单元和故障注入测试通过后，再执行：Mock LLM 至少 100 Round；随机终止/重启至少 20 次；每次运行审计；最后只用极小真实预算跑 1—3 Round，并人工对照供应商账单、usage、数据库账本和 Run 报告。

Mock 长跑通过不等于真实费用验收通过。

---

## 8. 推荐提交顺序

```text
1. fix(v9): block unsafe runs without durable budgets
2. feat(v9): add transactional core store and audited migration
3. fix(v9): enforce persistent run and global budget limits
4. fix(v9): persist message call and effect state machine
5. fix(v9): enforce refund deficits and waiting budget semantics
6. fix(v9): restore exact snapshots with explicit branch allocation
7. test(v9): add crash concurrency and long-run reliability matrix
```

每个提交只解决一个阶段，不把 UI、迁移和消息状态机混成一个巨型提交。

## 9. 执行停机条件

执行模型遇到以下情况必须停止并报告：

1. 当前账本净额与 Pixel 余额无法解释；
2. 无法判断真实 LLM 调用是否到达供应商；
3. 迁移发现重复外部交易 ID；
4. 需要删除或覆盖不可回滚账本；
5. 分支预算来源不明确；
6. 需要改变三输入或 Genesis 语义；
7. 测试依赖自动补账、默认价格或忽略损坏数据；
8. 需要重新启用宿主代码执行；
9. 需要扩大到商业规则或前端重构。

## 10. 完成定义

只有同时满足以下条件，才能关闭计划：

- 3 个 T0、5 个 T1 均有回归测试；
- 生产 Run 强制执行 Pixel / Run / 全局三层预算；
- Run/global 费用跨 Round、Run 和重启累计；
- Energy 和账本使用真实数据库事务；
- 并发回款、退款和转账不重复、不半提交；
- 消息恢复不重复 LLM 和副作用；
- 未知调用暂停，不自动处理；
- refund deficit 阻断支出并被回款优先填补；
- checkout/branch 不恢复或复制历史 Energy；
- 快照精确恢复认知 Pixel 集合与待处理消息；
- 三输入、Genesis、邻域和隔离规则保持不变；
- 完整测试、故障注入和 Mock 长跑通过；
- 小额真实调用与供应商账单人工对账通过；
- 实现报告明确区分本地验证与真实费用验收。

在此之前，系统只能称为可继续开发的模拟器，不能宣称已具备可靠的长期自主经营运行能力。
