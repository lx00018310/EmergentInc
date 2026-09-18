# EmergentInc V11 当前主流程整改计划（T0 / T1）

## 1. 审查基线与结论

- 计划基线：`3b1147771ba9290778cbde718b65caeca83eb5a0` 中的 `EmergentInc_V11_Minimal_Historical_Economy_Plan.md`
- 代码基线：`6ec45cf31d3aad82b925c4683287c7a59d369513`（包含 `7355495`、`6ec45cf` 两轮修复）
- 现场页面：`http://127.0.0.1:8765/`
- 审查时间：2026-09-17

结论：V11 的页面入口、Human Mandate、External Reward、Step Cost、artifact transfer 等形态已经出现，但当前版本不能通过 V11 最终验收。核心原因不是功能缺少，而是安全边界、调用结果语义、恢复流程、五层上下文来源和成本展示仍不可信。

本计划只处理 T0 / T1，不扩展 market、company、role、skill 等高层机制。

## 2. 已确认问题

### T0-1：本地 API 可被任意网页跨域调用，artifact 路由可穿越到 `workspace/private`

现场证据：

- 服务对任意 `Origin` 回显 `Access-Control-Allow-Origin`。
- `GET /api/pixels/..%5C..%5Cprivate/artifacts` 成功列出 `workspace/private`。
- 使用同类路径成功读取了非敏感的 `workspace/private/README.md`，证明隔离已被绕过；未读取凭据正文。

风险：任意已打开的恶意网页都可能读取本机私有资料，或调用 POST/PUT/DELETE 接口启动运行、修改环境、发奖励。

涉及：

- `apps/server/src/app.ts`
- `apps/server/src/routes/api_routes.ts`
- `apps/server/src/services/world_service.ts`

### T0-2：`UND_ERR_SOCKET` 被当成“请求未发出”，自动退款并重试

现场错误是 `SocketError: other side closed / UND_ERR_SOCKET`。该错误可能发生在请求已发送甚至远端已计费之后，结果只能判定为 unknown，不能判定为安全失败。

当前链路：

1. Provider 把所有非 abort 的 fetch 异常归为 `InfrastructureFailureError`；
2. AgentStepRunner 立即退款并把消息放回队列；
3. 下一次运行会再次调用，存在重复计费和重复副作用风险。

涉及：

- `packages/model/src/provider/openai_compatible.ts`
- `packages/runtime/src/agent_step/agent_step_runner.ts`

### T0-3：恢复门禁遗漏未知工具副作用，且“安全对账”实现本身不安全

已确认四个缺陷：

- `RunService` 只检查 reservation / unknown model call / calling message，忽略旧 `RUNNING` run 和 `STARTED` tool execution。
- 进程若在外部工具执行中崩溃，下一次运行仍可启动，可能重复外部副作用。
- `reconcileUnfinalizedOperations()` 会退款 `CALL_OUTCOME_UNKNOWN` 并重新入队，等价于把“未知”擅自判成“未发生”。
- 对 `STARTED` tool 的修复 SQL 写入不存在的 `error_text` 列；内存库实测报错 `no such column: error_text`，整个事务回滚。

涉及：

- `apps/server/src/services/run_service.ts`
- `packages/persistence/src/core_store.ts`
- `packages/persistence/src/migrations/init_schema.ts`

### T0-4：External Reward 没有幂等键，响应丢失后重试会重复加 Energy

当前服务端用 `Date.now()` 生成事件 ID。若数据库已提交但 HTTP 响应丢失，客户端再次提交会生成第二笔不可撤销奖励。前端警告用户“不要重复提交”不能替代服务端幂等。

涉及：

- `apps/server/src/routes/api_routes.ts`
- `packages/persistence/src/core_store.ts`
- `frontend/src/api/pixels.ts`
- `frontend/src/features/pixels/PixelOperations.tsx`

### T1-1：实际运行失败，但首页显示绿色 `READY`

现场 API 返回：

```text
result_status = FAILED
stop_reason = INFRASTRUCTURE_FAILURE
last_error = null
```

页面却显示 `系统状态: READY`。RoundScheduler 只上报 stop reason，丢失具体异常；RunStatus 又只检查 `last_error`，没有检查 `FAILED`。控制台仅记录“启动成功”，异步失败不会进入页面日志。

涉及：

- `packages/runtime/src/scheduler/round_scheduler.ts`
- `apps/server/src/services/run_service.ts`
- `frontend/src/features/run/RunStatus.tsx`
- `frontend/src/features/run/ConsolePanel.tsx`

### T1-2：运行控制命令被广播成 Human 消息，失败会持续放大队列

现场数据库已有 20 条未消费 Human 消息：4 次运行 × 5 个活跃 Pixel，内容是 `跑1轮` / `跑10轮`。

当前前端只接受运行控制语法，却把同一字符串作为 `command` 发送；后端再向每个活跃 Pixel 广播。运行失败后消息保留，下一次运行按全局 FIFO 继续处理旧消息，新请求并不决定实际执行内容。

涉及：

