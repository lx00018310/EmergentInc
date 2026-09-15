# EmergentInc V8 — Minimal Kernel 实施与验收报告

> **实施依据**：`docs/EmergentInc_V8_Minimal_Kernel_IMPLEMENTATION_PLAN.md`  
> **实施状态**：P0 / P1 / P2 全阶段工程构建完成，全量 32 项自动化测试 100% 通过，已完成 V7.1 -> V8 数据平滑迁移。

---

## 1. 新增文件清单

| 文件路径 | 模块性质 | 核心职责 |
| :--- | :--- | :--- |
| `emergentinc/engine/workspace_jail.py` | 核心安全 | 实现元胞工作区路径归一化、Root Jail 限制、越界防护与安全命令执行。 |
| `emergentinc/engine/market.py` | 商业环境 | 实现 Market 看板读写、解析、主动认领 (`CLAIM`) 与结果验证结算 (`SUBMIT`)。 |
| `emergentinc/cli/migrate_v8.py` | 迁移工具 | 自动创建 Loop 快照、迁移历史问题至 Market、升级元胞至 V8 结构。 |
| `docs/V8_CONSTITUTION.md` | 宪法规范 | 确立 V8 极简生命内核与实验仪器的 15 条基本原则。 |
| `docs/V8_IMPLEMENTATION_REPORT.md` | 交付报告 | 本交付验收总结报告。 |
| `tests/test_v8_pixel_ownership.py` | 单元测试 | 验证元胞自我定义控制权与私有文件防窥边界。 |
| `tests/test_v8_workspace_jail.py` | 单元测试 | 验证工作区数字自由与防路径穿越（Jail）。 |
| `tests/test_v8_neighbor_message_only.py` | 单元测试 | 验证仅限六邻域直接通信约束。 |
| `tests/test_v8_message_energy_transfer.py` | 单元测试 | 验证消息附带 Energy 划转及防透支。 |
| `tests/test_v8_attachment_snapshot.py` | 单元测试 | 验证消息附件快照隔离与不可变性。 |
| `tests/test_v8_market_not_auto_visible.py` | 单元测试 | 验证公开市场机会默认不进入局部感知。 |
| `tests/test_v8_read_market.py` | 单元测试 | 验证主动市场探索 (`READ_MARKET`) 与多方参与。 |
| `tests/test_v8_reproduction_energy_conservation.py` | 单元测试 | 验证繁衍能量守恒与 Birth Cost 消耗机制。 |
| `tests/test_v8_child_self_defined.py` | 单元测试 | 验证子元胞身份自由定义与代际遗产继承。 |
| `tests/test_v8_no_role_fields.py` | 单元测试 | 验证不变量禁止组织与角色预定义字段。 |
| `tests/test_v8_no_genome_runtime.py` | 单元测试 | 验证运行时剥离 genome 人格浮点数参数依赖。 |
| `tests/test_v8_api_sandbox_no_global_view.py` | 单元测试 | 验证认知沙箱局部性与全局泄露拦截。 |
| `tests/test_v8_owner_not_strategy.py` | 单元测试 | 验证 Owner 仅作为现实物理接口，拒绝代替决策。 |
| `tests/test_v8_loop_snapshot_workspace.py` | 单元测试 | 验证快照对工作区与市场文件的完整备份与恢复。 |
| `tests/test_v8_market_external_truth.py` | 单元测试 | 验证“AI说付款了 != 客户真付款了”外部真实性核验。 |

---

## 2. 修改文件清单

