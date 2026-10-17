# BOSS:/AFK · Owner guide / 老板指南

## Start / 开始

Open `/BOSS` and sign in. Select **EN / 中文** in the header. New companies start OFF with no authorized budget. Use **Authorize company budget** to set a CNY amount from token quantity and unit price; saving does not start the company. Then select **Start**.

打开 `/BOSS` 登录，在顶部切换 **EN / 中文**。新公司初始 OFF、预算未授权。通过 **授权公司预算**填写 Token 数量和单价形成 CNY 金额；保存不会自动开机，然后点击 **启动**。

## Give a goal / 下达目标

Use the single input, for example: “Research demand for a local bookkeeping service and save a source-backed report.” The system records the goal and proposes work. Review exact plan/Worker/product decisions on the homepage. Approving a proposal grants only its stated scope; external publishing or software publication still requires its own permission.

使用唯一输入框，例如：“调研本地记账服务需求，保存含来源依据的报告。”系统记录目标并提出工作方案。在首页核对具体计划、执行者、商品决定。批准只授权提案注明的范围；外部发布和软件发布仍需要各自权限。

## Read the facts / 阅读事实

There are exactly three dynamic metrics and at most three visible messages. Critical recovery issues take priority; additional decisions remain available through **More important items**. Normal logs are not notifications. Missing or stale data is shown as unknown. USDT revenue and CNY costs are separate; no estimated profit or model-generated progress percentage is shown.

页面恰好显示三个动态指标、最多三条消息。严重恢复问题优先，其他决定可从 **更多重要事项**处理。普通日志不占消息位。缺失或过期数据标为未知；USDT 收入与 CNY 成本分开，不展示估算利润或模型生成的进度百分比。

Approvals bind the exact hash/revision and retry key. An error or timeout is not success. A pending chat or budget change keeps its original request for retry; do not submit the same work under a new key to bypass an unknown result.

审批绑定具体 hash/revision 和重试键。错误、超时均不等于成功。未决对话或预算变更保留原请求供重试，不要用新键重复提交以绕过未知结果。

## Pause, budget, recovery / 暂停、预算、恢复

**Pause** stops further dispatch; a request already sent can still return. OFF persists across restarts and software upgrades. Funding the company does not resume work. An unknown execution blocks its step and dependent work; independent work may use the remaining budget after all unresolved reservations are deducted. A completed deliverable and its pending bill are separate facts.

**暂停**阻止后续派工，已经发出的请求仍可能返回。OFF 跨重启和软件升级保留，追加金额不会自动恢复经营。未知执行阻塞本步骤及依赖工作；独立任务可使用扣除全部未决预留后的剩余预算。交付完成与账单未决分别记录。

Use **Review unresolved calls** to record verified tokens and cost only from actual receipts. **Acknowledge and stop uncertain work** abandons the uncertain result without replay or an invented bill; unresolved money remains reserved. It does not start a replacement task. After reviewing the outcome, use the exact command “resume task <exact title or ID>” to reopen the task, or “stop task <exact title or ID>” to stop it. Never replay an unknown external effect by changing its key.

通过 **核验未决调用**，只依据实际回执填写已核验 Tokens 和费用。**确认并停止结果未明的工作**放弃未知结果，不重放、不填造账单，未决金额继续预留，且不会启动替代任务。核验后使用准确指令“继续任务 <准确名称或 ID>”重开，或“停止任务 <准确名称或 ID>”停止。不得更换操作键重放未知外部动作。

If a recovery response is lost, use **Retry pending recovery**. Its original fields, revision and request key remain fixed until the decision is confirmed or explicitly rejected. A bill received after an outcome was abandoned can still be recorded in this recovery window; accounting does not restart the discarded execution.

核验响应丢失时，点击 **重试未确认核验**；原字段、版本号和请求键会保留，直到决定被确认或明确拒绝。放弃结果后才收到的费用回执，仍可在同一核验窗口登记；对账不会重新启动已放弃的执行。

## Receive payments / 收款

Configure only public receive-only recipient addresses and supported mainnet rails through the homepage message. No outgoing transfer or wallet private key is required. Public customers use `/`; order links contain private random tokens. Only finalized, verified receipts enter revenue, and each receipt is recognized once.

通过首页消息配置公开收款地址和受支持主网通道，只收款、不转出、不需要私钥。客户访问 `/`；订单链接含私有随机令牌。收入只计入最终核验的回执，同一回执只入账一次。

## Update software / 更新软件

Local controlled publication runs on `http://127.0.0.1:8766`. Review the pinned source and exact candidate hash before approval. Validation, isolated smoke startup, process identity, compatibility and rollback guards remain enforced. Updates and rollback preserve V34 company data and private artifacts. They cannot undo the separate pre-V34 destructive reset.

本地受控发布入口为 `http://127.0.0.1:8766`，批准前核对固定源码与精确候选 hash。仍执行验证、隔离启动、进程身份、兼容性和回滚保护。升级和回滚保留 V34 经营数据与私有产物，不能撤销 V34 前的独立破坏性清零。

After company-control migration, rollback requires a release supporting the persisted company worker and receipt protocols. Older incompatible releases are rejected; company records are never discarded to force a rollback. Migration snapshots remain under `workspace/system/migrations/company-control-v1/`.

迁移到公司控制层后，回滚目标必须支持已持久化的 worker 与回执协议；系统拒绝不兼容的旧版本，不会通过删除公司记录强行回滚。迁移快照保留在 `workspace/system/migrations/company-control-v1/`。

**Inspect Company** opens current goals, acceptance rules, verified deliverables, workers, task reports, products and orders. Budget, payment and recovery settings remain accessible there after initial setup. See [reset guide / 清零指南](V34_RESET.md) and [removal inventory / 删减清单](../V34_REMOVAL_INVENTORY.md).

**视察公司**展示当前目标、验收规则、已核验交付物、执行者、任务汇报、商品和订单。初次配置后仍可从这里进入预算、收款及恢复设置。详见上方清零指南与删减清单。
