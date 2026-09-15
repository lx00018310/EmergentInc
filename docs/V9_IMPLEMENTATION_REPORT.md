# EmergentInc V9 — 实施报告 (V9 Implementation Report)

## 1. 架构定位与核心公式
V9 定位为**商业元胞自动机 (Commercial Cellular Automaton)**。系统不再试图在底层硬编码一个“AI 公司”，而是仅设计最小生命与物理法则：

\[
\text{Local State} + \text{Local Message} + \text{Energy} + \text{Environment} + \text{Reproduction} + \text{Loop}
\]

让多个元胞通过局部状态演变、点对点通信、能量与预算约束和复制，自发产生交换、定价、专业化、合作乃至组织结构。

---

## 2. 删除了哪些 V8 机制
在 V9 中，彻底移除了以下所有中心化、预定义以及非物理层面的机制：

1. **废除角色与职位预设**：删除所有 `role`, `job`, `department`, `personality`, `manager` 等字段。元胞从无标签状态开始自我定义。
2. **废除任务与市场状态机**：删除 `problems/`、`market/`、`offers`、`bids`、`contracts`。所有需求统一收敛为外部 `environment.md`。
3. **废除宿主机自由工作区**：元胞核心目录仅保留 `state.json` 与 `pixel.md`；旧工作区归档至 `legacy_v8_workspace/`。真实交付物通过隔离的 `artifacts/` 工具统一安全存取。
4. **废除复杂多文档心智**：彻底废除 `self.md`, `memory.md`, `memory.json`, `inheritance.md`, `public.md`, `genome.json`，统一收缩为单一 `pixel.md`（<=2000字）。
5. **废除虚拟代谢费与虚拟操作费**：彻底取消每轮固定空转扣费、虚拟消息费、虚拟读取费；仅扣除真实模型调用和代码执行所消耗的等效 Token。

---

## 3. 最终核心文件数量与结构

### 3.1 单个 Pixel 文件树 (严格仅 2 个活跃文件)
```text
workspace/live/pixels/<pixel_id>/
├── state.json                     # 纯机器物理参数 (id, position, active, energy, neighbors)
├── pixel.md                       # 唯一心智历史 (<=2000 字符限制)
└── legacy_v8_workspace/           # 归档历史目录 (不参与 V9 运行时)
```

### 3.2 外部世界与实验基础设施
```text
workspace/live/
├── environment.md                 # 全局单一现实状态与约束文件 (默认对元胞隐形)
├── world_state.json               # 物理轮次与宏观统计状态
├── artifacts/<pixel_id>/          # 元胞隔离交付物空间
└── ...
workspace/ledger/
└── energy_ledger.jsonl            # 不可回滚真实费用与回款账本
```

---

## 4. 最终核心 Engine 模块清单 (`emergentinc/engine/`)

| 模块名称 | 核心职责 |
| :--- | :--- |
| `pixel.py` | Pixel 数据模型、`state.json` 物理字段校验、`pixel.md` 2000 字符硬限制拦截 |
| `world.py` | 3D 六邻域物理坐标拓扑计算、空间占用排他性校验、Genesis 创世元胞初始化 |
| `router.py` | 局部消息路由（`SELF` / 活跃直接邻居 / `STOP`）、Hop 计数 (<=20)、消息总量限额 (<=100) |
| `energy.py` | 1 亿等效 Token 初始预算、模型调用预留与实扣结算、邻居转账、复制划拨守恒、不可回滚账本 |
| `environment.py` | 全局 `environment.md` 管理、主动读取流转机制 (`environment_read`)、外部真实事实追加 |
| `llm.py` | 严格认知隔离单次决策客户端（输入严格仅为 `state`, `pixel_md`, `message_md` 三项），极简提示词与 Schema 校验 |
| `operations.py` | 通用工具通路（单次最多 3 个操作）、`artifacts/` 隔离交付物存取、带超时保护的代码隔离执行器 |
| `scheduler.py` | Round 调度主循环（自然唤醒 N=5、消息消费、预算预留、LLM step、实扣结算、心智拦截、操作回执、转账繁殖、零能量失活） |
| `persistence.py` | Loop 快照与安全回退（支持认知与空间回滚，但不可回滚账本与真实已消耗预算不重置） |
| `observer.py` | 宏观指标收集器（统计活跃数、能量分布、繁殖/死亡数、实际费用，严格隔离于元胞认知外） |
| `migration.py` | V8 到 V9 自动化状态与目录迁移引擎 |

---

## 5. 补充决策落地（Plan 第 64—74 节）
1. **一个余额，两种视图**：元胞内部持有整数单位 `energy`（等效 Token）；Engine 维护不可回滚账本，按照基准比率 $P$ 精确记录与折算实际法币/模型费用。
2. **预留与结算机制**：每次调用前预留估计 Token，调用后根据供应商实际用量（prompt/completion）结算并释放差额。余额不足以预留时停止付费行动。
3. **真实净回款回补**：通过外部唯一支付交易 ID 核验回补，换算新增等效 Token：`新增 Token = 净回款 / P * 1,000,000`。
4. **通用工具通路**：引入 `operations: []`，最多 3 个操作，提供交付物保存与读取以及安全执行沙箱，结果统一作为 `[ENGINE_FEEDBACK]` 注入下一跳。
5. **不可回滚保护**：快照回退支持认知状态回滚，但绝对不撤销已经真实消耗的预算，也不重复兑现已核验的回款。

---

## 6. 测试与 Smoke Test 验收
- 全部 **58** 项单元与集成测试 100% 通过（详见 [`V9_TEST_REPORT.md`](file:///D:/00_personalwork/EmergentInc元胞会社/docs/V9_TEST_REPORT.md)）。
- Plan 第 56 节 Kernel Smoke Test 验证成功：元胞成功主动读取环境事实（数字 42）、将其记入心智历史、并在相邻空位成功复制子代，能量严格守恒。

---

## 7. 已知限制与后续工作
1. **隔离执行器权限**：当前 `run_isolated_code` 运行于子进程受限环境，未来接入真实公网或第三方服务时，可进一步封装 Docker 或轻量沙箱容器。
2. **UI 视图适配**：现有 Web UI 需接入 V9 调度日志，实时展示六邻域拓扑与消息流动轨迹（当前已提供完整的底层数据采集与 Observer 接口）。
