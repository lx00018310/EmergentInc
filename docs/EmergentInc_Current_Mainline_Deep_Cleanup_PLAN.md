# EmergentInc 当前主链彻底清理 Plan
## 目标：删除历史冗余，只保留当前 TypeScript 主链 + 有价值运行状态

> 基于当前 GitHub `main` 分支与上传的 `workspace.zip` 实查整理。
>
> 本 Plan 的原则不是“归档”，而是：
>
> **白名单保留，其余直接删除。**
>
> 不创建 archive，不保留 recovery 备份，不保留旧版本实验快照，不保留“以后可能有用”的历史日志。

---

# 0. 先回答一个关键问题

## `live/ledger/v9_core.sqlite3` 可以删除

仓库根目录目前仍被 Git 跟踪：

```text
live/ledger/v9_core.sqlite3
```

当前 TypeScript 服务实际代码：

```ts
const workspaceRoot = path.resolve(projectRoot, "workspace");
const ledgerDir = path.resolve(workspaceRoot, "ledger");
const dbPath = path.resolve(ledgerDir, "v9_core.sqlite3");
```

因此真正主链读取的是：

```text
workspace/ledger/v9_core.sqlite3
```

不是：

```text
live/ledger/v9_core.sqlite3
```

结论：

```text
根目录 live/ledger/v9_core.sqlite3
→ 历史遗留
→ 整个根目录 live/
→ 直接删除
```

并在 `.gitignore` 中加入：

```gitignore
/live/
```

防止再次误提交。

---

# 1. `workspace/ledger/v9_core.sqlite3` 的处理不同

当前 Runtime 中：

```text
workspace/ledger/v9_core.sqlite3
```

是当前 TypeScript CoreStore 的权威数据库。

它保存：

```text
pixel_accounts
runs
messages
reservations
model_calls
effects
ledger_entries
tool_executions
global_budget
recovery_decisions
...
```

因此：

```text
不能单纯删除后继续运行
```

否则：

```text
live/pixels/ 中虽然还存在 Pixel 文件
但 CoreStore 中没有 pixel_accounts

结果：
energy = 0
active = false
Scheduler 不会正常唤醒这些 Pixel
```

本次正确方式不是保留旧数据库，而是：

```text
删除旧数据库
↓
创建一个全新的 v9_core.sqlite3
↓
只重新写入要保留 Pixel 的 pixel_accounts
↓
其他历史表全部为空
```

这样既删除历史，又保留当前世界继续运行能力。

---

# 2. 当前 workspace 实查结论

上传 workspace 当前约：

```text
654 个文件
约 9.97 MB
```

其中：

```text
recovery_backups/   约 9.28 MB
loops/              280 个历史 checkpoint 文件
live/artifacts/     101 个 artifact
runs/               12 个旧 run_report
runtime/            旧 queue / log / lock
ui_state/           旧 UI 状态
```

真正长期有价值的数据只占很小一部分。

---

# 3. Workspace 最终只保留这些内容

最终目标：

```text
workspace/
├─ live/
│  ├─ world_state.json
│  ├─ environment.md
│  │
│  ├─ pixels/
│  │  ├─ -1_0_0/
│  │  │  ├─ state.json
│  │  │  ├─ pixel.md
│  │  │  └─ tips.md
│  │  ├─ 0_0_0/
│  │  │  ├─ state.json
│  │  │  ├─ pixel.md
│  │  │  └─ tips.md
│  │  ├─ 0_1_0/
│  │  │  ├─ state.json
│  │  │  ├─ pixel.md
│  │  │  └─ tips.md
│  │  ├─ 1_0_0/
│  │  │  ├─ state.json
│  │  │  ├─ pixel.md
│  │  │  └─ tips.md
│  │  └─ 2_0_0/
│  │     ├─ state.json
│  │     ├─ pixel.md
│  │     └─ tips.md
│  │
│  └─ artifacts/
│     ├─ 0_0_0/
│     │  ├─ offer_v2.md
│     │  ├─ pitch_v3.txt
│     │  ├─ product_landing.html
│     │  └─ experiment_findings.md
│     │
│     └─ 1_0_0/
│        └─ service_README_writing_sample.md
│
├─ ledger/
│  └─ v9_core.sqlite3
│
├─ runtime/
│  └─ genesis_prompt.json
│
└─ private/
   ├─ tools.json
   ├─ owner_vps_profile.json
   └─ 微信个人收款码.jpeg
```

除此之外全部删除。

---

