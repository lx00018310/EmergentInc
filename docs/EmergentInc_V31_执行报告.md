# V31 执行报告 / Execution report

日期 / Date：2026-10-14；分支 / Branch：`develop`；起点 / Baseline：`dc366a8`。

**S1–S3 实施完成，代码与本地验证通过。正式收款验收仍未完成：原实例没有配置收款通道，本次只在隔离实例使用测试通道验证上架、订单及发票，没有真实转账。**

**S1–S3 implementation and local verification passed. Live payment acceptance remains incomplete: the original instance has no payment rail. Publication, orders and invoices were exercised using an isolated synthetic rail; no funds were transferred.**

## 实际改动 / Changes

| 文件 / Files | 原因 / Purpose |
| --- | --- |
| `apps/server/src/services/owner_automation_gate.ts`、`routes/owner_routes.ts` | 集中 10M 自动授信与按需续批；保留 CAS、累计账本、硬上限、人工 OFF、维护与 UNKNOWN；当前明确指令启动/恢复，暂停和恢复回执幂等 / Central quota, durable pause and idempotent control |
| `packages/persistence/src/world_registry_store.ts`、`apps/server/src/services/world_runtime_manager.ts` | 新 World 创建事务初始化入口无限能量；只给当前有效入口补能，老设置不迁移 / New gateways only; legacy settings retained |
| `apps/server/src/world_bootstrap.ts` | 自动经营的真实模型适配器关闭内部自动重发；连接后结果未知交给既有核验 / No automatic redispatch of uncertain model calls |
| `apps/server/src/services/owner_chat_service.ts`、`owner_work_service.ts`、`app.ts` | 扩展原意图路由和依赖注入，复用现有目标、调度、招聘和请求缓存 / Existing routing, goals, recruitment and caches reused |
| 新增 / New：`apps/server/src/services/owner_product_service.ts`；修改 / Updated：`public_store.ts`、`app_code_policy.ts` | 当前 Owner 的受控商品写入、稳定新品 ID、双语和价格校验、读回回执；保护该权限代码，不注册 World 发布工具 / Scoped product writes and protected permission code |
| `owner_goal_scheduler.ts`、`owner_overview_service.ts` | 来源检索指令；研究交付后按受限意图续接；待办和实际发布记录 / Source instructions, bounded continuation and actual receipts |
| `frontend/src/features/owner/OwnerConsole.tsx`、`OwnerCompany.tsx`、`OwnerGoals.tsx`、`owner.css` | Boss 对话默认入口；紧凑开关、目标、待办和费用；额度只读、高级验收折叠 / Chat-first console and compact status |
| `frontend/src/features/owner/OwnerChat.tsx`、`frontend/src/api/owner.ts` | 真实目标/商品回执、草稿与重试保留；Enter、Shift+Enter、Ctrl/Cmd+Enter 和 IME / Actual receipts, drafts and keyboard handling |
| `frontend/src/features/qianji/QianjiChatPanel.tsx`、`QianjiProfilePanel.tsx`、`WorldSummary.tsx` | 轮数、机能、入口切换折叠；20 轮默认及高级 10 轮仍可用 / Advanced runtime controls retained |
| `frontend/src/i18n/en.ts`、`zh-CN.ts` | 新标签、错误、状态及自动额度说明同步 / Both locales updated |
| 后端及前端对应测试；新增 `apps/server/tests/owner_business_chat.test.ts` | 并发进程、崩溃恢复、幂等、鉴权、受限续接、双语与 UI 回归 / Behavioral and permission regression coverage |
| `README.md`、`README_CN.md`、`docs/guides/OWNER_GUIDE.md` | 首次使用、真实 API 成本、自动续批、人工暂停、入口能量及商品发布说明 / First-use and operating documentation |

## Schema 与数据保留 / Schema and retention

