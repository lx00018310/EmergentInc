# Owner Guide / Owner 使用指南 — V29

## Main path / 主路径

Deploy an approved release, sign in at `/OWNER`, add a goal, confirm its acceptance rule and token limit, authorize the global budget, select continuous or bounded operation, and start. Review actual evidence in Details and exceptions in Inbox. Technical chat is auxiliary.

部署已批准版本，在 `/OWNER` 登录，新增目标，确认验收规则与目标 Token 上限，再授权全局预算，选择持续或指定轮数并开启。在详情查看实际证据，在待办处理例外；技术聊天为辅助入口。

- A draft goal requires a named text file, minimum UTF-8 bytes and an immutable tool receipt. Completion verifies file delivery, not commercial quality.
- A payment goal counts only finalized receipts and revenue records for the exact invoice IDs selected by Owner. It does not verify customer identity or consultations.
- Other business outcomes use human verification. Reports and promises cannot complete those goals automatically.

- 草稿目标要求准确文本文件名、最低 UTF-8 字节数与不可变工具回执；完成只证明文件交付，不证明经营质量。
- 收款目标只统计 Owner 指定准确发票 ID 的最终确认回执与收入记录；不据此推断客户身份或咨询数量。
- 其他经营结果须人工核实；人物回复和承诺不能自动证明目标完成。

If there is no active person, the scheduler proposes a recruitment request in Inbox. Approval creates one person; the goal's subsequent work uses the same one-round scheduler. The switch itself never authorizes recruitment, publication, credentials or software maintenance.

没有活跃人物时，调度器在待办提出招聘申请；批准后创建一位人物，后续目标仍按单轮调度执行。打开开关本身不授予招聘、外部发布、凭据或软件维护权限。

## Stopping and limits / 停止与额度

Automation defaults OFF. One round is an actually started World scheduling round; interrupted rounds count once. Multiple goals share the session allowance. Completed rounds are separate. Continuous operation still requires a global token allowance; goal and Run limits also apply. Known CNY usage and unknown reservations are separate, not a payment guarantee.

自主运行默认 OFF。一轮指实际开始的一次 World 调度轮次；中断轮次唯一计数。多个目标共享当次额度，完整结束轮数独立显示。持续模式也必须授权全局 Token 额度，同时受目标和 Run 上限约束。已知人民币费用与未知预留分开显示，不构成支付承诺。

OFF prevents new work immediately, preserves already received responses and receipts, and requests safe suspension. Stopping remains visible while a third-party request drains. It cannot undo effects already accepted externally. Public checkout, payment confirmation, audit, login and independent 8766 maintenance remain available. Repeated OFF requests never cancel a later authorization.

OFF 立即禁止新工作，保存已收到的响应与回执，并请求安全挂起。第三方请求未收尾时显示“停止中”，已被外部受理的效果不会撤销。公开下单、付款确认、审计、登录和独立 8766 维护继续可用。重复旧 OFF 请求不会撤销后来的授权。

Pause preserves a goal's checkpoint. Stop or archive revokes continuation and retains its evidence. Restore returns an archived goal to Paused. Edit creates a new specification snapshot; old dispatches retain the previous specification. Tokens are cumulative for the goal, including earlier revisions.

暂停保留目标检查点；停止或归档撤销继续执行资格并保留证据；恢复归档后回到暂停状态。编辑创建新的目标快照，旧派工仍归旧修订；目标 Token 累计包含旧修订。

## Advanced operations / 高级运维附录

`/QIAN`, `/YUAN?world=<id>`, `/GENE` and `http://127.0.0.1:8766/` remain available. Manual Run starts and recovery also obey the global gate. Pre-V29 Runs without global permits require review and a newly authorized bounded Run, not silent adoption.

原 `/QIAN`、`/YUAN?world=<id>`、`/GENE` 与 `http://127.0.0.1:8766/` 继续可用。人工 Run 启动和恢复同样受全局许可约束；V29 前缺少全局许可的 Run 须核实并重新授权受限 Run，不静默接管。