| 文件路径 | 修改要点 |
| :--- | :--- |
| `emergentinc/engine/storage.py` | 增加 `create_pixel_v8`、`pixel_self`、`pixel_public`、`pixel_inheritance`、`inbox_messages` 及 market 操作接口；使 `world()` 支持自动初始化默认状态。 |
| `emergentinc/engine/actions.py` | 彻底重构为 5 类原子动作（`WORK`, `MESSAGE`, `ASK_OWNER`, `REPRODUCE`, `WAIT`）与 14 种工作区内置工具调度，支持附件快照与能量转移。 |
| `emergentinc/engine/validator.py` | 废除旧版严苛的嵌套 Schema 罚款逻辑，转为物理合法性（存活、余额、邻域合法性、命令安全）校验。 |
| `emergentinc/engine/ledger.py` | 统一为单一代币 `Energy` 经济系统，实现代谢消耗、能量转移、繁衍守恒与市场悬赏结算。 |
| `emergentinc/engine/spawn.py` | 重构为 V8 繁衍系统，确保能量守恒扣减并初始化标准 V8 子元胞目录。 |
| `emergentinc/engine/local_view.py` | 仅暴露局部六邻域的 `id`, `active`, `energy`, `public.md`；严禁泄露邻居工作区及全局市场；优化自然代谢唤醒逻辑。 |
| `emergentinc/engine/context_sandbox.py` | 阻断任何全局字段输入，严格过滤违禁字段（`world_state`, `owner_private` 等）。 |
| `emergentinc/engine/runner.py` | 实现 V8 心流驱动循环（Sense -> Decide -> Validate -> Execute -> Feedback -> Metabolize），实时打印心流日志并支持 `ASK_OWNER` 挂起。 |
| `emergentinc/engine/invariants.py` | 增加严禁出现 `role`、`department`、`manager`、`genome` 等组织预定义字段的不变量强制检查。 |
| `emergentinc/engine/render_state.py` | 适配 V8 属性（Energy、Position、Parent、Sleep、Capabilities）状态渲染。 |
| `emergentinc/ui/world_reader.py` | 扩展 `ALLOWED_DOCS`（支持 self, public, memory, inheritance 等），在 World DTO 中暴露 V8 心流活动及开放市场机会。 |
| `emergentinc/ui/snapshot.py` | 在快照目录列表中增加 `market`。 |
| `resources/schemas/pixel_action.schema.json` | 适配 V8 极简决策 Schema 与 5 类动作参数结构。 |
| `resources/prompts/pixel_decision_prompt.md` | 重新确立 Pixel 自由生命体、自主市场探索与现实世界边界的决策提示词。 |

---

## 3. 删除/废弃的 V7 机制

1. **废除组织与角色预定义**：彻底移除了 `role`, `department`, `manager`, `profession`, `specialization` 字段与预设；
2. **废除固定基因浮点数体系**：停止运行时对 `genome.json`（`risk_tolerance`, `spawn_preference`, `cost_sensitivity` 等）的依赖，移入 `legacy/`；
3. **废除多状态机交易流**：生命内核层废除 `OFFER`, `BID`, `ACCEPT_BID`, `TRANSFER`, `ACCEPT`, `REJECT`，所有协作与资源协商由元胞自发通过 `MESSAGE` 承载；
4. **废除独立 Memory Summarizer LLM**：不再由外层系统决定元胞记忆，改为元胞在 `WORK` 中自主维护 `memory.md`；
5. **废除形式主义 Schema 罚款**：消除因 `work_output: {}` 为空或字段偏差导致的 20 轮连续报错死锁，改为宽松容错执行与明确 Feedback；
6. **废除任务私有可见性锁**：彻底去除导致 P0005 任务对元胞隐形、进而导致元胞连续空转 `skipped_idle` 的机制。

---

## 4. Migration 迁移实测结果

在 `workspace/live` 上执行 `python -m emergentinc.cli.migrate_v8` 验证：
- **安全快照**：成功生成 `workspace/loops/snapshot_pre_v8_migration/`；
- **任务体系**：旧 Problems（P0001~P0004）归档至 `market/archive/`，未完成的关键业务任务 P0005 成功转换为 `market/opportunities/M0005.md`（状态 OPEN，悬赏 100.0 Energy，需要真实外部客户自愿付费 >= 1 元）；
- **元胞升级**：元胞 `0_0_0`（Energy: 168.2）平滑升级为包含 `self.md`、`public.md`、`memory.md`、`inheritance.md`、`workspace/`、`inbox/` 的完整 V8 架构；
- **历史留存**：旧 `genome.json` 安全归档至 `legacy/genome_v7.json`，历史日志与轮次数据 100% 完整保留。

---

## 5. 自动化测试结果