- **仅新增一张表 `owner_product_intents`**，记录原请求、目标版本、商品/价格权限、交付文件、目标商品指纹及 `PENDING / PUBLISHED / BLOCKED / OUTCOME_UNKNOWN`。
- 路由检查点复用 `owner_control_requests`；`owner_dispatch_calls` 保持原来的 **6 列**，避免增加列使旧的 INSERT 失效。无新增通用动作框架或知识库。
- 商品写入、受限意图和回执使用同一 control SQLite 的事务；服务重开后按持久记录和哈希确认。未修改付款事实、私钥、8766 发布审批或 V30 资产隔离。
- 原有 `workspace` 只做只读检查；没有启动其写入服务、迁移其 World 能量设置或清理其中数据。运行实验全部使用临时隔离目录。

One association table was added. Routing checkpoints reuse the existing control-request cache, retaining the six-column dispatch schema. Existing payment facts, release approvals and V30 isolation remain intact. The original workspace was inspected read-only; experimental data is isolated.

## 测试结果 / Validation

| 检查 / Check | 结果 / Result |
| --- | --- |
| `pnpm.cmd typecheck` | 通过 / Passed（最终工作区） |
| `pnpm.cmd test --maxWorkers=4` | **117 个文件、1006 项通过，2 项既有跳过**；约 784 秒，含真实进程重启、升级、兼容回退和候选版本完整校验 / Full suite passed, including process lifecycle validation |
| 收尾后端回归 / Final backend regression | **6 个文件、102 项通过**；覆盖最后的请求缓存复用、显式恢复、跨连接续接、独立进程额度竞争、自主定价等 / Passed after final backend adjustments |
| `pnpm.cmd --dir frontend build` | 通过 / Passed；保留既有大体积 chunk 提示，未为此做无关拆包 |
| 双语及 UI / UI and locales | 默认入口、旧深链、开关、只读额度、快捷键、IME、真实回执、20/10 轮及中英键集合通过 / Covered by UI and full-suite tests |

第一轮全量测试发现的旧额度/补能断言已按新策略更新，保留其对应阻塞、恢复与权限验证。第二轮全量通过后，收尾的缓存复用及恢复分支另外通过上述 102 项专项，未将旧的全量数字冒充收尾后的新全量数字。

The full-suite result and the subsequent focused regression are reported separately. Existing safety tests were retained; assertions tied to superseded defaults were updated.

完整日志保留于仓库忽略目录 / Logs (ignored directory)：

- `cache/v31-execution-20261014-01a13a37/full-test-final.log`
- `cache/v31-execution-20261014-01a13a37/final-backend-test.log`
- `cache/v31-execution-20261014-01a13a37/typecheck.log`
- `cache/v31-execution-20261014-01a13a37/build.log`

## 浏览器与真实模型 E2E / Browser and real-model E2E

地址 / URL：`http://127.0.0.1:18765`（测试服务已关闭 / stopped）。

隔离目录 / Isolated data：`C:/Users/ASUS/AppData/Local/Temp/emergentinc-v31-e2e-8R9znF`。

1. 用已配置的真实 `glm-5.3-flash` 在 `/OWNER` 输入经营目标，自动 `ON / 10,000,000` 并持久建目标。无人可用时产生招聘待办，未虚构执行完成。
2. 无 rail 时要求 19.9 USDT 双语商品上架，实际保存未启用草稿，回执明确“未上架／缺少收款通道”。真实模型暴露的否定语义误判已修复并补测。
3. OFF 后重启服务、重新登录：额度、用量、目标、请求检查点保留，仍 OFF。明确 ON 后恢复已保存商品意图，没有再调用模型处理同一意图。
4. 仅在隔离实例配置合成 BSC 测试通道，再用英文明确要求上架。公开商城中英文实际可见，数据库读回 `enabled=1`、价格 `19.900000`，有真实持久事件回执。
5. 使用 `example.invalid` 测试联系方式生成一笔订单与发票；订单为 `AWAITING_PAYMENT`、发票为 `WAITING`，链上回执和收入记录均为 **0**。未打开钱包或转账。
6. 测试结束关闭服务并保持 OFF；最终自动授信事件仅 **1** 次，4 次真实路由模型调用累计 **6684 Tokens**。费用账本按本机定价计算，不能替代服务商账单核对。