Maintenance quiesce takes priority over ON. Final Dream under a closed gate retains source facts and writes a maintenance receipt without model calls. Ordinary Dream cannot bypass OFF. Candidate validation cannot resume work. Release rollback and deletion require independent Owner confirmation.

维护排空优先于 ON。Gate 关闭时，Final Dream 保留源事实并写维护回执，不调用模型；普通 Dream 不能绕过 OFF。候选验证不续跑。版本回退和删除须独立 Owner 确认。

All `/api/owner/*` endpoints require the existing Owner session. Mutations require `idempotencyKey` and existing-object changes require `expectedRevision`; stale revisions return 409. Retrying a lost response must reuse the same complete request body and key. Do not reuse a key with a new revision.

所有 `/api/owner/*` 接口使用现有 Owner 会话。写请求须有 `idempotencyKey`，修改既有对象须有 `expectedRevision`；旧版本返回 409。丢失响应后重试须复用完整请求体与同一键，不得修改 revision 后仍沿用旧键。

```text
GET/POST  /api/owner/goals
GET/PATCH /api/owner/goals/:id
POST      /api/owner/goals/:id/actions
GET       /api/owner/goals/:id/evidence/:evidenceId
GET/POST  /api/owner/automation
GET       /api/owner/automation/calls
POST      /api/owner/automation/calls/:id/reconcile
GET       /api/owner/automation/report
```

Actions: `pause`, `resume`, `stop`, `reopen`, `archive`, `restore`, `verify`. A create/edit body contains `title`, `objective`, `maxTokens`, `acceptance` and its key; edit also pins the current `revision`. Acceptance is one of:

动作如上。新增/编辑体包含标题、目标、Token 上限、验收规则和幂等键；编辑另须绑定当前版本。验收规则形状如下：

```json
{"kind":"artifact","filename":"result.md","minBytes":100}
{"kind":"confirmed_payments","invoiceIds":["invoice_exact_id"],"targetCount":1}
{"kind":"manual","description":"Verify three real consultations using source evidence"}
```

Manual acceptance can be confirmed in goal Details after Owner reviews current-revision source artifacts and supplies a verification reason. Reports alone cannot be approved. This records Owner verification against frozen evidence hashes; it never creates customer or payment ledger facts. The run report shows per-goal evidence and usage for the current session without another model call.

人工验收目标可在详情审阅当前修订的源产物后，填写核实理由并确认。仅有人物报告时不能确认。该决议绑定冻结证据哈希，记录 Owner 核实，不创建客户或付款账本事实。运行报告按目标显示当次证据与用量，不额外调用模型。

### Unknown outcomes / 结果未知

Review original provider bills and external receipts first. World recovery uses `/api/worlds/<id>/api/run/recovery/resolve` and its existing audited decisions. The control call list exposes the original source call IDs. Known settled World receipts reconcile the control ledger automatically. Other unknown usage needs an explicit measured `actualTokens`, `costCny`, evidence-based `reason`, current control `expectedRevision` and idempotency key at the control reconciliation API. This only settles control accounting; it cannot clear unresolved World/Business outcomes or prove a sale. A new ON authorization is still required after a safety stop.

先核实原始服务商账单及外部回执。World 恢复使用 `/api/worlds/<id>/api/run/recovery/resolve` 的既有审计决议。控制调用列表保留原始调用 ID；已明确结算的 World 回执会自动对齐控制账。其他未知用量须在控制对账接口提供真实 `actualTokens`、`costCny`、有证据的 `reason`、当前控制版本与幂等键。该操作只结算控制账，不能清除 World/Business 未知结果，也不证明成交；安全停止后仍需重新授权 ON。

Never edit SQLite, credentials, frozen releases or Pixel minds to bypass review. Keep workspace data and secrets out of Git. Deployment, real customer outcomes and real payment acceptance require separate evidence.

不得通过手工修改 SQLite、凭据、冻结版本或元胞心智绕过核实。工作区数据与秘密不得提交 Git。部署、真实客户结果和真实收款验收必须另留证据。