# 4. 保留的 5 个主世界 Pixel

当前主世界只保留：

```text
-1_0_0
0_0_0
0_1_0
1_0_0
2_0_0
```

这是原始持续演化主世界。

以下属于后续功能实验 / 临时实验 Pixel：

```text
0_0_1
1_1_0
10_0_0
11_0_0
12_0_0
12_1_0
20_0_0
```

全部删除：

```text
workspace/live/pixels/0_0_1/
workspace/live/pixels/1_1_0/
workspace/live/pixels/10_0_0/
workspace/live/pixels/11_0_0/
workspace/live/pixels/12_0_0/
workspace/live/pixels/12_1_0/
workspace/live/pixels/20_0_0/
```

对应 artifact 目录同步删除。

---

# 5. 压缩保留 Pixel 的 pixel.md

不能简单留下当前 `pixel.md`。

当前几个 Pixel 的心智已经夹杂大量：

```text
R100 / R120 / R139 等轮次日志
旧 energy 波动
probe 文件测试
status_log 文件测试
旧工具回执
旧通道异常
已完成实验
已删除 artifact 引用
```

这些已经不是长期心智，而是运行日志。

## 重写规则

本地 AI 对保留的 5 个 Pixel 执行一次语义压缩。

每个 `pixel.md` 最终只保留：

```text
1. Pixel 身份 / 父代 / 世代
2. 当前长期目标
3. 已经真正验证过的长期事实
4. 当前已有能力 / 可复用资产
5. 当前仍然有效的长期策略
6. 当前重要约束
```

删除：

```text
逐轮日志
临时调试记录
旧 energy 差分
旧 status_log / probe 引用
已经解决的问题
实验验证过程
瞬时工具调用结果
旧回执
已删除文件名
```

建议：

```text
每个 pixel.md 控制在 300~800 中文字
```

禁止为了压缩而编造新事实。

---

# 6. Tips 只保留“当前仍未解决”的提醒

对保留 Pixel：

```text
tips.md
```

重新审查。

规则：

```text
问题仍真实存在
→ 保留

问题已解决 / 属于旧实验 / 属于被删除文件
→ 清空
```

例如当前 `0_0_0/tips.md` 中涉及：

```text
VPS 工具目录不同步
旧 status_log 覆写事件
```

本地 AI 必须对照当前代码与当前 `/api/tools` 状态。

如果问题已经不存在：

```text
tips.md = ""
```

不要保留历史告警。

---

# 7. 简化 retained state.json

当前 `state.json` 中还有旧字段：

```text
sleep_until_round
inbox_call_budget_per_round
neighbors
```

当前 TypeScript 主链已经不读取这些字段：

```text
neighbors → 动态由 getNeighbors6() 计算
sleep_until_round → 当前主链未使用
inbox_call_budget_per_round → 当前主链未使用
```

保留 `state.json` 只需要：

```json
{
  "id": "0_0_0",
  "position": [0, 0, 0],
  "active": true,
  "energy": 100,
  "parent": null,
  "born_round": 0,
  "last_active_round": 60,
  "generation": 0
}
```

对 5 个保留 Pixel 全部统一成这一结构。

注意：

```text
energy / active
最终必须与新 SQLite pixel_accounts 一致
```

---

# 8. world_state.json 也去掉冗余字段

当前：

```json
{
  "round": 61,
  "active_pixels": 5,
  "total_messages": 0,
  ...
}
```

其中：

```text
active_pixels
total_messages
```

当前 `WorldService` 不依赖它们。

`active_pixels` 实际来自：

```text
SQLite pixel_accounts
```

因此最终简化：

```json
{
  "round": 61,
  "external_accounting": {
    "CNY_in": 0,
    "CNY_out": 0,
    "USD_in": 0,
    "USD_out": 0
  },
  "counters": {
    "external_requests": 0,
    "capabilities_granted": 0,
    "external_events": 0
  }
}
```

保留：

```text
round = 61
```

不要重置为 0。

原因：

5 个保留 Pixel 的 `born_round` / `last_active_round` 已经属于当前时间轴。

从下一轮继续：

```text
Round 62
```

即可。

---

# 9. Artifacts：只保留真正可复用成果

当前：

```text
101 个 artifact
```

绝大多数是：

```text
status_log_rXX
report_RXX
probe
test
旧 offer
重复副本
实验文件
```

直接删除。

## 仅保留

### `0_0_0`

```text
offer_v2.md
pitch_v3.txt
product_landing.html
```

