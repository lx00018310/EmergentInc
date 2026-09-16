# EmergentInc V9 核心可靠性与创世提示词修复计划

版本定位：

```text
V9.x = 在不增加商业规则、不预设组织结构的前提下，
       修复 V9 核心安全、预算、持久化和动作一致性，
       并增加可由 Owner 随时清空的临时创世提示词。
```

本文件只是一份实施计划，不包含代码修改。

---

## 1. 第一性原则结论

V9 当前已经具备三条主链路的原型：

1. Pixel 自主更新 `pixel.md`；
2. Pixel 通过局部消息向自己或六邻域 Pixel 传播信息；
3. Engine 执行能量、复制、路由、环境读取等底层物理规则。

但当前实现仍存在两类问题：

- 部分底层规则可以被绕过，因而不能称为可靠的“物理规律”；
- 消息、预算和运行状态缺少崩溃一致性，长期运行会丢消息或产生账实不符。

本计划的目标不是增加“什么叫好 Pixel”“什么叫公司”等新规则，而是保证已有规则不可被 UI、异常、重启或模型输出绕过。

创世提示词只作为实验的初始条件，为 Pixel 提供初速度；它不是新的世界规则，也不能作为最终涌现结论的证据。

---

## 2. 范围与非目标

### 2.1 本计划范围

- 修复已确认的全部 T0/T1 问题；
- 保留 V9 的三输入认知模型：`state.json + pixel.md + message.md`；
- 增加前端“创世提示词”独立编辑窗口；
- 创世提示词非空时加入每次 LLM 的 system prompt，空字符串时完全关闭；
- 对 Prompt 版本、费用、消息、回款和恢复行为增加可审计证据；
- 为现有 workspace 提供只读审计与人工确认后的恢复步骤。

### 2.2 明确不做

- 不定义老板、员工、公司、部门、专业、利润、合作或竞争；
- 不把成本、独特性、匹配写成 Engine 规则或评分字段；
- 不新增中央 Planner、任务中枢或商业状态机；
- 不重写整个调度器；
- 不自动部署、不打包、不推送；
- 不自动认定现有未结算模型调用应该退款；
- 不在回退或分支时自动恢复已经消耗的预算；
- 不把创世提示词拼入 Pixel 之间的 `message.md`。

---

## 3. 已确认问题清单

### T0-01 宿主机代码执行与文件越界

当前 `run_isolated_code` 直接使用宿主 Python 执行模型代码；`read_artifact` 允许跨 Pixel 读取，且 `target_pixel_id` 可形成 Windows 绝对路径逃逸。

风险：模型或提示注入可以读取、修改或删除宿主机文件，发起网络请求或启动进程。

### T0-02 UI 回退与分支可恢复历史 energy

UI 使用 `emergentinc/ui/snapshot.py` 整体恢复历史 `pixels/`，会把历史 `state.json.energy` 一起恢复，而不可回滚账本保持不变。

风险：已经花费的预算被恢复，能量守恒失效。

### T0-03 外部回款缺少幂等与退款

相同 `external_tx_id` 可以重复调用 `/api/revenue/credit`，每次都会增加 energy；退款和拒付没有实现。

风险：重试、双击或重复请求可凭空增加预算。

### T0-04 真实费用硬上限没有执行

每次调用固定预留 3000 Token；`inbox_call_budget_per_round` 没有被调度器使用；没有 Owner 全局运行费用上限；停止只在 Round 边界检查。

风险：单次调用、单轮或整个运行都可能超过 Owner 授权的真实支出。

### T1-01 energy 不是实际费用折算

当前直接使用 `total_tokens`，没有区分模型、输入、输出和缓存价格；解析失败固定扣 200；usage 缺失时可能按 0 结算。

### T1-02 消息与回执不持久化

主队列、延期队列、环境回执和工具回执只存在于内存。异常退出、运行结束或重新启动 scheduler 后可能丢失。

