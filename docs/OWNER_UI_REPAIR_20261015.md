# OWNER 页面修复与验证 / OWNER UI repair and verification

日期 / Date: 2026-10-15

状态：源码修复与本地验证完成。正式 8765 冻结版本尚未发布本次改动。

Status: Source changes and local verification are complete. These changes have not been published to the frozen release on port 8765.

## 修复范围 / Changes

| 问题 / Problem | 修复 / Repair |
| --- | --- |
| 对话与输入框受全局深色样式覆盖 / Dark global styles override chat | 全局深色选择器排除 OWNER；助手白底深色字，用户深色底白字，依据文字提高对比度。 / Exclude OWNER from dark overrides; use readable message, evidence and input colours. |
| 任务进度不在首屏 / Progress is buried | 项目任务 → 审批与跟进 → 预算 → 人员 → 报告与辅助信息。 / Tasks, decisions and follow-up, budget, people, then supporting records. |
| 任务记录分散且空状态误导 / Fragmented tasks and false emptiness | 同屏展示目标、独立派单与保留经营任务；使用持久化 goalId 关联去重，缺失父目标的派单仍显示。 / Combine existing task sources; deduplicate by persisted relations while retaining orphan assignments. |
| 缺少看板 / No task board | 五列阶段、数量、负责人筛选、搜索、步骤交付进度与可展开详情。 / Five workflow stages, counts, assignee filtering, search, delivered-step progress and expandable details. |
| 回复与完成混淆 / Replies confused with completion | REPLIED 单列待验收，不能计入已完成；FAILED 与未知状态纳入待跟进。 / Replies await acceptance; failures and unknown states remain visible. |
| 运行中记录与实时空闲矛盾 / Recorded status conflicts with live execution | 返回当前 runId，按任务 runId 核对真实执行；记录仍运行但无活跃执行时明确提示。 / Match assignment and live run identities and explain suspended records. |
| 审批与待处理计数混用 / Approval and follow-up counts mixed | 公司提案与成对审批动作统计为审批；只读报告和告警单列跟进。 / Count actual decisions separately from reports and alerts. |
| 公司状态和原因未本地化 / Internal status codes in the main UI | 维护、预算、阻塞、事件与订单状态中英文显示；未知状态提示核实，原始信息保留在技术详情。 / Localized statuses with explicit unknown-state handling and preserved diagnostics. |
| 工作负荷仅为 0/1 / Workload is just a binary meter | 展示未结任务、需跟进任务、待验收回复及独立的实时执行状态。 / Show task workload counts separately from live execution. |
| 状态色误导 / Misleading colours | 正常停止不再标红，维护为警示；零余额不标绿、零预留费用不标橙。 / Distinguish normal stopping and maintenance; colour budgets by their values. |
| 报告过长与嵌套滚动 / Long reports and nested scrolling | 主卡展示摘要，全文和源码按需展开；工作区不再限制为内部 65vh 滚动框。 / Summaries first, expandable reports, and no nested work-report scrolling. |
| 历史噪声和空 World 链接 / Noisy history and empty-World links | 历史默认折叠，系统事件可展开；公司级事件链接公司历史。任务指令内的工具名称保留原文。 / Collapsed history, optional system events, corrected company links, and intact tool names in task instructions. |
| 时间和刷新状态不明确 / Unclear dates and freshness | 统一语言和上海时区；显示刷新时间、读取失败、旧数据提示和只读重试。 / Locale-aware Shanghai dates, refresh timestamps, stale-data warnings and read-only retry. |
| 异常数据可导致误展示 / Malformed responses can mislead | 拒绝结构异常的概览；成果读取失败和异常响应可重试；无效预算不画数值图；不完整提案不提供决策按钮。 / Validate response shapes, allow evidence-read retry, reject invalid budget charts and block decisions on incomplete proposals. |
| 窄屏可读性 / Narrow-screen readability | 390px 下单列展示，空阶段压缩为 40px，页面无横向溢出。 / Single-column cards at 390px, compact empty stages and no page overflow. |

## 验证 / Verification

- 根目录类型检查通过：npm run typecheck。 / Root type checking passed.
- 前端完整回归：37 个文件、201 项测试通过。最后的历史文案调整后，OWNER 专属 20 项再次通过。 / Full frontend suite: 201 passing tests; focused OWNER suite after the final history adjustment: 20 passing tests.
- 后端相关回归：owner_overview_projection、owner_work、owner_goals，共 56 项通过。 / Affected backend suites: 56 passing tests.
- 前端生产构建通过。保留现有 App 大包提示，未为本次 UI 修复调整全站打包策略。 / Production frontend build passed; the existing large App chunk warning remains.
- 浏览器实看：中文与英文真实数据看板、390px 窄屏；当前预览的浏览器 error 日志为空。 / Browser verification covered real-data dashboards in both languages and a 390px viewport; no browser error logs were observed.
- 实际 OwnerChat 组件使用隔离样例验证中英文 Markdown、表格与对比度。测试页使用内存 Storage，不覆盖浏览器保存的聊天。 / The real chat component was verified with isolated bilingual fixtures; the fixture uses in-memory storage.
- 新增关联字段属于只读投影：OwnerWorkTask.goalId、OwnerPerson.runId。后端关联与无副作用通过集成测试验证，开发预览仍读取现有 8765 后端。 / Added relation fields are read-only projections verified by integration tests; the development preview reads the existing 8765 backend.

## 查看与发布 / Preview and publication

开发预览 / Development preview: http://127.0.0.1:5173/OWNER#owner-dashboard

本次没有执行审批、派单、模型调用、版本批准或正式发布。页面源代码与新增投影需按现有版本升级流程一起发布，8765 才会生效。参见「版本升级入口.md」。

No live decisions, task dispatch, model calls, version approval or production publication were performed. Publish the frontend and projection changes together through the existing upgrade workflow before they take effect on port 8765.