这三个分别代表：

```text
正式服务定义
对外短文案
可部署 Landing Page
```

有明确复用价值。

### `1_0_0`

保留：

```text
service_README_writing_sample.md
```

它是一个实际服务交付样例。

---

# 10. 删除 artifact 重复副本

当前多份 artifact 内容完全相同：

```text
offer_v1.md × 4
offer_v2.md × 4
pitch_v3.txt × 3
product_landing.html × 4
report_R80.md × 2
```

只留：

```text
0_0_0/offer_v2.md
0_0_0/pitch_v3.txt
0_0_0/product_landing.html
```

其余所有副本删除。

---

# 11. 删除所有 status / probe / test / round report artifact

全部删除：

```text
status_log*
status_update*
probe*
test_*
report_R*
readme_service_sample.txt
sample_readme_service.txt
offer_v1*
service_catalog*
service_offer*
服务清单*
```

以及其他属于：

```text
运行日志
验收日志
测试输入
临时探测
旧版本报价
```

的文件。

---

# 12. V11 实验只留一个结论文件

当前：

```text
workspace/live/external_events/
```

包含：

```text
exp1_setup.json
exp1_result.json
exp1_legacy_pause.json
exp2_result.json
exp3_result.json
v11_final_acceptance_report.json
```

这些都是历史实验过程。

不要全部保留。

## 先生成一个：

```text
workspace/live/artifacts/0_0_0/experiment_findings.md
```

内容只总结最终有价值结论：

```text
Q1：不同历史能够形成不同积累 —— 已观察到
Q2：历史积累可降低后续成本 —— 已观察到
Q3：自主交换动机 —— 尚未观察到
Q4：信息 / artifact / energy 交换机制 —— 技术机制可用，但自主协商未观察到
Q5：历史可形成稳定行为差异 —— 部分观察到
```

并附：

```text
这些结论来自 V11 实验，原始实验过程已清理。
```

不要保存逐轮证据。

生成后：

```text
workspace/live/external_events/
```

整个目录删除。

---

# 13. external_requests 全删

当前：

```text
workspace/live/external_requests/
```

全部是旧 Owner 请求：

```text
VPS
支付通道
发布通道
收款方式
```

其中大量内容重复。

当前 TypeScript 主链也没有把这些 JSON 当作运行真值。

整个目录删除：

```text
workspace/live/external_requests/
```

---

# 14. recovery_backups 整个删除

直接：

```text
rm -rf workspace/recovery_backups
```

或 Windows 等价操作。

不保留任何：

```text
旧 sqlite
旧 wal
旧 message_queue
旧 checkpoint
旧 recovery log
旧 reset snapshot
```

这是当前 workspace 最大冗余来源。

---

# 15. loops 整个删除

当前：

```text
workspace/loops/
```

包含：

```text
L000001 ~ L000012
before/
after/
meta.json
```

这是旧 Loop Snapshot 系统。

当前 TypeScript `RoundScheduler` / `RunService` 不读取：

```text
workspace/loops
```

所以：

```text
workspace/loops/
→ 整个删除
```

---

# 16. runs 整个删除

当前：

```text
workspace/runs/L000001~L000012/run_report.json
```

全部旧 Run Report。

当前 Run 历史已经由 SQLite `runs` 表负责。

而本次又要重建 SQLite，旧 Run 也不保留。

因此：

```text
workspace/runs/
→ 整个删除
```

---

# 17. ui_state 整个删除

当前：

```text
workspace/ui_state/command_history.jsonl
workspace/ui_state/latest_flow.json
```

当前 React 前端不依赖这两个文件。

删除：

```text
workspace/ui_state/
```

---

# 18. runtime 只保留 genesis_prompt.json

当前：

```text
runtime/
├─ exp_server_stderr.log
├─ exp_server_stdout.log
├─ genesis_prompt.json
├─ server.lock
├─ server.stderr.log
├─ server.stdout.log
├─ temporary_prompt.json
└─ v9_message_queue.json
```

最终只保留：

```text
genesis_prompt.json
```

删除：

```text
exp_server_stderr.log
exp_server_stdout.log
server.lock
server.stderr.log
server.stdout.log
v9_message_queue.json
temporary_prompt.json
```

`temporary_prompt.json` 是当前一次性任务：

```text
“有哪些pixel，有积压的任务……”
```

不属于长期配置。

删除后 PromptService 会自然把 Temporary Prompt 当作关闭。

---

# 19. ledger 整个重建