### T1-03 崩溃会留下半完成交易

预算 reservation 只保存在进程内存。当前 workspace 已存在 reserve/settle 数量不一致、Pixel 回合领先于 world round、Loop 长期停留在 `RUNNING` 的证据。

### T1-04 V9 `owner_request` 被静默丢弃

Schema 和模型输出支持 `owner_request`，但 V9 scheduler 没有持久化、显示或暂停等待 Owner。

### T1-05 复制操作不是原子的

母体先扣 energy，再写子代；超长 `child_pixel_md` 保存失败时，会留下只有 `state.json` 的幽灵 Pixel，并锁死能量与坐标。

### T1-06 向不存在的邻位转账会中断运行

调度器只检查几何邻接，没有检查目标 Pixel 是否存在且 active，随后读取不存在的 `state.json` 并抛出异常。

### T1-07 Pixel 详情 API 路由冲突

`get_environment()` 被错误注册到 `/pixels/{pixel_id}`，导致 Pixel 详情端点返回环境内容。

---

## 4. 目标运行模型

修复后的单次交互应满足：

```text
不可变物理 system prompt
        +
当前运行锁定的创世提示词（可为空）
        +
严格三输入 payload：state + pixel_md + message_md
        ↓
LLM 响应
        ↓
完整预校验
        ↓
费用预留与持久化事务
        ↓
心智 / 消息 / 操作 / 转账 / 复制
        ↓
持久化提交或明确失败回执
```

必须保持以下边界：

- 创世提示词是 system prompt 的临时组成部分，不是第四个 payload 字段；
- 创世提示词不进入 `message.md`，不占 2000 字消息额度；
- 同一次 Run 在启动时锁定一个 Prompt revision，中途不得变化；
- Prompt 被清空后，下一次 Run 不再注入；
- 清空 Prompt 不自动清除 Pixel 已经写入 `pixel.md` 的经验；
- 回退旧 Loop 不得自动重新启用已经清空的创世提示词。

---

## 5. 实施阶段

## Phase 0：安全止血与现状审计

### 5.0.1 暂停不安全的宿主代码执行

涉及文件：

- `emergentinc/engine/operations.py`
- `resources/prompts/v9_system_prompt.md`（只调整可用工具说明时才修改）
- 对应测试

最小改动：

1. 在没有真正隔离执行器时，`run_isolated_code` 固定返回 `CAPABILITY_UNAVAILABLE`；
2. 不回退到宿主 Python；
3. 不自动尝试 PowerShell、CMD 或其他本地 shell；
4. 将来接入独立沙箱属于新的明确授权任务，不在本计划中实现。

验收：

- 任意模型代码都不能读取 workspace 外文件；
- 任意模型代码都不能启动本地进程或联网；
- 原有 save/read/list artifact 正常工作。

### 5.0.2 修复 artifact 路径与所有权

最小规则：

1. `pixel_id` 必须符合坐标 ID 格式；
2. 文件路径 resolve 后必须仍位于该 Pixel 的 artifact 根目录；
3. 默认只能读取自己的 artifact；
4. 本阶段不新增跨 Pixel 授权协议；跨 Pixel 读取直接拒绝；
5. 禁止绝对路径、盘符、UNC、`..`、符号链接逃逸和 Windows ADS。

### 5.0.3 对现有 workspace 只读审计

新增只读审计输出，至少报告：

- 未结算 reservation；
- ledger entry ID 重复；
- world round 与 Pixel `last_active_round` 不一致；
- 长期处于 `RUNNING` 的 Loop；
- state-only 或 pixel.md-only 的不完整 Pixel；
- 当前总 energy 与账本净额差异。

当前已知异常不得自动修正。未结算调用的真实计费结果未知，应标为 `RECOVERY_REQUIRED`，等待 Owner 选择实际用量或确认退款。

---

## Phase 1：预算、回款与快照边界

