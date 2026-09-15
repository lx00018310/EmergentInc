# EmergentInc V9 — 测试报告 (V9 Test Report)

## 1. 测试套件概况
系统建立了针对 V9 底层生命物理法则的完整自动化验证测试套件。当前全部 58 项自动化测试 100% 通过。

- **总用例数**：58
- **通过数**：58
- **失败数**：0
- **运行时间**：~12s

## 2. V9 核心物理规则测试清单

| 测试文件 | 验证要点 | 结果 |
| :--- | :--- | :--- |
| `tests/test_pixel_md_max_2000.py` | `pixel.md` <= 2000 字符限制，超长拒绝更新并保留原内容 | **PASSED** |
| `tests/test_message_md_max_2000.py` | `message.md` <= 2000 字符限制，超长路由器生成反馈拦截 | **PASSED** |
| `tests/test_llm_context_only_three_inputs.py` | 严格 Cognitive Isolation：单次调用 Payload 严格仅有 `state`, `pixel_md`, `message_md` 三项，系统提示词无角色预设 | **PASSED** |
| `tests/test_self_route.py` | `SELF` 路由生成自身下一跳消息，Hop 正常递增 | **PASSED** |
| `tests/test_neighbor_route.py` | 3D 六邻域活跃直接邻居消息投递成功 | **PASSED** |
| `tests/test_non_neighbor_route_rejected.py` | 远距离非邻居或死亡邻居直接投递被拒并生成 `[ENGINE_FEEDBACK]` | **PASSED** |
| `tests/test_environment_not_auto_visible.py` | `environment.md` 默认对元胞完全隐形，不主动读绝不可见 | **PASSED** |
| `tests/test_environment_active_read.py` | 元胞主动输出 `environment_read: true` 后，下一跳收到环境全量事实文本 | **PASSED** |
| `tests/test_energy_call_cost.py` | 模型调用预留预算（Reserve）与实际消耗结算（Settle），释放差额 | **PASSED** |
| `tests/test_energy_transfer.py` | 邻居间能量显式转移，系统总能量守恒，超额与负数转账被拒 | **PASSED** |
| `tests/test_reproduction_neighbor_only.py` | 复制仅限直接六邻域未占用空位，远距离或已占用空位复制被拒 | **PASSED** |
| `tests/test_reproduction_energy_conservation.py` | 复制能量守恒，母体划拨扣除，子代继承，不凭空增发系统预算 | **PASSED** |
| `tests/test_child_can_rewrite_pixel_md.py` | 子代元胞拥有重写自身心智的完整自主权，不受母体预设绑定 | **PASSED** |
| `tests/test_max_hops.py` | 达到单轮最大跳数限制（20）时强制结束 Round，向元胞排入反馈 | **PASSED** |
| `tests/test_max_messages_per_round.py` | 超过单轮消息额度（100）的消息延期至下一轮主队列 | **PASSED** |
| `tests/test_death_at_zero_energy.py` | 能量 <= 0 时元胞失活（`active = False`），保留文件与物理占位 | **PASSED** |
| `tests/test_loop_snapshot_v9.py` | Loop 快照恢复心智与认知空间，但已消耗能量与账本不可回滚 | **PASSED** |
| `tests/test_operations_artifacts.py` | 隔离交付物存储、读取、列表及带超时保护的代码隔离执行器 | **PASSED** |
| `tests/test_immutable_ledger.py` | 不可回滚真实账本追加记录、外部真实净回款按基准 P 换算入账 | **PASSED** |

## 3. Plan 第 56 节 Kernel Smoke Test 验证
测试文件：`tests/test_smoke_v9.py`

### 实验设计
- **初始环境**：`# Environment\n\n存在一个数字：42。`
- **创世元胞**：`0_0_0`，初始能量 `100,000,000`。
- **验证流程**：
  1. 第 1 步：元胞做出思考，主动要求读取环境 (`environment_read: true`)；
  2. 第 2 步：元胞接收到外部环境消息，获知真实数字 `42`，将其写入自身 `pixel.md`，并在直接邻近空位 `[1, 0, 0]` 繁殖子代元胞，等额划拨 `20,000,000` 能量；
  3. 第 3 步：子代元胞醒来，继承并验证心智中的数字 `42`，向自身写入确认信息并 `STOP`。

### 运行结果
- `0_0_0` 成功写入事实：`Discovered external truth 42`；
- `1_0_0` 在网格上成功创建并激活，继承初始能量，并在发生醒来决策调用后真实扣除其实际调用的 Token；
- 系统总能量严格守恒（扣除两次实际调用的几百 Token 后，总额完全闭环在 `100,000,000` 预设框架内）；
- 测试结果：**100% PASSED**。