当前 workspace 上传包中：

```text
workspace/ledger/
```

只有：

```text
energy_ledger.jsonl
```

这是旧 ledger 格式。

删除：

```text
workspace/ledger/
```

然后重新创建：

```text
workspace/ledger/v9_core.sqlite3
```

---

# 20. 新 SQLite 的正确重建方式

不要：

```text
复制旧 recovery sqlite
```

不要：

```text
手工 CREATE TABLE
```

使用当前：

```ts
CoreStore
```

初始化新的数据库。

临时脚本逻辑：

```ts
const store = new CoreStore("workspace/ledger/v9_core.sqlite3");
```

这会创建当前 schema。

然后对 5 个保留 Pixel：

```text
-1_0_0
0_0_0
0_1_0
1_0_0
2_0_0
```

读取：

```text
live/pixels/<id>/state.json
```

执行：

```ts
store.pixels.upsertPixelAccount({
  pixelId: state.id,
  energy: state.energy,
  active: state.active,
  refundDeficitTokens: 0,
  spendBlockedReason: null
});
```

只恢复这 5 条账户。

---

# 21. 新 SQLite 中必须为空的历史表

重建后：

```text
runs                 = 0
messages             = 0
reservations         = 0
model_calls          = 0
effects              = 0
ledger_entries       = 0
external_revenues    = 0
external_refunds     = 0
recovery_decisions   = 0
external_reward_requests = 0
tool_executions      = 0
```

仅允许：

```text
pixel_accounts = 5
global_budget  = 1
schema_meta    = 当前 schema 所需记录
```

如果存在任何旧 Run / Message / ModelCall：

```text
说明清理失败
```

---

# 22. Global Budget

如果执行前存在当前有效：

```text
workspace/ledger/v9_core.sqlite3
```

只读取并保留：

```text
global_budget.total_limit
```

不要保留：

```text
total_spent
total_reserved
```

新的：

```text
total_spent = 0
total_reserved = 0
```

如果执行前没有当前数据库：

使用 CoreStore 默认：

```text
1,000,000
```

即可。

---

# 23. private 只保留当前真实能力

保留：

```text
workspace/private/tools.json
workspace/private/owner_vps_profile.json
workspace/private/微信个人收款码.jpeg
```

因为这些仍代表：

```text
当前 VPS 能力
当前工具配置
当前支付资产
```

删除：

```text
workspace/private/README.md
```

不要在清理日志中打印：

```text
密码
凭据
图片内容
敏感配置全文
```

---

# Part B：Git 仓库本身也一起清理

# 24. 删除根目录历史 live/

直接删除：

```text
live/
```

当前其中只有旧：

```text
live/ledger/v9_core.sqlite3
```

当前主链完全不引用。

同时 `.gitignore` 增加：

```gitignore
/live/
```

---

# 25. 删除所有旧 Python tests

当前项目已经是：

```text
Node.js + TypeScript + Vitest
```

根目录 `package.json` 的测试命令：

```text
vitest run
```

当前有效测试已经分布在：

```text
apps/server/tests/*.test.ts
frontend/tests/*
packages/*/tests/*.test.ts
tests/parity/golden_scenarios.test.ts
```

而：

```text
tests/*.py
```

属于旧 Python Runtime。

全部删除：

```text
tests/__init__.py
tests/test_*.py
```

---

# 26. 删除旧 Golden Python Fixtures

当前：

```text
tests/parity/golden_scenarios.test.ts
```

并不读取：

```text
tests/fixtures/golden/*
```

这些 fixture 是旧 V9 Python → V10 迁移时产生的比较材料。

删除：

```text
tests/fixtures/golden/
```

保留：

```text
tests/parity/golden_scenarios.test.ts
```

---

# 27. 删除 scripts/dump_golden_fixtures.py

当前：

```text
scripts/dump_golden_fixtures.py
```

仍然 import：

```text
emergentinc.tools...
emergentinc.engine...
```

但当前仓库已经没有旧：

```text
emergentinc/
```

Python package。

所以这是明确死代码。

删除：

```text
scripts/dump_golden_fixtures.py
```

如果 `scripts/` 变空：

```text
scripts/
```

也删除。

---

# 28. resources 只保留当前 Runtime 真正读取的资源

当前主链明确读取：

```text
resources/config/model_pricing.json
resources/prompts/v9_system_prompt.md
```

保留：

```text
resources/
├─ config/
│  └─ model_pricing.json
└─ prompts/
   └─ v9_system_prompt.md
```