### 5.1.1 暂时禁用不安全的回退与分支

在安全恢复完成前：

- checkout/branch API 返回明确的 `UNSAFE_SNAPSHOT_DISABLED`；
- 前端按钮显示不可用原因；
- 不继续调用旧 `ui.snapshot.restore_snapshot()`。

这是临时安全闸，不是长期兜底。

### 5.1.2 收敛为唯一 V9 SnapshotManager

涉及文件：

- `emergentinc/engine/persistence.py`
- `emergentinc/ui/loop_store.py`
- `emergentinc/ui/snapshot.py`（删除重复逻辑或变成薄适配层）

恢复规则：

1. 认知内容、局部拓扑、环境、队列和 artifact 引用可恢复；
2. energy 不从快照恢复；
3. energy 必须来自当前不可回滚账本和当前未消费余额；
4. 快照里存在、当前不存在的 Pixel 不得带历史余额复活；
5. 分支不得复制当前总预算；
6. 外部动作、回款和已消费费用不得重放；
7. 创世提示词仅记录 revision/hash，不随 checkout 恢复。

恢复后必须验证：

```text
total_energy_after <= total_energy_before + 本次经过核验的新回款
```

### 5.1.3 回款幂等与退款

涉及文件：

- `emergentinc/engine/energy.py`
- `emergentinc/ui/api.py`

规则：

1. `external_tx_id` 全局唯一；
2. 完全相同的重复请求返回 `ALREADY_CREDITED`，不再次入账；
3. 相同 ID 但金额或归属不同返回冲突；
4. 退款必须引用原始回款 ID；
5. 每笔回款最多完整冲回一次；
6. 余额不足时记录待偿缺口，不制造负转账或伪造结算；
7. 同一进程中的并发请求必须串行化；状态与账本写入必须具备崩溃恢复记录。

---

## Phase 2：真实费用与硬预算

### 5.2.1 建立模型价格配置

配置至少包含：

```json
{
  "model": "provider/model-name",
  "input_cost_per_million": 0,
  "cached_input_cost_per_million": 0,
  "output_cost_per_million": 0,
  "currency": "CNY",
  "effective_from": "ISO-8601"
}
```

规则：

- 根据实际 input/output/cache usage 分别计算费用；
- 将实际费用按固定基准换算为 energy；
- 调用记录保存采用的价格版本；
- 不用当前价格重算历史账本。

### 5.2.2 调用前硬预留

预留上限必须覆盖：

- 当前输入的估计最大费用；
- 当前配置允许的最大输出费用；
- 供应商可能产生的其他明确费用。

余额或 Owner 剩余运行预算不足时，不发起请求，不先调用后透支。

### 5.2.3 三层费用上限

必须同时执行：

1. Pixel 每轮接收调用预算：`inbox_call_budget_per_round`；
2. 单次 Run 的 Owner 硬预算；
3. 全局实验累计硬预算。

任何上限都不能被消息复制、SELF 循环、重启或分支绕过。

### 5.2.4 停止边界

调度器在每次 LLM 调用和每次外部操作前检查停止信号，而不是只在 Round 开始检查。

已经发出的请求允许完成结算，但停止后不得再发起下一次付费动作。

### 5.2.5 失败与未知费用

- 已收到 provider usage：按实际 usage 结算；
- 明确未发出请求：释放全部预留；
- 已发出但 usage 未知：记录 `USAGE_UNKNOWN` 并保留预留，暂停该 Run；
- 禁止统一按 200 Token 或 0 Token 猜测。

---

## Phase 3：消息、回执与崩溃恢复

### 5.3.1 持久化消息队列

建议使用一个 V9 专用运行状态文件或轻量日志，例如：

```text
workspace/runtime/v9_message_queue.json
workspace/runtime/v9_runtime_journal.jsonl
```

至少持久化：