运行 `python -m pytest tests/`：
```text
============================= test session starts =============================
collected 32 items

tests\test_delete_leaf.py .                                              [  3%]
tests\test_loop_branch.py .                                              [  6%]
tests\test_owner_stop.py .                                               [  9%]
tests\test_pixel_doc_allowlist.py .                                      [ 12%]
tests\test_pixel_work_visibility.py ...                                  [ 21%]
tests\test_refactor_invariants.py .......                                [ 43%]
tests\test_run_controller_stop.py .                                      [ 46%]
tests\test_snapshot_restore.py .                                         [ 50%]
tests\test_v8_api_sandbox_no_global_view.py .                            [ 53%]
tests\test_v8_attachment_snapshot.py .                                   [ 56%]
tests\test_v8_child_self_defined.py .                                    [ 59%]
tests\test_v8_loop_snapshot_workspace.py .                               [ 62%]
tests\test_v8_market_external_truth.py .                                 [ 65%]
tests\test_v8_market_not_auto_visible.py .                               [ 68%]
tests\test_v8_message_energy_transfer.py .                               [ 71%]
tests\test_v8_neighbor_message_only.py .                                 [ 75%]
tests\test_v8_no_genome_runtime.py .                                     [ 78%]
tests\test_v8_no_role_fields.py .                                        [ 81%]
tests\test_v8_owner_not_strategy.py .                                    [ 84%]
tests\test_v8_pixel_ownership.py .                                       [ 87%]
tests\test_v8_read_market.py .                                           [ 90%]
tests\test_v8_reproduction_energy_conservation.py .                      [ 93%]
tests\test_v8_workspace_jail.py .                                        [ 96%]
tests\test_world_api_no_secret.py .                                      [100%]

============================= 32 passed in 6.34s ==============================
```
- **核心验收**：文档 Section 59 规定的 15 项 V8 专属测试全部通过；
- **向后兼容**：既有 17 项系统级回归测试全部通过。

---

## 6. 核心机制验证详情

### 6.1 API Sandbox 检查
- 验证无论元胞输入何种 payload，ContextSandbox 均自动阻断 `world_state`、`owner_private` 等全局禁区；
- 邻居节点仅暴露公开属性与 `public.md`，私有的 `self.md`、`memory.md` 与工作区代码绝不泄露。

### 6.2 Workspace Jail 检查
- 验证跨目录 `../../`、绝对路径与危险命令逃逸均被 `JailViolation` 严密拦截；
- `RUN_WORKSPACE_COMMAND` 强制锁定在当前元胞的 `workspace/` 目录下执行，具备超时与输出字符截断保护。

### 6.3 Neighbor-only Message 检查
- 验证仅六邻域坐标允许发送消息；远距离（如 `0_0_0` 到 `5_5_5`）直接调用即时报错；
- 消息附件自动在接收方 `inbox/attachments/` 生成带唯一标识的快照副本，发送方后续修改不会影响历史快照。

### 6.4 Energy 守恒检查
- 消息能量转移：发送方扣减金额等于接收方获得金额；
- 繁衍能量转移：Parent 扣减 `energy_to_child + birth_cost`，Child 获得 `energy_to_child`，全系统能量净减少且仅减少被燃烧的 `birth_cost`。

---

## 7. UI 与运行说明

1. **启动 UI**：
   运行根目录 `EmergentInc_UI.bat` 或启动后端 FastAPI：
   ```powershell
   python -m emergentinc.ui.api
   ```
2. **新特性交互**：
   - **心流观察**：在元胞详情中，可直接查看 `self.md`、`public.md`、`memory.md`，以及上一轮执行的 `Intent`、`Action` 与 `Feedback`；
   - **市场看板**：UI `/api/world` 响应中直接输出 `market` 数组，展示当前处于 OPEN 状态的市场机会；
   - **求援挂起**：当元胞调用 `ASK_OWNER` 时，系统抛出 `OwnerActionRequired` 并挂起推进，控制台与 UI 高亮提示，等待主人提供外部支持。

---

## 8. 已知限制与后续演化建议

1. **OS 级强隔离边界**：第一版通过 Python 路径解析与 Jail 实现文件与命令目录限制；若在极端多租户生产环境，建议后续升级为 Docker / gVisor 容器级沙箱。
2. **自发分工观察**：目前已消除所有阻碍涌现的代码锁，后续建议通过 10-20 轮自动步进观察元胞 `0_0_0` 是否主动 `READ_MARKET` 发现 M0005，并在需要收款码时正确触发 `ASK_OWNER`。
