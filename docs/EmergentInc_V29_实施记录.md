# EmergentInc V29 实施记录 / Implementation Report

日期：2026-10-13。基准：`86b133e2892db1e4f14e153df86a41b785ed3867`，工作分支 `develop`。本记录描述开发候选；没有部署，没有调用真实付费模型或真实钱包。

## 交付范围

P1：经营目标 SQLite 管理、快照、CAS、幂等、暂停/继续/停止/重开/软归档/恢复；Owner 首页以目标为主，保留聊天、待办、历史与高级页面。

P2：单一持久化执行许可，默认 OFF；共享轮数与 Token 授权；每个自主片段 1 轮；真实检查点恢复；安全挂起；World、Owner 派工、业务调度、Dream、能量唤醒和模型/工具边界共同执行许可。

P3：文件、指定发票收款与人工源证据验收；目标例外待办；重要事件去重投影；无模型的运行报告；未知费用审计对账；中英文界面、README 和 Owner 运维附录。

普通目标默认要求人工对照源证据核实。选择文件规则才自动核验文件交付；选择发票规则只核验对应收款。预算模板只填入 100000 Tokens，保存目标/点击开启前不会授权或调用模型。没有人物时提出招聘审批，不自动创建人物；招聘模型费用归入对应目标预算。批准招聘不会覆盖 Owner 对目标的暂停状态。

## 持久化与状态

继续使用 `system/control/control.sqlite3`，第一次添加 Goal 表前通过 `VACUUM INTO` 写同目录 `.pre-v29.bak`，包含已提交 WAL 数据。现有表、订单、支付、人物和历史派工不做物理删除。

新增控制表：

- `owner_goals`、`owner_goal_revisions`、`owner_goal_events`。
- `owner_goal_steps`、`owner_goal_dispatches`、`owner_goal_recruits`。
- `owner_goal_evidence`、`owner_control_requests`。
- `owner_automation_control`、`owner_run_permits`、`owner_round_permits`。
- `owner_model_permits`、`owner_model_sources`。

`revision` 校验 Owner 的并发修改；`specificationRevision` 仅在编辑目标/验收/预算时增加，用于旧任务、招聘批准、模型费用及证据的准确归属。状态变化不会把旧批准套给新的目标说明。目标用量累计包含此前修订。

每次写请求使用持久化幂等键，重复请求必须保持完整请求体相同。旧 revision 返回 409。重复旧 OFF 不会暂停后来授权的 ON。归档恢复为 PAUSED；COMPLETED/STOPPED 的重开要求显式操作。未知调用不能靠重开目标清除。

公司期望 ON/OFF 与真实 STOPPED/RUNNING/IDLE/STOPPING/BLOCKED/LIMIT_REACHED 分开；没有可执行目标时不制造 Run 或模型调用。维护优先于 ON。全局 OFF 不修改目标原定生命周期。

### 轮次与费用依据

派发前写 PREPARING Run 与 RESERVED 轮次许可，真正开始轮次时改 STARTED；唯一键为 `(run_id, round_no)`。完整轮次后改 COMPLETED。中断的 STARTED 不退还，不按消息或模型次数重复计轮。重启与真实 Run 检查点对账；只有确认 core Run 不存在，才释放未开始许可、恢复原 QUEUED 任务。

Owner Goal 单次派发 1 轮，受管 Run 最高 20 轮，Owner Run 的 100000 Tokens 原限制保留。旧单库模式的运行语义没有套用新的 20 轮限制。多个目标公平共享总轮数；单目标暂停不妨碍其他合格 World 推进。

模型请求前按 UTF-8 字节数、输出上限和保守余量预留 Tokens，同时检查公司、目标和现有 Run 的剩余额度。原始调用 ID、实际用量和已知人民币费用持久化；控制投影不再次累加原账本同一费用。部分已知用量只预留剩余未知部分。定价/用量不明、供应商报告超预留、外部结果未知均关闭或阻塞执行，保留账单和回执。

World 收件消息 ID 从人物和请求键稳定导出；在 World 写入后、control 写入前断电，重试复用同一条消息。Goal 运行只能处理自己的收件作用域；手动 Run 不能接管暂停目标的队列，也不能覆盖其检查点。终止/完成的片段保留消息审计，并退役尚未开始的旧续作。

## Gate 挂载点