- 主队列；
- 延期队列；
- 已消费 message ID；
- 环境读取回执；
- 工具操作回执；
- 当前 round/hop；
- 当前 Prompt revision；
- 当前 open reservation。

写入使用临时文件加原子替换，禁止直接覆盖后留下半个 JSON。

### 5.3.2 消息消费语义

1. 消息只有在本次动作提交成功后才能标记 consumed；
2. 同一个 message ID 最多触发一次付费调用；
3. 基础设施异常后消息仍在持久化队列；
4. Run 正常结束时延期消息保留到下次 Run；
5. 达到 hop/message 上限时延期而不是丢弃；
6. 重启后恢复同一队列，不重新创建天然唤醒消息造成重复调用。

### 5.3.3 reservation 恢复

reservation 不再只存在 `EnergyManager.reservations` 内存字典中。

启动恢复时：

- 已有明确 settle：不得重复结算；
- 明确未发请求：安全释放；
- 调用结果未知：标记 `RECOVERY_REQUIRED`；
- 禁止自动退款后重新调用，因为原请求可能已经产生费用或外部副作用。

### 5.3.4 stale Loop 恢复

应用启动时，如果发现 `RUNNING` Loop 但本进程没有对应 worker：

- 标为 `INTERRUPTED`；
- 不伪装为 `COMPLETED`；
- 显示是否存在待恢复消息、open reservation 或未知外部动作；
- 只有恢复审计通过后才能继续。

---

## Phase 4：动作正确性与 API 修复

### 5.4.1 接通 `owner_request`

V9 scheduler 收到非空 `owner_request` 后：

1. 生成持久化 request ID；
2. 保存请求来源 Pixel、round、message ID、类型和描述；
3. 停止继续产生新的付费动作；
4. UI 展示等待 Owner；
5. Owner 批准或拒绝后形成一条持久化反馈消息；
6. 不允许 Owner 借审批直接注入商业策略。

### 5.4.2 复制原子性

执行复制前一次性验证：

- 目标是直接邻位；
- 目标未占用；
- `child_energy > 0` 且母体余额充足；
- `child_pixel_md` 是字符串且不超过 2000 字；
- 子代目录不存在不完整残留。

全部验证通过后再提交母体扣款和子代创建。任一步失败必须保持母体余额、空间占用和子代目录不变。

### 5.4.3 转账目标验证

转账前必须确认：

- 目标 ID 合法；
- 目标 Pixel 存在；
- 目标 active；
- 目标是直接六邻域；
- 金额合法且余额充足。

失败只生成反馈，不中断整个 Run。

### 5.4.4 修复 Pixel API 路由

- `/api/environment` 只注册环境 handler；
- `/api/pixels/{pixel_id}` 只注册 Pixel handler；
- 增加 API 集成测试验证响应结构，而不是只检查 HTTP 200。

---

## Phase 5：前端可编辑创世提示词

## 5.5.1 数据位置

创世提示词不是文档中的硬编码内容，保存为运行配置：

```text
workspace/runtime/genesis_prompt.json
```

建议结构：

```json
{
  "schema_version": 1,
  "revision": 1,
  "content": "...",
  "sha256": "...",
  "updated_at": "ISO-8601"
}
```

语义：

- `content.strip() == ""` 表示关闭；
- 不再增加独立 `enabled` 开关，避免开关与内容状态冲突；
- 第一次升级且文件不存在时写入本计划第 6 节的初始内容；
- 文件已经存在时绝不覆盖 Owner 的内容；
- Owner 清空后不得因为重启、迁移、checkout 或升级而重新填充默认内容。

## 5.5.2 后端 API

新增：

```text
GET /api/genesis-prompt
PUT /api/genesis-prompt
```

GET 返回：

```json
{
  "content": "...",
  "active": true,
  "revision": 1,
  "sha256": "...",
  "updated_at": "..."
}
```

PUT 请求：

```json
{
  "content": "新的提示词；允许为空"
}
```

约束：