---

# 29. 删除旧 resources

当前 TypeScript 主链没有引用下列旧资源：

```text
resources/bootstrap/
resources/experiments/
resources/schemas/
resources/templates/
resources/config/world_config.json
resources/prompts/evidence_validator_prompt.md
resources/prompts/memory_update_prompt.md
resources/prompts/pixel_decision_prompt.md
```

全部删除。

这些属于：

```text
V3/V5/V8/V9 Python 架构
旧 Problem / Market / Evidence 系统
旧 Genome / Memory 模板
旧 Bootstrap / Loop 体系
```

---

# 30. docs 做一次彻底收敛

当前 `docs/` 中存在大量：

```text
V4
V5
V8
V9
V9.5
V10
V11
Migration
Implementation Report
Fix Plan
Rectification Plan
旧 UI Plan
旧 Python 架构文档
```

这些已经成为历史噪声。

不要继续保留版本 Plan。

---

# 31. docs 最终只保留 7 个当前文档

先根据**当前代码**重写以下文档：

```text
docs/architecture.md
docs/runtime_invariants.md
docs/security_boundary.md
docs/world_rules.md
docs/pixel.md
docs/loop.md
docs/guides/OWNER_GUIDE.md
```

要求：

```text
只描述当前 TypeScript 主链
不要写 V8/V9/V10 迁移历史
不要写已经不存在的 Python 模块
不要写旧 Loop Snapshot
不要写 Problem / Market 等已移除系统
```

---

# 32. 删除 docs 其余全部文件

完成上面 7 个当前文档后：

```text
docs/
```

除这 7 个之外全部删除。

包括但不限于：

```text
DIRECTORY_REFACTOR_PLAN.md
EmergentInc_Minimal_CrystalLattice_Tips_PLAN.md
EmergentInc_Minimal_Light_ThreeJS_3D_PLAN.md
EmergentInc_V10_*.md
EmergentInc_V11_*.md
EmergentInc_V8_*.md
EmergentInc_V9_*.md
FRONTEND_TYPESCRIPT_MIGRATION_PLAN.md
LOCAL_CORE_SLIMMING_PLAN.md
RECOVERY_REQUIRED*.md
TOOLS_VPS_TEMP_PROMPT_PLAN.md

V8_CONSTITUTION.md
V8_IMPLEMENTATION_REPORT.md
V9_CONSTITUTION.md
V9_IMPLEMENTATION_REPORT.md
V9_MIGRATION_REPORT.md
V9_TEST_REPORT.md

docs/history/*
docs/V

actions.md
agent_runtime.md
anti_bias.md
api_runtime_v5.md
capability_gateway.md
environment.md
evidence.md
evolution.md
implementation_contract.md
metrics.md
migration_from_v2.md
model_adapter.md
owner_boundary_v5.md
problem.md
real_customer_policy.md
real_money.md
resource.md
self_check.md
space.md
v4_open_world.md
v5_cognitive_sandbox.md
v95-main-chain-review.html

guides/AGENT_RUNNER_PROMPT.md
guides/BOOTSTRAP_PROMPT.md
guides/DEV_AGENT_GUIDE.md
guides/MASTER_PROMPT.md
```

如果 `ssh_vps_profile.example.json` 对当前 Owner Guide 仍有明确用途，可以重新生成一个与当前 `owner_vps_profile.json` schema 一致、但不含真实凭据的例子；否则删除。

---

# 33. README.md 更新

根 README 只描述最终结构：

```text
apps/
packages/
frontend/
resources/
workspace/
tests/parity/
docs/
```

删除 README 中：

```text
旧 Python
旧 Loop Store
旧 Bootstrap
旧目录迁移
旧版本描述
```

明确：

```text
workspace/ 不进 Git
SQLite = workspace/ledger/v9_core.sqlite3
Pixel 文件 = workspace/live/pixels/
Artifact = workspace/live/artifacts/
```

---

# 34. `.gitignore` 收敛

至少确保：

```gitignore
workspace/
/live/
.env
node_modules/
frontend/dist/
dist/
*.tsbuildinfo
```

可以删除纯 Python 项目遗留的 ignore：

```text
__pycache__/
*.py[cod]
.pytest_cache/
```

因为仓库已经不再使用 Python。

如果未来没有 Python 工具，直接去掉。

---

# Part C：执行顺序

# 35. Phase 1 — 停止服务

必须先停止：

```text
EmergentInc Server
Vite
任何 Run
```