The real model created a durable goal and bilingual product data. Missing rails produced an explicit unpublished draft. After a restart, manual OFF and cumulative usage survived. A synthetic rail enabled public visibility and a pending test invoice; no payment or revenue was claimed. Research-to-publication continuation was exercised through the actual World runtime and persistent tool receipts with controlled test sources, not a live market-success claim.

证据 / Evidence：

- [隔离 E2E 结构化结果 / Result](evidence/v31-e2e-result.json)
- [中文草稿回执 / Draft receipt](evidence/v31-owner-draft-zh.png)
- [英文发布回执 / Publication receipt](evidence/v31-owner-published-en.png)
- [英文商城 / English store](evidence/v31-store-en.png)
- [中文商城 / Chinese store](evidence/v31-store-zh.png)

**待验收 / Outstanding**：真实可用收款通道及链上到账；真实人员/市场资料驱动的业务成果仍须按现有审批和证据规则验收。本次合成通道不得用于收款。未部署、未推送、未创建 Git 提交，原计划文件与其他用户工作保留。

Live payment rails and confirmed on-chain receipts remain unverified. Real staffing and market outcomes still require their existing approvals and evidence. No deployment, push or Git commit was performed.

## 最终 git diff --stat / Final tracked diff

未跟踪的新商品服务、业务测试、本报告和证据文件不包含在下面统计中，已在上文单独列明。用户原先未跟踪的执行计划未改动。

```text
README.md                                          | 14 ++--
 README_CN.md                                       | 16 ++--
 apps/server/src/app.ts                             |  4 +
 apps/server/src/routes/owner_routes.ts             | 34 +++++++-
 apps/server/src/services/app_code_policy.ts        |  2 +-
 apps/server/src/services/owner_automation_gate.ts  | 43 ++++++++--
 apps/server/src/services/owner_chat_service.ts     |  8 +-
 apps/server/src/services/owner_goal_scheduler.ts   |  8 +-
 apps/server/src/services/owner_overview_service.ts | 11 +++
 apps/server/src/services/owner_work_service.ts     | 37 +++++++--
 apps/server/src/services/public_store.ts           |  5 ++
 apps/server/src/services/world_runtime_manager.ts  |  6 +-
 apps/server/src/world_bootstrap.ts                 |  2 +-
 apps/server/tests/business.test.ts                 | 10 +--
 apps/server/tests/owner_global_automation.test.ts  | 96 +++++++++++++++-------
 apps/server/tests/owner_goal_scheduler.test.ts     |  7 +-
 apps/server/tests/owner_work.test.ts               |  6 +-
 apps/server/tests/world_product_routes.test.ts     |  6 +-
 docs/guides/OWNER_GUIDE.md                         | 10 +--
 frontend/src/api/owner.ts                          |  3 +-
 frontend/src/features/owner/OwnerChat.tsx          | 21 +++--
 frontend/src/features/owner/OwnerCompany.tsx       | 27 +++---
 frontend/src/features/owner/OwnerConsole.tsx       | 14 +++-
 frontend/src/features/owner/OwnerGoals.tsx         |  4 +-
 frontend/src/features/owner/owner.css              | 10 +++
 frontend/src/features/qianji/QianjiChatPanel.tsx   |  4 +-
 .../src/features/qianji/QianjiProfilePanel.tsx     |  6 +-
 frontend/src/features/qianji/WorldSummary.tsx      |  7 +-
 frontend/src/i18n/en.ts                            | 43 +++++++++-
 frontend/src/i18n/zh-CN.ts                         | 43 +++++++++-
 frontend/tests/owner_chat.test.tsx                 | 18 ++++
 frontend/tests/owner_console.test.tsx              |  6 +-
 frontend/tests/owner_goals.test.tsx                | 16 ++--
 frontend/tests/qianji_panels.test.tsx              |  2 +-
 packages/persistence/src/world_registry_store.ts   |  7 +-
 35 files changed, 417 insertions(+), 139 deletions(-)
```
