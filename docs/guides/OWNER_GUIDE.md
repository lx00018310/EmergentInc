# Owner Guide / Owner 使用指南 — V32

## Chat and approvals / 对话与审批

Sign in at `/OWNER`. The sidebar contains only **Boss chat** and **AI company dashboard**. Start with `company budget CNY 100`; this creates a proposal. `approve company budget CNY 100` is an explicit authorization itself. Without a money authorization, the budget prompt, pause, proposal decisions and recorded status do not call a paid model.

登录 `/OWNER`，左侧只有 **Boss 对话** 和 **AI 公司看板**。先说“公司预算 100 元”生成预算提案；“批准公司预算 100 元”本身就是明确金额授权。未授权金额时，引导、暂停、提案决定及读取记录都不调用收费模型。

Describe the task and its expected deliverable. AI proposes one plan containing once, ongoing, interval, daily or weekly nodes, including their dependencies and timezone. Approve once to start the workflow. The company coordinates existing executors; a secretary is optional. Missing personnel produces a recruitment proposal. A recruitment approval can be queued while the company is paused; it does not claim a person has already been created.

交代任务及预期成果，AI 提出一份计划，组合一次性、长程、间隔、每日或每周节点，说明依赖和时区。批准一次后自动推进；公司协调现有执行者，无须先设置秘书。缺人时提出招聘申请；公司暂停期间可记录招聘批准并排队，不把批准冒充已经创建人员。

Each step saves an immutable deliverable and actual tool receipts. Subsequent dependent steps receive verified evidence. Reports, orders and drafts do not prove payments. Once steps finish, the company submits a close proposal. Only Owner acceptance closes the task and stops future triggers. Rejecting a close proposal leaves it open for follow-up.

每步保留不可变成果与实际工具回执，后续依赖步骤读取核验后的证据。汇报、订单、草稿不能证明收款。步骤完成后提交结案提案，老板认可后才结案并停止未来触发；拒绝结案则保留任务等待跟进。

Use `pause company` / `resume` for company operation, or `pause task <name>`, `stop task <name>`, `resume task <name>`, `close task <name>`. With multiple possible targets, specify one. A unique pending proposal can be decided with `approve` or `reject`; otherwise name the proposal or use its two dashboard buttons. Retrying the same request key returns the previous decision.

用“暂停公司”“继续运行”控制公司，或“暂停任务 名称”“停止任务 名称”“继续任务 名称”“结案任务 名称”。存在多个对象时须指明一个。只有一份待审提案时可以直接说“批准”“拒绝”；否则指定提案或在看板点击对应两个审批按钮。相同请求键重试返回原决定。

## Money and waiting / 金额与等待

One cumulative CNY authorization governs paid calls. `available = authorized − settled − reserved`, calculated with integer millionths of CNY. AI may allocate work but cannot enlarge this total. Old settled expenses remain separately visible; old token grants never become money. Unknown pre-V32 obligations must be resolved before activating the new budget.

收费调用共用一笔累计人民币授权，`可用 = 总授权 − 已结算 − 有效预留`，使用整数微元。AI 可安排工作，不能增加总额。旧结算费用单独展示，旧 Token 授信不转换成钱；V32 前的未知责任必须先核实，才能启用新预算。

Calls reserve a conservative bound before dispatch. Provably unsent calls release it; unknown calls retain it and block further spending. Insufficient funds generate an exact budget proposal for the next reservation. Approval can resume a provably unsent budget-blocked task. It cannot clear unknown outcomes or release a manual pause. Provider usage beyond its reservation stops operation for review.

调用发出前保守预留，确定未发送才释放；未知调用保留预留并阻止新支出。余额不足时提出覆盖下一次预留的准确金额提案，批准可接续确定未发送的预算阻塞任务，不能清除未知结果或解除人工暂停。服务商实际用量超过预留时停止并等待核实。

Waiting for a timer, evidence, approval or budget does not poll the model. Recurring nodes do not overlap; overdue periods coalesce into one batch, retaining the scheduled and actual timestamps. There is no 366-occurrence default business limit. Repeated empty or unchanged ongoing results stop after the existing no-progress guard.

等待时间、证据、审批或预算时不轮询模型。同一定时节点不重叠，逾期合并为一批，保留计划与实际时间；不设默认 366 次业务上限。空回复或长程节点重复相同成果由无进展保护停止。

## Dashboard and retained data / 看板与旧数据

The dashboard shows pending proposals, task stages, deliverables, actual people, daily settled costs, reservations, verified revenue by original asset, and decision history. It contains no operating settings. Old deep links open this dashboard. Source reports and private extensions are available as read-only details; credentials keep their existing secure delivery channel.

看板显示待审提案、阶段、成果、真实人员、每日结算费用、预留、原币种核验收入和审批历史，没有经营设置。旧深链接映射到看板，源码报告和私有扩展提供只读详情，凭据保留既有安全交付通道。

`owner_goals` is the authoritative new company task record. Logical nodes, occurrences, dispatch attempts and model permits retain separate IDs. Existing BusinessPlans are references to their original executor, never duplicated into a second scheduler. Orders, payments, old goals, evidence and unknown calls are retained. The first V32 schema initialization creates a `control.sqlite3.pre-v32.bak` snapshot including committed WAL.

新公司任务以 `owner_goals` 为主记录，逻辑节点、触发批次、派工尝试、模型许可分别保留 ID。已有 BusinessPlan 引用原执行器，不复制到第二个调度器。订单、付款、旧目标、证据、未知调用保留；首次 V32 schema 初始化创建包含已提交 WAL 的 `control.sqlite3.pre-v32.bak`。

## Version switching / 版本切换

At port 8766, select a real Git commit, wait for automatic isolated preparation and validation, then click **Approve and switch**. The exact candidate hash and current generation are bound internally. Compatible old commits follow this same process and produce a new increasing generation. Neither main/develop nor the development checkout is moved. Business data are not restored to an old snapshot to enable a switch.

在 8766 选择真实 Git 提交，等待自动隔离准备、校验，再点 **批准并切换**。后台绑定准确候选 Hash 和当前运行代。兼容旧提交使用同一流程并生成递增新运行代，不移动 main/develop 或开发工作区，不通过恢复旧业务库来切换。

Incompatible money, workflow, payment, Gene or extension protocols block the switch with a specific reason. The original manual/maintenance pause survives release changes. Durable approved runtime, config and approval records remain in `owner_private/approved-runtime`; ordinary cache cleanup must not remove them. Interrupted operations retain technical logs; controlled recovery remains available to the independent administrator CLI.

金额、任务、收款、Gene 或扩展协议不兼容会显示原因并阻止切换。发布保留人工及维护暂停意图。正式批准程序、配置及审批记录位于 `owner_private/approved-runtime`，普通缓存清理不得删除。中断操作保留技术日志，必要的受控恢复仍由独立管理员 CLI 提供。

All Owner APIs retain session, Origin, exact-content and idempotency checks. Unknown provider bills or external actions require original receipt verification through the existing audited recovery APIs. A budget approval, restart, human acceptance or software release cannot manufacture a receipt or authorize external payments.

Owner API 保留会话、Origin、准确内容及幂等校验。未知账单和外部动作须通过原回执与既有审计恢复 API 核实；预算审批、重启、人工验收或软件发布都不能制造回执或授予对外付款权限。