1. 仅允许在 Run 停止时保存；运行中返回 409；
2. 统一换行为 LF；
3. 纯空白保存为真正的空字符串；
4. 设置明确字符上限，建议 12,000 字符；
5. 每次实际变化才递增 revision；
6. 内容相同的重复保存不产生新 revision；
7. 使用原子写入；
8. API 不返回或记录任何模型密钥。

## 5.5.3 前端窗口

在 V9 控制页面增加独立卡片：

```text
创世提示词（临时初速度）
[多行 textarea]

状态：启用 / 已关闭
Revision：N
字符数：X / 12000
Hash：前 12 位

[保存] [清空并关闭]
```

交互规则：

- 页面加载时从 GET API 读取；
- 保存前显示“该提示词会影响之后所有 Pixel 调用”；
- 清空按钮要求一次明确确认，然后保存空字符串；
- Run 进行中 textarea 与按钮禁用；
- 不提供“自动恢复默认内容”按钮；
- 清空后明确提示：已经进入 `pixel.md` 或传播过的内容不会自动删除。

## 5.5.4 LLM 调用组合

V9LLMClient 保留不可变物理 Prompt：

```text
resources/prompts/v9_system_prompt.md
```

Run 启动时读取并锁定当前创世提示词：

```python
effective_system_prompt = base_system_prompt
if genesis_prompt.strip():
    effective_system_prompt += "\n\n[GENESIS_CONTEXT]\n" + genesis_prompt
```

要求：

- 同一 Run 的全部调用使用同一个 revision；
- 每次调用 audit 保存 effective prompt hash 和 genesis revision/hash；
- 不把创世提示词加入三输入 payload；
- 不把创世提示词自动复制进 `pixel.md`；
- Prompt 清空后，下一次 Run 的 effective prompt 只包含物理 Prompt；
- Loop 快照只记录当时 revision/hash 作为实验证据，不在回退时恢复 Prompt 内容。

---

## 6. 建议的初始创世提示词

以下文本作为首次升级时的初始值写入运行配置，不写入 `v9_system_prompt.md`：

```text
你正处在一个尚未被解释、尚未形成稳定结构的开放世界中。

未来可能出现真实问题、有限资源、不同能力、交换、分工、合作、竞争以及稳定关系，但这些都只是可能出现的现象，不是世界预设的目标、身份或正确答案。

底层规则没有规定什么样的 Pixel 更好，也没有规定上下级、组织、专业、价值、利润或成功应该是什么。不要为了迎合某种期待而假装这些结构已经存在。

你的初始方向只有：
1. 主动观察你被允许观察的真实环境与局部反馈；
2. 在有限 energy 下进行小规模尝试，记录结果，并持续修正自己的 pixel.md；
3. 通过局部 message 与直接邻居交换事实、问题、请求、方法或结果；
4. 把未经观察或验证的判断当作假设，而不是事实；
5. 自己决定是否独立行动、协作、转移 energy、复制或停止传播；
6. 可以形成任何自我定义和稳定模式，也可以在证据变化后推翻它们。

不要把任何暂时有效的做法误认为世界规则。只有在长期运行中反复出现并经外部结果支持的模式，才可能被观察者称为这个世界的规律。
```

实验解释：

- 这段内容是人为提供的初始条件；
- 它只提示探索方式和可能性，不规定商业结论；
- 删除后只停止继续注入，不会逆转已经形成的路径依赖；
- 对比实验应分别记录“带创世提示词”和“空创世提示词”的运行结果。

---

## 7. 测试计划

## 7.1 T0 测试

1. `run_isolated_code` 在未配置真实沙箱时固定不可用；
2. artifact 拒绝跨 Pixel、盘符、UNC、`..`、符号链接和 ADS；
3. checkout/branch 不增加总 energy；
4. checkout 不恢复已消费预算；
5. 相同 external transaction 重放 100 次只入账一次；
6. 不同金额复用同一 transaction ID 返回冲突；
7. 退款只能引用已入账交易且不能重复冲回；
8. Pixel、Run、全局任一硬预算不足时不发起模型调用；
9. STOP 后不再发起下一次付费调用。

