# Owner / QIAN 对话与源码候选修复 · 2026-10-08

## 中文

实际数据库记录显示：Owner 分配调用消耗了完整的 4096 Completion Tokens，随后记录 `OWNER_DISPATCH_INVALID`；该调用未派工。原始分配正文没有持久化，因此不能断言具体是哪一个字段无效。分配接口的输出额度比现有只读查询接口低，也是推理模型未能生成完整 JSON 的明确风险。

两次 QIAN 修复请求仍为 `QUEUED`；关联 Run 均因 `ECONNRESET` / `response_body` 停止，并被错误记为 `COMPLETED`。World 中还保留一笔 `CALL_OUTCOME_UNKNOWN`。界面仅依据消息的排队状态显示“等待本轮处理”，隐藏了恢复阻塞。网络连接重置本身不能由本次应用修改保证消除。

工具反馈通常可以在同一轮内继续处理；只有跨轮 SELF 或长消息链才会受原先 1 轮上限影响。它不是两次连接重置的原因。

本次变更：

- 分配输出上限与既有 Owner 查询一致（131072 Tokens）；区分耗尽额度、空正文、结构无效，保持严格指令验证，不自动重试模型。
- 单次派工支持指定 1–20 轮，把运行和汇报合成同一任务，Run 额度仍为 100000 Tokens。轮数单独保存，旧任务保持原有 20 轮，原表结构不变。
- 被明确拒绝的分配请求可重新发送；网络结果未知的重试继续保留原请求键，避免重复派工。
- QIAN 可选择 1–20 轮，默认最多 20 轮，支持多步源码读取、提交候选和最终汇报；Run 额度仍为 100000 Tokens。
- Run 结束后的未处理消息显示具体阻塞和 World 恢复入口；未决调用阻止新 Run。调用或工具结果未知的 Run 记录为 `STOPPED`。

验证包括中英文页面、指定 10 轮、旧任务兼容、读取源码 → 提交实际候选 → OWNER_REPLY、轮数耗尽后继续，以及连接重置后的恢复阻塞。测试使用隔离 Workspace 和受控模型响应，不能证明真实模型的成功率。应用运行中的源码不被修改，源码候选继续由独立升级器校验并等待准确哈希批准。

本次只准备版本，不批准或发布，不替用户选择历史未决调用的计费恢复决定。

## English

The actual database records show that the Owner dispatch call consumed its full allowance of 4096 completion tokens, then recorded `OWNER_DISPATCH_INVALID`. It assigned no work. The original dispatch body was not persisted, so the exact invalid field cannot be established. Dispatch had a lower output allowance than the existing read-only Owner query, risking incomplete JSON from reasoning models.

Both QIAN repair requests remained `QUEUED`. Their Runs stopped with `ECONNRESET` during `response_body`, but were incorrectly recorded as `COMPLETED`. The World also retains one `CALL_OUTCOME_UNKNOWN`. Showing only the message queue state hid the recovery blocker. These application changes cannot guarantee that remote connection resets will disappear.

Tool feedback can normally continue within one round. The previous one-round cap affects cross-round SELF continuations or long message chains; it did not cause the two connection resets.

Changes:

- Dispatch uses the same 131072-token output allowance as existing Owner queries. Output exhaustion, empty content and invalid structures have separate errors. Strict instruction validation remains; there is no automatic model retry.
- Assignments accept an explicit 1–20-round limit and combine execution and reporting in one task. Each Run remains limited to 100000 tokens. Limits are stored separately; legacy tasks retain 20 rounds and the original table layout.
- Explicitly rejected dispatches can be sent again. Retries with uncertain network outcomes retain the original request key to prevent duplicate work.
- QIAN offers 1–20 rounds, defaulting to at most 20, for source reading, candidate submission and the final reply. Its Run budget remains 100000 tokens.
- Unprocessed messages after a stopped Run show the blocker and a World recovery link. Unresolved calls prevent new Runs. Unknown model or tool outcomes are recorded as `STOPPED`.

Verification covers both UI languages, explicit 10-round limits, legacy tasks, reading source → submitting a real candidate → OWNER_REPLY, continuing after round exhaustion, and recovery blocks after connection resets. Tests use isolated Workspaces and controlled model responses; they do not establish real-model success rates. Running source stays unchanged. Source candidates still require independent upgrade validation and exact-hash publication approval.

This change prepares a version only. It does not approve or publish it, or choose a billing recovery decision for historical unresolved calls.