确认：

```text
workspace/.engine.lock
```

没有活跃进程。

如果只是僵尸 lock：

删除。

---

# 36. Phase 2 — 语义压缩

在删除文件前，只做两件“提炼价值”的操作：

### A. 压缩 5 个 retained pixel.md

### B. 生成：

```text
experiment_findings.md
```

除此之外：

```text
不做 archive
不复制 backup
```

---

# 37. Phase 3 — Workspace 白名单删除

最简单的实现方式：

本地 AI 根据最终 whitelist：

```text
列出 workspace 所有文件
↓
文件不在 whitelist
↓
直接删除
```

不要维护复杂黑名单。

最终 whitelist 只允许：

```text
live/world_state.json
live/environment.md

live/pixels/<5 retained pixels>/{state.json,pixel.md,tips.md}

live/artifacts/0_0_0/
  offer_v2.md
  pitch_v3.txt
  product_landing.html
  experiment_findings.md

live/artifacts/1_0_0/
  service_README_writing_sample.md

runtime/genesis_prompt.json

private/tools.json
private/owner_vps_profile.json
private/微信个人收款码.jpeg
```

`ledger/v9_core.sqlite3` 在删除完成后重新生成。

---

# 38. Phase 4 — 重建 SQLite

删除旧 ledger 后：

```text
mkdir workspace/ledger
```

用当前 `CoreStore` 创建：

```text
workspace/ledger/v9_core.sqlite3
```

然后 seed 5 个 Pixel。

不要恢复任何历史：

```text
run
message
model call
effect
reservation
ledger entry
tool execution
recovery decision
```

---

# 39. Phase 5 — Repo 清理

按上述 Repo 删除清单执行。

然后：

```bash
git status --short
```

确认删除范围合理。

---

# Part D：验收

# 40. 文件结构验收

Workspace 顶层只能有：

```text
live
ledger
runtime
private
```

禁止出现：

```text
loops
runs
ui_state
recovery_backups
cache
scratch
```

---

# 41. SQLite 验收

执行 SQL：

```sql
SELECT COUNT(*) FROM pixel_accounts;
```

必须：

```text
5
```

以下必须：

```text
0
```

```sql
SELECT COUNT(*) FROM runs;
SELECT COUNT(*) FROM messages;
SELECT COUNT(*) FROM reservations;
SELECT COUNT(*) FROM model_calls;
SELECT COUNT(*) FROM effects;
SELECT COUNT(*) FROM ledger_entries;
SELECT COUNT(*) FROM tool_executions;
SELECT COUNT(*) FROM recovery_decisions;
```

---

# 42. UI 验收

启动服务后：

```text
/api/world
```

应显示：

```text
5 个 Pixel
Round 61
```

各 Pixel：

```text
energy > 0
active = true
```

3D UI 中不得再出现：

```text
10_0_0
11_0_0
12_0_0
12_1_0
20_0_0
0_0_1
1_1_0
```

---

# 43. Runtime 验收

运行 1 Round。

预期：

```text
Round 61 → 62
```

SQLite 新增：

```text
1 个新的 run
新的 messages / model_calls / effects
```

并且不存在历史旧记录。

---

# 44. Repo 验收

运行：

```bash
npx pnpm build
npx pnpm test
npx pnpm typecheck
```

全部通过。

`npm/pnpm test` 应只运行当前：

```text
apps/server
frontend
packages/*
tests/parity
```

不再有 Python 测试。

---

# 45. 搜索历史引用

执行：

```bash
rg -n "emergentinc\.engine|emergentinc\.tools|pytest|V8_|V9_|workspace/loops|recovery_backups|v9_message_queue|owner_private|pixel_decision_prompt|world_config.json" .
```

除非是当前 README 明确解释历史删除，否则结果应该接近：

```text
0
```

---

# 46. 最终完成定义

完成后，项目应从：

```text
多版本历史叠加仓库
+
多代 workspace
+
Python / TS 混杂
+
Loop / Run / Recovery 重复体系
```

变成：

```text
当前 TypeScript 主链
+
一份干净当前世界
+
一份干净 SQLite
+
5 个有价值 Pixel
+
少量真正可复用 Artifact
+
少量当前文档
```

核心原则：

```text
代码历史 → Git 自己负责

运行历史 → 不保留

实验过程 → 不保留

有价值结论 → 压缩后保留

当前世界 → 保留

当前能力 / 私有资产 → 保留
```

到此停止，不再为历史数据保留任何兼容层。
