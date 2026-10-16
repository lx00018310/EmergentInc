# 流程解耦修复记录 / Process decoupling fixes

检查日期：2026-10-15。基于 `af297ef` 之后的 main 工作区。已修复维护暂停继承、预算提示遮蔽其他问题，以及后续检查发现的五处流程耦合；复用现有调度和执行检查，没有增加统一流程引擎。

Scope: the main working tree after `af297ef`. Maintenance pause inheritance, incomplete chat diagnostics and all five audited couplings are fixed using the existing scheduler and execution checks.

## 维护状态与聊天 / Maintenance and chat

- `supervisor/local_world_runtime.ts` 移除重复的 `resume-intent.json` 流程。健康检查通过后总会请求结束维护；公司开关、预算和待核对调用仍以已有持久化记录为准。
- `apps/server/src/routes/owner_routes.ts` 的免费报告读取本地公司、任务和人物配置，不再依赖完整总览。报告同时说明预算、开关、未知调用及历史能量等待；不把已开启无限能量的人物继续描述为缺能量。中英文同步。
- 保留既有进程身份检查，新增维护与公司权限互不改写的回归。状态查询不调用模型、不批准预算，也不启动任务。

Maintenance exit no longer inherits a duplicate pause file. Free chat diagnostics use local records, report all known blockers and distinguish stale energy waits from current configuration. They do not call a paid model or change authorization.

## 五处耦合的修复 / Five audited couplings fixed

| 原流程 / Previous coupling | 修复后 / Result | 验证 / Evidence |
| --- | --- | --- |
| 公司审批、编辑或控制请求等待恢复任务和调度；调度失败导致已提交的审批返回失败。 | 请求返回已记录的业务决定。现有调度独立恢复和推进任务，异步失败仍进入已有暂停/错误报告。 | 注入调度、恢复异常，预算审批仍返回成功且持久化一致；开启经营不在请求内调用模型。 |
| Gene 方向批准后立即等待候选准备；准备失败导致审批误报失败，原审批重试冲突。 | 方向审批只记录决定。批准后单独“准备或重试候选”，校验当前代和批准状态；合并同一候选的并发准备，复用已写入的候选请求。 | 准备失败后方向仍为 APPROVED；无需重复批准即可重试。未登录、未批准、过期代次及并发请求均有回归。中英文按钮及错误提示通过。 |
| 先解除维护再串行启动服务；中途失败后重试直接返回。 | 服务初始化成功后才解除维护；Business、Dream、付款监控的启动可重复调用。初始化失败保留维护暂停，重试补齐；执行恢复交给调度。 | 真实 bootstrap 注入 Business 启动故障，首次失败仍为维护暂停；重试成功且没有重复定时器；停止后再次启动成功。 |
| 补能量、设置无限能量隐式新建 Run。首次打开 World 也可能恢复暂停任务。 | 补能量只更新资源；打开 World 只初始化运行对象。恢复执行统一交给已有显式执行入口或获授权的调度。 | 既有补能量测试改为验证资源与执行分离；真实暂停任务关闭 World 后补能量，不调用模型、不执行工具，调度恢复时沿用原 Run。 |
| 批准金额预算直接把 Goal 改为 READY、工作记录改为 RUNNING。 | 预算审批只确认额度；调度在公司获准运行时解除金额等待，运行状态根据实际 Run 更新。 | OFF 时批准和调度均不改任务状态；ON 后调度才解除等待；审批不会制造运行记录。 |

Approval receipts are independent of execution. Gene preparation is separately retryable. Maintenance exits only after service initialization succeeds. Energy funding and World opening no longer start work. Budget approval changes only the money ledger; scheduling and actual Run observations update task state.

## 验证 / Validation

- 五项解耦专项：5 项通过，包含真实维护恢复、暂停任务、独立审批/准备、并发准备和权限检查。
- 前端全部 203 项通过；新增候选准备及重试流程分别验证中英文。
- 类型检查与前端生产构建通过。
- 完整候选模式回归：122 个文件通过、4 个文件按既有规则跳过；1036 项通过、0 失败、4 项跳过，Vitest 耗时 279.77 秒。

