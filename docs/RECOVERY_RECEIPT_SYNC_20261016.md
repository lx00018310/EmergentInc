# 恢复回执重复拦截修复 / Recovery receipt synchronization

现场证据（上海时间）/ Observed evidence (Asia/Shanghai):

- 2026-10-16 12:51 模型请求发出；12:54:04 读取响应时 `UND_ERR_SOCKET`，实际用量及费用未知。
- 12:54:29 已执行模型恢复 `abandon`。World 回执为 `CALL_OUTCOME_RECONCILED`，消息为 `ABANDONED`，Core 预留已结束。
- 公司总账仍为 `UNKNOWN`；旧桥接仅同步“确认未计费”和“已知实际费用”，遗漏了已放弃结果，因此再次拦截启动。
- 四个 World 与经营流程没有其他待核模型、工具或外部效果。

A response-body socket disconnection left usage and cost unknown. The Owner then abandoned the call. World recovery completed, but company recovery ignored that decision and continued blocking startup. No other unresolved World or business outcomes were found.

最小修复 / Minimal correction:

1. 复用现有 World 恢复决定，在现有审计事件中同步一次回执；删除同一结果对启动和预算设置的重复拦截。
2. 实际费用仍为未知，继续保留原金额预留；不写入虚假的零费用或实际 Token 数量。现有费用核实接口继续保留该记录。
3. 其他未经处理的未知调用、工具和外部效果继续使用原保护。
4. 删除重复红字，并在恢复完成后移除已经过时的启动错误；中文英文同步。

The existing recovery receipt is reused once. Reviewed outcomes no longer require a second decision for startup or budget settings. Unknown charges retain their original reservations and remain available through the existing billing reconciliation API. Other unresolved operations retain their guards. Duplicate and stale startup errors are removed in both languages. No new database schema or approval workflow is introduced.

验证 / Verification:

- 现场只读快照：修复前拦截、修复后可启动；200 元预算、0.001523 元预留均不变，未发起模型请求。现场数据库未修改。
- 80 项服务端、44 项前端针对性回归通过；类型检查、前端构建及差异检查通过。
- 新版本启动时会自动读取已有放弃回执；公司仍保持 OFF，等待人工启动，不需要重复审批或重设预算。

Read-only live snapshots reproduced the failure and verified startup after synchronization, with CNY 200 authorized and CNY 0.001523 reserved unchanged and zero model requests. Live databases were not modified. All 124 targeted tests, type checking, frontend build and whitespace checks passed. The new release consumes existing recovery receipts automatically while retaining manual company startup.