| 挂载点 | 执行边界 |
| --- | --- |
| `RunService.start` | Core Run 创建前检查公司许可、共享额度、目标修订与单并发；人工启动也受限 |
| `RunService.resumeInterrupted` | OFF、未知结果或失效目标不得续跑；复用原 Run 和原预算 |
| `RunService.runLoop` | 每轮确认许可，完整检查点后记完成；安全挂起保留原轮次 |
| `WorldRuntimeManager.open/resumeInterrupted` | 打开 World 先对账；不自动采用没有 V29 许可的旧 Run |
| `AgentStepRunner.beforeStep` | 检查原收件人/目标作用域，防手动 Run、旧消息、已保存响应绕过目标许可 |
| `EffectRuntime.shouldSuspend` | 已收费响应先保存；OFF 后不开始新的未应用副作用，后续可复用 |
| `ToolRuntime.beforeExecute` | 工具执行前再次检查；内部草稿/纯技能白名单，外部写动作拒绝普通 Goal 自动授权 |
| `OwnerWorkService.dispatch/tick/energy` | 不领取 OFF 队列，不新建聊天/Run，不因补能自动绕过 OFF；Goal 片段由公平调度器领取 |
| `QianjiWorldGateway` / QIAN / YUAN | 收件与 Run 入口共同守门；跨库幂等恢复不重复付费任务 |
| `OwnerChat` / Gacha / Goal 招聘 | 模型统一预留；招聘仍需 exact request/hash 的 Owner 审批，关联 Goal 时计入其预算 |
| `BusinessService` | 定时任务、方案、复盘、Body 模型共同守门；原业务批准仍必需；在途业务片段计入 STOPPING |
| `DreamService` | OFF 不触发日常 Dream；维护 Final Dream 只保留源事实与审计回执，不生成虚假模型总结 |
| `8766 Supervisor` | quiesce 优先；禁止自主回退/删除；V29 目标/控制事实存在时，拒绝回退到缺少 Gate 模块的旧版本 |

公共商店、公开订单、付款监听/确认、收入投影、Owner 登录/查询、审计与独立 8766 维护不由此开关停服。已经被第三方受理的操作只收尾、记账或待核实，不补发。

## 验收与 API

文件证据来自成功的 `save_artifact` 回执与不可变快照，再核实字节和 SHA-256。相同内容不反复算新证据。模型报告单独标为 report，不能自动完成经营目标。

发票规则必须绑定 Owner 指定的准确 invoice IDs；只统计 `chain_finalized` receipt、FINALIZED invoice 与对应收入行的交集。OBSERVED、无关发票或文本“已成交”不计入。付款投影在公司 OFF 时仍可更新。

人工验收仅接受当前修订的真实源产物/支付证据 ID，并记录 Owner 的核实理由和冻结哈希；报告本身不能通过。此决议不写收入或客户账本。

| API | 用途 |
| --- | --- |
| `GET/POST /api/owner/goals` | 查询/确认新目标 |
| `GET/PATCH /api/owner/goals/:id` | 详情/新规格修订 |
| `POST /api/owner/goals/:id/actions` | pause/resume/stop/reopen/archive/restore/verify |
| `GET /api/owner/goals/:id/evidence/:evidenceId` | 校验后读取准确文件证据，拒绝哈希变更/路径越界 |
| `GET/POST /api/owner/automation` | 真实状态/授权与停止/修改本次额度 |
| `GET /api/owner/automation/report` | 当前批次按目标聚合证据、费用、阻碍，无额外模型调用 |
| `GET /api/owner/automation/calls` | 未知控制调用与原始调用 ID |
| `POST /api/owner/automation/calls/:id/reconcile` | Owner 依据账单确认 Tokens、人民币金额与理由；不能替代原 World/Business 恢复决议 |

全部使用现有 Owner 会话与 Origin 防护，写接口校验字段、幂等键与相应 revision，不接受模型返回的路径/SQL/handler。普通发布仍须原业务审批；代码发布仍须 8766 exact-hash 批准。

## 隔离 E2E 日志摘要

所有下述经营数据均为测试数据，模型与链证据均为模拟，未连接真实钱包或付费 API。