- `frontend/src/features/run/RunControls.tsx`
- `apps/server/src/services/run_service.ts`
- `packages/persistence/src/repositories/message_repository.ts`

### T1-3：V11 五层上下文仍未严格分离

已确认三处来源错误：

- `source_type = human` 的消息仍放入 `LOCAL MESSAGES`，而计划要求 Human instruction 属于 `EXTERNAL`。
- runtime 每次模型调用都自动读取并注入完整 `environment.md`；V9/V10 继承规则和当前页面文案均要求 Pixel 主动 `environment_read` 后才可见。
- 现场还有 31 条 legacy `engine_feedback` 消息；新枚举已删除该类型，runtime 会把其中 11 条待处理消息误放入 `LOCAL MESSAGES`。

涉及：

- `packages/runtime/src/agent_step/agent_step_runner.ts`
- `packages/persistence/src/repositories/message_repository.ts`
- `packages/persistence/src/migrations/init_schema.ts`
- `frontend/src/features/environment/EnvironmentEditor.tsx`

### T1-4：工具目录宣称 Enabled，但能力实际不可用

页面和模型 prompt 把 `vps_exec`、`vps_read_file`、`vps_write_file`、upload、download 标成 Enabled；源码明确返回 `native implementation pending`。现场已有 5 次 `vps_exec` 和 1 次 `vps_write_file` 因此失败。

这会诱导模型产生无法执行的计划并消耗 Token。

涉及：

- `packages/tools/src/builtin/vps.ts`
- `packages/tools/src/registry.ts`
- `workspace/private/tools.json`
- `apps/server/src/routes/api_routes.ts`

### T1-5：成本台账在数据库、API、页面三层不一致

已确认：

- 数据库模型成本合计为 `0.009057 CNY`，`/api/world` 却硬编码 `total_spent_cny: 0.0`。
- Step Cost API 丢弃 `callId / runId / outcome`，页面整列显示“未知”。
- 181 条历史记录因迁移默认值被显示为 Round 0；这实际是“历史轮次未知”，不是真实 Round 0。
- 工具成本存在未知值时，汇总不能把未知当作 0。

涉及：

- `apps/server/src/services/world_service.ts`
- `packages/persistence/src/repositories/model_call_repository.ts`
- `packages/protocol/src/types/model.ts`
- `frontend/src/api/types.ts`
- `frontend/src/features/pixels/PixelOperations.tsx`

### T1-6：成功响应缺少 usage 时会形成无法解除的永久锁

当模型响应成功但 usage 缺失时：

- `BudgetRepository.settle()` 保留 OPEN reservation；
- 消息仍被标记 `RESPONSE_STORED`；
- 启动门禁随后阻止新运行；
- 自动 reconcile 又明确不退款这类 reservation；
- 系统没有“按供应商账单结算 / 按预留上限结算 / 人工确认”入口。

涉及：

- `packages/persistence/src/repositories/budget_repository.ts`
- `packages/persistence/src/core_store.ts`

### T1-7：付费但无效的模型响应会无限重试同一消息

现场已有两次 `MODEL_RESPONSE_INVALID`，completion tokens 分别为 8192 和 9479。当前逻辑每次都把同一消息放回 QUEUED，没有重试次数、退避或终止状态，可能持续消耗预算。

涉及：

- `packages/runtime/src/agent_step/agent_step_runner.ts`
- `packages/runtime/src/scheduler/round_scheduler.ts`

### T1-8：执行记录时间字段契约断裂

后端返回 `started_at`，前端 DTO 和组件读取 `created_at`，所以页面全部显示 `Invalid Date`。执行记录是恢复和审计依据，不能视为纯样式问题。

涉及：

- `apps/server/src/routes/api_routes.ts`
- `frontend/src/api/types.ts`
- `frontend/src/features/tools/ToolExecutionHistory.tsx`

### T1-9：当前自动化测试通过，但没有完成计划要求的真实实验验收

当前 143 个根测试和 37 个前端测试均通过；`v11_historical_economy.test.ts` 已明确声明使用 scripted provider，不证明真实付费 LLM 的历史成本差、交换动机和稳定行为差异。因此 V11 机制测试通过，不等于计划第 18 节最终验收通过。

## 3. 整改顺序

### Phase 0：冻结高风险入口并保全现场

1. 在完成 T0 前不要继续正式运行，不点击当前“安全对账”。
2. 备份 SQLite、`world_state.json` 和待处理消息 ID；不改写原始现场证据。
3. 导出当前 20 条控制命令污染消息、31 条 legacy `engine_feedback` 和两条 invalid response 的审计清单。

验收：备份可恢复，现场数据数量与整改前一致。

### Phase 1：修复 T0 安全与结果语义

