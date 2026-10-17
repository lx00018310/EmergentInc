# BOSS implementation status / BOSS 实施状态

Delivered on 2026-10-17: [production BOSS](http://127.0.0.1:8765/BOSS), generation **G0003**. Controlled publication service remains available on port 8766.
2026-10-17 已交付：[生产 BOSS](http://127.0.0.1:8765/BOSS)，版本 **G0003**。8766 受控发布服务正常。

- Paperclip MIT reference / 参考版本: 647116dd4bf712bda3fb75f259ee684b23bf8bb8.
- Delivered source commit / 已交付源码: 7c217b68afab63b1d73b4124c7fd8b2e4caf69a8.
- Release / 发布: local-fc87fa44-b337-466e-87b3-45f6884a7a0c.
- Approved candidate hash / 已批准候选哈希: e6b24d2a8346616af0d53754f72f82daaccef5c53a49d22b9291f7f7494dc78b.
- Original 289-file staging retained; no commit/push on the user checkout. / 原 289 文件暂存保留，未在用户检出提交或推送。

## Implemented boundaries / 已实现的边界

Company Task/Attempt state is controlled in one SQLite authority. Dispatch outbox, ordered receipt inbox, atomic claims and fencing protect ownership. Independent Windows workers use durable private journals; already paid responses and committed tool receipts survive disconnects/restarts.
公司 Task/Attempt 由单一 SQLite 权威控制；持久派工、顺序回执、原子领取及 fencing 保护执行归属。Windows 独立 worker 使用持久私有日志，已付费响应及工具回执跨断线、重启复用。

Company goals, DAGs, timers, recruitment, typed tools, immutable artifacts and approved dependency reads use the company path. New agents need no World/Core/Current. The old Core adapter is limited to existing runs. Budget admission, execution recovery and fee settlement are separate. Store/payment and software publication retain separate permissions.
目标、DAG、定时、招聘、类型化工具、不可变产物及获准依赖读取已接公司路径；新执行者不再创建 World/Core/Current。旧 Core 适配器只处理已存在运行。预算准入、执行恢复、费用对账分别记录，商城付款与软件发布保持各自权限。

## Acceptance / 验收

The final frozen release passed **731 tests**. Its 3 skipped dedicated tests were run separately and passed: real provider task/restart/timer (255.6s), Windows payment/publication/rollback (787.0s), and one-click source publication plus two historical restores (2212.2s). The separate frontend run passed 58 tests, including 38 BOSS tests; these overlap the full-suite count.
最终冻结发布 **731 项通过**。集合中跳过的 3 项独立检查均另行实跑通过：真实模型任务/重启/定时（255.6 秒）、Windows 付款/发布/回滚（787.0 秒）、一键源码发布及两次历史恢复（2212.2 秒）。单独前端运行 58 项通过，其中 BOSS 38 项；不与全集重复累加。

| # | Criterion / 标准 | Evidence / 依据 |
|---|---|---|
| 1 | Failure converges Attempt/Task/Goal / 故障状态收敛 | Fault tests + production original Task/Goal BLOCKED / 故障注入及生产旧任务已阻塞 |
| 2 | Independent work continues, ON retained / 独立工作继续、保留 ON | Production real-provider self-test completed / 生产真实调用自检完成 |
| 3 | Unknown reservation retained / 未决预留保留 | Original 516 microCNY unchanged; conservation checked / 原 516 微元不变、额度守恒 |
| 4 | Durable paid response/tool reuse / 已付费响应和工具复用 | Actual kill/disconnect/restart tests / 实际强杀、断线及重启 |
| 5 | Process identity, lease, checkpoint / 身份、租约、检查点 | 10 adapter + 9 worker tests / 10 项适配器、9 项 worker |
| 6 | One atomic claim / 单一原子领取 | Competing DB connections / 数据库连接竞争 |
| 7 | Duplicate/out-of-order/stale receipts / 重复、乱序及过期回执 | Execution, tool and payment regression / 执行、工具及收款回归 |
| 8 | Invalid fields/plans isolated / 字段及计划错误隔离 | Strict JSON, DAG and scheduling checks / 严格 JSON、DAG 和调度核验 |
| 9 | Unknown external effects do not replay / 未知外部动作不重放 | Durable command receipts + recovery checks / 持久命令回执及恢复核验 |
| 10 | Late billing separate from delivery / 晚到费用与交付分离 | Failure-first recovery regression, exact original request retry / 先失败后修复回归、完整原请求重试 |
| 11 | Manual OFF persists / 人工 OFF 持久保留 | Restart/funding/publication/rollback / 重启、追加预算、发布和回滚 |
| 12 | One incident, one affected goal / 单事故、1 个受影响目标 | Production bilingual page / 生产双语页面 |
| 13 | Store/payment/8766 isolation / 商城、付款和发布隔离 | Tool/payment/recovery-host tests + live 8766 / 工具、收款及恢复主机检查、实际 8766 |
| 14 | Actual Windows processes / 实际 Windows 进程 | Worker kill/restart, G0003 production switch / worker 强杀重启、生产切换 |
| 15 | Chinese and English / 中英同步 | 38 BOSS tests + production mobile/recovery browser checks / 38 项及生产移动恢复核对 |
| 16 | Data survives publication and compatible rollback / 发布兼容回滚保留数据 | Real Windows process rehearsals + production migration hashes / 实际进程演练及生产迁移哈希 |

Detailed evidence and each criterion's scope: owner_private/architecture-research/phase3-acceptance-matrix.json and production-final-audit.json. Frozen validation log: owner_private/approved-runtime/validation-local-fc87fa44-b337-466e-87b3-45f6884a7a0c.log.
每项证据及核验范围见上述私有验收矩阵与最终审计记录，冻结校验日志见上述路径。

## Production proof / 生产证据

The original uncertain call is still UNKNOWN with **0.000516 CNY reserved**. Its Task and Goal are BLOCKED, the homepage shows one incident and one affected goal, and independent work remains usable. No fee or recovery decision was invented.
原未决调用仍为 UNKNOWN，**0.000516 元继续预留**。旧 Task、Goal 均已阻塞，首页显示 1 张故障卡、1 个受影响目标，独立工作可继续；未虚填费用或恢复决定。

Production goal “交付自检 / Delivery check G0003” generated and served a **1088-byte** artifact, verified by SHA-256, then completed only after explicit acceptance. Recorded incremental model cost: **0.000223 CNY**, using existing configured amortized subscription rates. No extra World was created.
生产“交付自检 / Delivery check G0003”生成并提供 **1088 字节**文件，SHA-256 一致，明确验收后结案。增量记账 **0.000223 元**，采用现有订阅配置的摊销费率；未新增 World。

Artifact hash / 文件哈希: 8dcb8fa05e2842431df5d761990dbb363df1a4da64cc763c6a2f0617bd3ad55a.
Evidence / 记录: production-delivery-verification.json, production-selftest-G0003.md, boss-production-desktop-zh.png, boss-production-mobile-zh.png, boss-production-mobile-en.png, boss-production-recovery-en.png (all under owner_private/architecture-research/ / 均位于该私有目录).

## Remaining configuration and limits / 所需配置及边界

Receive-only payment functionality is implemented and tested with explicitly synthetic finalized TLS RPC receipts, paid/pending private orders and preserved receipt hashes. No real on-chain payment or outgoing transfer was performed. Production needs your actual recipient address before sales.
只收款功能已实现，用明确标注的合成最终 TLS RPC 回执、已付和待付私有订单、保留回执哈希完成测试。未执行真实链上付款或向外转账；生产销售前需填写你的实际收款地址。

The original unknown outcome requires an actual provider receipt or your explicit abandonment decision. It does not stop independent tasks. Worker protocol 3 is required for rollback; incompatible old releases are rejected rather than discarding facts. This verifies defined fault boundaries, not a promise that external networks never fail.
原未知结果需实际供应商回执或你明确决定放弃；它不会阻止独立任务。回滚须支持 worker 协议 3，不兼容旧版本会被拒绝，不删除事实强行回退。验收证明已定义的故障边界，不承诺外部网络永不失败。

See [Owner guide / 老板指南](../guides/OWNER_GUIDE.md) for operations and [original architecture plan / 原架构方案](BOSS_PAPERCLIP_REFACTOR_PLAN.md) for the fixed design baseline.