```text
Scenario: two continuing Goals, shared BOUNDED 7
  same existing two Worlds; one round per Run
  actual World Runs share 3 and 4 started rounds
  desiredMode=OFF, observedState=LIMIT_REACHED
  startedRounds=7, completedRounds=7, reservedRounds=0

Scenario: 10000 permits, injected interruptions
  10000 distinct (run_id, round_no) starts; repeated marks are idempotent
  started=10000, completed=6667, reserved=0; automatic OFF
  this is a permit-ledger stress test, not 10000 paid model rounds

Scenario: SIGKILL after paid response/tool receipt
  OFF restart: zero new model calls, no implicit continuation
  ON restart: original response/tool receipt reused once
  same started round remains 1; completed becomes 1
  known tokens=60 (original 30 + one new feedback call 30)

Scenario: SIGKILL after dispatch before response
  source call remains unknown; reservation retained
  zero automatic retransmissions; new ON rejected pending review

Scenario: goal pause/stop/archive during a response
  returned tools do not execute under revoked/paused authorization
  another eligible Goal continues
  pause/resume reuses its checkpoint; manual takeover is rejected

Scenario: evidence
  real immutable draft -> verified file goal
  unverified claim of three customers -> WAITING_APPROVAL
  confirmed-only invoice -> no result; finalized exact receipt -> verified
  explicit Owner source verification -> audit decision, no invented revenue
```

浏览器预览使用实际 Owner React 组件与明确标识的隔离模拟数据。英文桌面和中文 390×844 窄屏已检查；窄屏 DOM `scrollWidth=390, innerWidth=390`，无横向溢出。输入框实际背景 `rgb(255,255,255)`、文字 `rgb(21,44,60)`，修复了旧全局深色样式覆盖。预览标签页、临时 HTML 和 Vite 服务均已关闭/清理。

## 最终验证

- `pnpm.cmd typecheck`：通过，包含服务端与前端 TypeScript 检查。
- `npm.cmd --prefix frontend run build`：通过；Vite 保留已有大 chunk 提示。
- `pnpm.cmd test --maxWorkers=1`：退出码 0；113 个测试文件通过，2 个跳过；946 项通过，2 项跳过，总计 948 项，耗时 914.06 秒。日志：`cache/v29-tests-complete.log`（本地忽略目录）。
- `git diff --check`：通过。

| 阶段 / 风险 | 最终回归依据 | 结果 |
| --- | --- | --- |
| P1 持久化、旧 revision、重试、鉴权 | `owner_goals.test.ts` | 3 项通过 |
| P2 OFF、10000 唯一轮次、预留恢复、未知费用、幂等授权 | `owner_global_automation.test.ts` | 8 项通过 |
| P2/P3 多目标真实 Run、暂停隔离、招聘预算、原始证据与精确付款 | `owner_goal_scheduler.test.ts` | 10 项通过 |
| P2 强制杀进程、OFF 不续跑、ON 复用回执、未知请求不重发 | `owner_goal_recovery.test.ts` | 3 项通过 |
| V29 控制事实与回退兼容 | `owner_automation_rollback.test.ts` | 1 项通过 |
| 8766 原有冻结版本/升级边界 | `local_upgrade.test.ts` | 13 项通过 |
| 真实进程：重启、批准后的代际升级、兼容回退、公开订单与收款留存 | `world_process_generation.test.ts` | 1 项通过，含候选冻结版本完整验收 |
| 双语目标主入口、草稿和重试状态、STOPPING、文案键一致性 | `frontend/tests/owner_goals.test.tsx` | 6 项通过 |
| 原 Owner/Business/Dream、公共订单/支付、源代码审批等 | 完整回归中其余测试 | 通过 |

两项可选进程测试未运行，不能把它们记为通过：`owner_version_process.test.ts` 需要外部真实历史 Release（`EMERGENTINC_TEST_V23_RELEASE`）；`upgrade_web_process.test.ts` 需要显式的完整维护页面演练开关（`EMERGENTINC_TEST_UPGRADE_WEB=1`）。本次实际进程升级/回退覆盖由 `world_process_generation.test.ts` 提供，维护页面路由/双语错误由正常回归覆盖。

English validation summary: TypeScript and the frontend production build passed. The complete single-worker suite passed 946 tests, with two opt-in process tests skipped. Actual restart, approved generation upgrade and compatible rollback were exercised by the passing World process test. Skipped tests are not treated as successful evidence.

已确认的 Windows 测试环境问题：随机动态端口可能被系统排除并返回 EACCES，测试辅助函数仅对此 Windows 错误换一个端口；部分 SQLite/进程初始化用例在嵌套候选验收下超过旧 5 秒上限，保留断言并延长已确认用例的 I/O 上限。没有跳过失败的功能断言。

## 实际边界