Targeted decoupling checks passed (5 tests). All 203 frontend tests, type checking and the production frontend build passed. The full candidate-mode regression passed 1036 tests across 122 files in 279.77 seconds, with zero failures and the four existing candidate-mode exclusions.

本机完整回归日志和逐项结果：`cache/process-decoupling/full-tests.log`、`full-tests.json`。原问题隔离复现：`cache/maintenance-decoupling/coupling-audit-evidence.json`。测试使用临时数据库及模型替身，不操作在线审批、预算和收费模型。

Full regression logs are in `cache/process-decoupling`. Original failure reproductions are in `cache/maintenance-decoupling`. Tests use temporary databases and model substitutes.

## 当前实例与生效范围 / Current instance and release scope

G0034 已通过已有接口结束维护，处理后服务 `ready`、公司 `OFF`，真实阻塞为 `OWNER_OUTCOME_REVIEW_REQUIRED`。1 笔待核对调用和未授权金额预算保留；当时前后比对公司控制、预算、调用及代次记录一致。本机证据：`cache/maintenance-decoupling/live-maintenance-exit.json`。

G0034 exited maintenance through the existing API and remained OFF, with one unresolved call and an unapproved money budget. The recorded comparison found company control, budget, calls and generation unchanged.

最终只读复查仍为 G0034 ready、OFF、1 笔待核对调用、金额预算未授权，记录于 `cache/process-decoupling/live-state.json`。代码修改在 main，正常版本维护发布后生效；本轮没有修改当前冻结版本，也没有自动发布。

The final read-only check confirmed the same live state. Source changes are on main and take effect through normal approved version maintenance. The current frozen release is unchanged.

## 保留的约束 / Preserved constraints

未知结果必须先核对、收费需要明确金额授权、发布必须绑定准确批准的候选。这些属于执行和账本约束，继续保留。

Unknown outcomes still require verification, paid work still needs explicit money authorization, and publication still binds the exact approved candidate.

## 2026-10-16 历史金额缺失 / Historical missing cost

G0030 的一笔 `glm-5.3-flash` 调用已保存回复，输入 6948、输出 1431、缓存 2688，合计 8379 Tokens 已结算。原冻结版本将缓存价格写成 `cached_input_cost_per_million`，计费器读取 `cached_cost_per_million`，所以该次缓存命中未算出金额。原冻结版本完整性及套餐价格已核实；按当时统一 0.025 元/百万 Token 的套餐摊销口径，补录历史金额 ¥0.000209，不产生新增扣费。

The stored response and 8379-token settlement were complete. The original frozen release used the wrong cached-price key, leaving only the cost missing. Its integrity and uniform subscription rate were verified; the historical amortized amount is CNY 0.000209, with no new provider charge.

恢复方法现在允许为已结算 Token 的成功/无效回复补录明确金额，要求 Token 数保持一致，不再次结算 Token，也不重放回复。公司在全部真实未知项解决后清理旧停止原因，保留 OFF；仍有其他未知项时继续阻断。在线修复审计编号：`459aa0c6-acee-4275-8129-3751b4c9f724`。

Recovery can supplement a verified missing cost for an already settled response without changing tokens or replaying it. Company review reasons clear only when all unknown outcomes are resolved; OFF is preserved. The repair has an explicit recovery audit record.

验证：12 个相关测试文件中 106 项不同用例通过，类型检查通过。最终 G0036 为 ready、OFF，待核对调用 0、原因为空，中英文状态查询消耗 0；金额预算授权未改变。原回复、Token、能量、任务、Run 和预留记录前后相同。本机证据：`cache/historical-cost-repair/verified-price.json`、`live-repair.json`、`final-api-check.json`。当前冻结发布源码未改动。

Validation: 106 distinct relevant tests across 12 files and type checking passed. G0036 is ready and OFF, with zero pending calls. Bilingual status checks cost zero tokens. Response, energy, tokens, tasks, Runs, reservations and budget authorization were preserved. The frozen release source is unchanged.
