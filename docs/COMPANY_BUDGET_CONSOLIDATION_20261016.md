# 公司总预算改造盘点 / Company budget consolidation audit

日期 / Date: 2026-10-16。基线 / Baseline: `da440d0`。

已确认：Token 输入单位为 M，仅计算授权金额；中文默认 2 元/M，英文默认 $0.3/M，固定 1 USD=7 CNY。实际按模型费用扣款，不设置另一条 Token 上限。耗尽后人工修改 Token 数量，建立一批新额度；历史费用与调用回执保留。审批仅包括已有成果验收/结案。

Confirmed: token input is in millions and sizes the money allowance only. Defaults are CNY 2/M or USD 0.3/M; USD converts to CNY at 7. Actual model cost consumes the allowance. A changed token quantity creates a fresh allowance after exhaustion, without resetting historical accounting. Only existing deliverable acceptance and closure are authorized.

| 位置 / Location | 当前耦合 / Coupling | 最小处理 / Minimal action |
| --- | --- | --- |
| owner_company_budget.ts | 累计金额上限；没有数量、单价、新批次信息 | 同一总账增加输入配置与批次起点，保留历史消耗；直接保存，不走预算提案 |
| owner_routes.ts、owner_proposal_service.ts | 聊天金额 → 预算提案 → 审批 | 删除该预算入口，统一指向公司预算设置；旧预算提案只保留历史 |
| owner_automation_gate.ts | 金额不足自动生成追加预算提案 | 删除自动追加；不足后等待人工修改数量，不自动续批 |
| budget_repository.ts | 公司模式只绕过部分 Run 限制，仍检查 Pixel、执行域和试验 Token 额度 | 公司获授权的 Run 只做总金额准入；身份、执行范围和实际用量账本保留 |
| world_runtime_manager.ts、round_scheduler.ts | 无限能量仅入口元胞；虚拟能量仍影响活跃成员和等待消息 | 移除公司路径的虚拟额度约束与补能依赖，恢复仅由旧额度造成的等待 |
| owner_work_service.ts、owner_goal_scheduler.ts | 旧预算阻塞记录不在普通队列，金额恢复不保证原任务恢复 | 调度统一恢复旧预算等待，不触发任务、人物各自的充值流程 |
| effect_runtime.ts | 能量输送、元胞创建仍消耗虚拟能量 | 公司模式输送只保留回执，不转移能量；创建元胞无需能量质押，保留身份与未决操作检查 |
| RunControls.tsx、QianjiCard.tsx | 本次 Run Token 设置、人物无限能量开关形成额外预算管理 | 公司模式删除这些设置；用量保留为记录 |
| BusinessHome.tsx、StrategyHistory.tsx | 前端读取 companyTokenQuota，后端提供 companyMoneyBudget，旧预算表单可能继续显示 | 使用一致公司预算标志，移除公司路径中的旧总额、草拟次数、方案额度设置 |
| business_store.ts | 草拟/方案/任务各自金额额度已有公司模式旁路 | 确保公司模式只用公司总预算；保留历史账目及非预算的成果/外部操作授权 |

现有数据 / Existing data: G0038，OFF，正式待验收/结案提案 0、待办审批 0、公司 Goal 0。已回复历史任务 2 条，无对应验收提案；其他 Gene/版本记录不在此次审批授权内，不伪造验收提案或将其他授权当作结案。

The current data has no pending acceptance or closure proposals. Two historical tasks already have replies but no acceptance proposals. Gene/release approvals are outside the requested scope.

仍保留公司人工启动/暂停、未知结果核对、已退休成员隔离、外部写操作与准确候选发布授权。这些不是人物/任务预算额度。

Manual company pause, unknown-outcome verification, retired-member isolation and external/release authorization remain independent of budget allocation.

实现与验证 / Implementation and verification:

- `/api/owner/budget` 直接保存数量、单价、币种与修订号；采用既有请求幂等记录，保存不启动公司。
- 默认 100M；中文 2 元/M = 200 元，英文 $0.3/M = $30 = 210 元。两种初始默认价格按 Owner 确认保留，并非声称互为等价。
- 每次保存建立完整新批次；100M 用完改为 200M @2 元/M，获得新的 400 元额度。新批次不累计旧批次剩余额度，历史成本保留。
- 预留按模型实际定价保守计算；剩余金额不足以覆盖下一调用时等待人工补充。进行中调用暂占额度与真实不足分开，不误触发人工补充。
- 旧库原子迁移到公司金额协议 2，迁移前保留备份；旧协议发布不能读取新库，回退检查会明确拒绝。
- 11:43 再次只读核对运行数据：公司 OFF、无未知模型结果，成果验收/结案待审批仍为 0；当前现场库仍是协议 1，未修改现场预算、执行开关或成果记录。

The settings endpoint saves an explicit full allowance using revision checks and the existing idempotency ledger. Defaults are 100M at CNY 2/M (CNY 200) or USD 0.3/M (USD 30, CNY 210). A fresh 200M batch at CNY 2/M grants CNY 400. Old unused allowance is replaced; costs remain recorded. Temporary concurrent reservations do not force a refill. Schema 2 is migrated transactionally with a prior backup; rollback to incompatible schema 1 code is rejected. A second read-only live audit at 11:43 still found no pending deliverable acceptance or closure approvals. Live money, company mode and task results were not changed.

验证结果 / Validation: 全量与定向回归合计覆盖 1072 项，修复旧夹具并重测后 1068 项通过、4 项跳过，未遗留失败；前端独立回归 216 项通过，最终文案及状态展示定向回归通过。类型检查、前端构建和 `git diff --check` 均通过。

The root suite and targeted follow-ups covered 1072 cases. After repairing old fixtures and rerunning the affected files, 1068 passed and 4 were skipped, with no remaining failures. The standalone frontend suite passed 216 cases; final UI wording and status presentation checks also passed. Type checking, frontend build and whitespace checks passed.