- 文件验收不核验研究质量，发票收款不核验客户身份；通用 CRM 咨询、任意渠道转化等尚无可信接入时使用人工源证据验收，不能自动宣称成交。
- 硬授权采用 Tokens；没有提供法币封顶/汇率承诺。供应商隐藏用量或违反请求输出上限会停机核实，不能撤销已经发生的费用。
- 普通 Goal 不自动执行外发、钱包签名、凭据变更、代码发布或版本删除。没有预批准恢复策略时，版本回退必须在独立维护服务由 Owner 确认。
- 旧 Run 没有 V29 许可时不自动续跑；核实后可创建新的受限 Run。V29 控制/目标事实出现后，回退目标必须保留 Gate 能力；模块兼容检查不代替冻结版本哈希、Owner 批准和健康检测。
- 未执行生产部署、真实付费模型验收、真实客户收款验收或 Linux 正式运行。需要外部提供的历史 V23 Release 测试不伪造其前置条件。

English boundary summary: V29 is a development candidate. Draft delivery, exact finalized invoice receipts, and explicit Owner verification are distinct evidence rules. Tokens are the execution limit; money is known recorded usage. Unknown outcomes never auto-replay. Deployment, real customers, real payments, and the externally supplied historical-release fixture require separate evidence.

## 改动路径

- `README.md`
- `README_CN.md`
- `apps/server/src/app.ts`
- `apps/server/src/routes/owner_routes.ts`
- `apps/server/src/routes/world_routes.ts`
- `apps/server/src/services/app_code_policy.ts`
- `apps/server/src/services/business_service.ts`
- `apps/server/src/services/dream_service.ts`
- `apps/server/src/services/gacha_service.ts`
- `apps/server/src/services/goal_outcome_evaluator.ts`
- `apps/server/src/services/owner_automation_gate.ts`
- `apps/server/src/services/owner_chat_service.ts`
- `apps/server/src/services/owner_goal_scheduler.ts`
- `apps/server/src/services/owner_goal_service.ts`
- `apps/server/src/services/owner_overview_service.ts`
- `apps/server/src/services/owner_work_service.ts`
- `apps/server/src/services/qianji_world_gateway.ts`
- `apps/server/src/services/run_service.ts`
- `apps/server/src/services/world_runtime_manager.ts`
- `apps/server/src/world_bootstrap.ts`
- `apps/server/tests/business.test.ts`
- `apps/server/tests/dream.test.ts`
- `apps/server/tests/fixtures/owner_goal_recovery_child.ts`
- `apps/server/tests/fixtures/owner_goals.ts`
- `apps/server/tests/launcher.test.ts`
- `apps/server/tests/owner_automation_rollback.test.ts`
- `apps/server/tests/owner_global_automation.test.ts`
- `apps/server/tests/owner_goal_recovery.test.ts`
- `apps/server/tests/owner_goal_scheduler.test.ts`
- `apps/server/tests/owner_goals.test.ts`
- `apps/server/tests/owner_work.test.ts`
- `apps/server/tests/pixel_skills.test.ts`
- `apps/server/tests/public_store.test.ts`
- `apps/server/tests/world_process_generation.test.ts`
- `apps/server/tests/world_product_routes.test.ts`
- `docs/EmergentInc_V29_实施记录.md`
- `docs/EmergentInc_V29_自主经营目标与全局运行开关_执行_PLAN.md`
- `docs/guides/OWNER_GUIDE.md`
- `frontend/src/api/owner.ts`
- `frontend/src/features/owner/OwnerActivity.tsx`
- `frontend/src/features/owner/OwnerAutomationReview.tsx`
- `frontend/src/features/owner/OwnerConsole.tsx`
- `frontend/src/features/owner/OwnerGoals.tsx`
- `frontend/src/features/owner/OwnerInbox.tsx`
- `frontend/src/features/owner/owner.css`
- `frontend/src/i18n/en.ts`
- `frontend/src/i18n/zh-CN.ts`
- `frontend/tests/owner_goals.test.tsx`
- `packages/protocol/src/types/model.ts`
- `packages/protocol/src/types/owner.ts`
- `packages/runtime/src/agent_step/agent_step_runner.ts`
- `packages/runtime/src/effects/effect_runtime.ts`
- `packages/runtime/src/scheduler/round_scheduler.ts`
- `packages/tools/src/builtin/artifacts.ts`
- `packages/tools/src/context.ts`
- `packages/tools/src/runtime.ts`
- `resources/upgrade-web.html`
- `scripts/upgrade-web.mjs`
- `supervisor/generation_supervisor.ts`
- `supervisor/owner_automation_compatibility.ts`
- `supervisor/protocol.ts`
- `tests/http_port.ts`