1. 建立统一 canonical path containment helper：
   - `pixel_id` 必须对应已存在 Pixel；
   - 对 Windows `\`、URL 编码、`.`、`..`、盘符和 UNC 路径全部拒绝；
   - 用 `path.relative()` 判断目标必须位于允许根目录内，禁止字符串 `startsWith()` 判定。
2. 生产模式关闭宽松 CORS，只允许同源；开发模式显式 allowlist，不允许任意 Origin。
3. 传输错误采用保守分类：
   - 仅能证明请求未发送的错误才允许 refund；
   - `UND_ERR_SOCKET`、响应体中断、5xx、timeout、abort after dispatch 全部进入 `CALL_OUTCOME_UNKNOWN`；
   - 保存底层 error code、阶段和可展示摘要。
4. 重做 recovery decision：unknown 不自动退款、不自动重试；由操作员选择“确认未计费后退款重试 / 按账单结算 / 放弃重试”，每次决定写审计记录。
5. 启动门禁统一使用 `getUnfinalizedOperations().hasUnfinalized`，覆盖旧 RUNNING run 和 STARTED tool。
6. 修正 STARTED tool reconcile SQL，写入现有 `result`、`finished_at` 字段；不得引用不存在列。
7. External Reward 接收客户端 `idempotency_key`，以唯一约束保证同键只入账一次，重复请求返回首次结果。

Phase 1 验收：跨域与穿越测试全部拒绝；所有 unknown 路径不会自动退款或自动重试；重复 reward 只产生一笔 ledger entry。

### Phase 2：修复 T1 主流程与可观测性

1. 分离控制面与 Agent 输入：
   - “跑 N 轮”只设置 rounds，不创建 Message；
   - Human Mandate 继续作为每 Pixel 独立 EXTERNAL；
   - 不新增复杂全局任务协议。
2. 一次性处理已污染队列：在人工确认 ID 清单后，仅移除/隔离由运行控制产生且仍为 QUEUED 的 20 条消息，保留审计证据。
3. 修正来源路由：human/material/environment/feedback/system 均进入 EXTERNAL；只有 Pixel 邻居消息进入 LOCAL MESSAGES。
4. 恢复 environment 按需可见：只有 `environment_read` 产生的 environment message 在下一跳进入 EXTERNAL，不再每步自动读取文件。
5. 数据迁移把 legacy `engine_feedback` 归一为 `feedback`，并补迁移测试。
6. 工具注册以“当前配置下实际可执行”为 Enabled 条件；未实现 VPS 工具不进入 prompt 和 UI catalog。
7. 运行状态持久化并展示 `result_status / stop_reason / error_code / error_summary`；FAILED、STOPPED、RECOVERY REQUIRED 不得显示 READY。
8. “安全对账”按钮仅在 recovery_required 时出现；无未决项时不得清空上次失败原因。
9. 修复执行记录 `started_at` 契约，并展示 started/finished 时间。
10. 修复成本链：
    - Step Cost 返回 callId/runId/outcome；
    - legacy round 显示未知而非 0；
    - world 汇总来自真实 model/tool ledger；任何组成未知时整体显示未知，不补估算。
11. usage 缺失必须进入显式待结算状态，并提供人工结算路径。
12. `MODEL_RESPONSE_INVALID` 最多重试一次；第二次进入终止状态并保留 raw response、解析错误位置和已花费成本。

Phase 2 验收：页面状态与 `/api/run/status` 一致；一次点击跑 N 轮不会新增 Human 消息；五层 prompt 的来源断言通过；工具目录无假能力；执行时间和成本来源可追溯。

### Phase 3：验证与 V11 最终验收

必须新增以下自动化测试：

1. `%5C`、`%2F`、双重编码和 Windows 盘符 artifact traversal。
2. 非 allowlist Origin 不能读取或修改本地 API。
3. `UND_ERR_SOCKET`、响应截断、timeout、DNS/连接拒绝的分类与账务断言。
4. unknown model/tool operation 不自动退款、不自动重试。
5. STARTED tool 与旧 RUNNING run 会阻止启动，reconcile 不报 SQL 错误。
6. reward 相同 idempotency key 重放只入账一次。
7. 快捷运行不入队 Human 消息；连续失败不放大队列。
8. Human instruction 位于 EXTERNAL，Pixel message 位于 LOCAL MESSAGES。
9. environment 只在主动读取后的下一跳出现。
10. legacy `engine_feedback` 迁移为 feedback。
11. FAILED / STOPPED / RECOVERY 状态的 UI 集成测试。
12. tool executions 使用 `started_at`，Step Cost 保留调用来源，未知成本不显示 0。
13. invalid response 有重试上限；usage 缺失可人工结算后解除门禁。

自动化通过后，再执行计划中的三个实验。真实模型实验必须单独设定费用上限并取得批准；scripted provider 结果只能作为机制测试证据，不能作为最终实验结论。

## 4. 完成标准

只有同时满足以下条件才可标记 V11 完成：

- T0 全部关闭，安全回归测试通过。
- T1 主流程与页面状态一致，运行失败可在页面直接诊断。
- External / Pixel Self / Pixel Files / Local Messages 来源可从真实 runner 请求中验证。
- 所有成本值要么来自真实台账，要么明确为未知，不出现伪 0。
- 真实模型三个实验有可复核的 run、message、model call、tool execution、ledger 证据。
- 不为了实验结果新增 role、market、company、profession 等规则。