## 7.2 消息与恢复测试

1. scheduler 重建后待处理消息仍存在；
2. 基础设施故障后重启，原消息只执行一次；
3. 最后一轮留下的延期消息在下次 Run 继续；
4. 工具和 environment 回执不覆盖邻居消息；
5. 进程在 reserve 后、调用前退出，可以安全恢复；
6. 调用已发出但 usage 未知时进入 `RECOVERY_REQUIRED`；
7. stale `RUNNING` Loop 启动后变为 `INTERRUPTED`；
8. 不重复生成 natural wake 消息。

## 7.3 动作测试

1. 超长 child mind 不扣母体 energy、不创建目录；
2. 复制中任一步失败均不产生部分状态；
3. 向空邻位、死亡邻居或非法 ID 转账只返回反馈；
4. 合法转账仍保持总 energy 守恒；
5. V9 `owner_request` 可见、可审批、可恢复；
6. Pixel 详情 API 返回 Pixel，环境 API 返回环境。

## 7.4 创世提示词测试

1. 初次升级创建非空初始 Prompt；
2. GET/PUT 正确保存 Unicode、多行文本和 revision；
3. 空白内容被保存为空并关闭；
4. 清空后重启仍为空；
5. checkout 旧 Loop 不恢复旧 Prompt；
6. 非空 Prompt 出现在每次调用的 effective system prompt；
7. 空 Prompt 完全不注入 `[GENESIS_CONTEXT]`；
8. 三输入 payload 仍只有 `state`、`pixel_md`、`message_md`；
9. 同一 Run 中 Prompt revision 不变化；
10. Run 进行中更新返回 409；
11. audit 和 Loop meta 保存正确的 revision/hash；
12. 前端清空、保存、状态显示和字符计数正确。

## 7.5 回归验收

- 当前全部测试继续通过；
- 新增测试全部通过；
- 测试必须覆盖 UI 实际使用的 SnapshotManager，而不是测试另一套未接入实现；
- 使用 Mock LLM 跑至少 100 Round，确认消息不丢、预算守恒、重启可恢复；
- 使用最小真实费用配置跑短流程，确认账单、usage、energy 和硬预算一致；
- 真实费用测试只证明计费闭环，不证明商业涌现。

---

## 8. 建议提交顺序

为便于审查和回退，建议拆成以下独立提交：

1. `fix(v9): disable unsafe host execution and enforce artifact ownership`
2. `fix(v9): make revenue credits idempotent and guard unsafe snapshots`
3. `fix(v9): persist message queue reservations and interrupted runs`
4. `fix(v9): enforce real cost accounting and hard run budgets`
5. `fix(v9): make reproduction transfers and owner requests atomic`
6. `fix(ui): repair pixel route and add editable genesis prompt panel`
7. `test(v9): add restart rollback billing and genesis prompt coverage`

每个提交只处理对应范围，不夹带重构、格式化或历史 workspace 清理。

---

## 9. 最终验收门槛

只有全部满足以下条件，才能恢复长期或真实付费实验：

- 模型不能直接执行宿主代码或越界读文件；
- checkout、branch、重启和消息重放都不能增加预算；
- 外部回款、退款和模型费用可去重、可追溯；
- Owner 的硬费用上限不可绕过；
- 消息、回执和 reservation 在进程退出后仍可恢复；
- 复制、转账和 owner request 不产生半完成状态；
- 前端可编辑创世提示词，清空后永久保持关闭；
- 每个 Run 都能回答“使用了哪个创世提示词 revision”；
- Prompt 为空时，系统仍能依靠原始物理规则继续运行；
- 观察报告明确区分“人为创世初速度”和“之后自发形成的稳定模式”。

