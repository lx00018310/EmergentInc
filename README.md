# EmergentInc V3 — LLM-Native Business Cellular Automaton

V3 是 My Company Life / EmergentInc 的第一个“可连续演化”基线。

核心世界：

```text
Pixel 固定
Problem 流动
Resource 反向流动
一个 Pixel 同时最多持有一个 Problem
Spawn = 父代 + 单次微变异
局部交互
真实 LLM 决策
离散 Round
```

## V3 解决 V2_TEST_001 的问题

- 不再写死 `0_0_0`
- 不再写死 `P0001`
- 不再只运行 Round 1
- 动态扫描所有 active Pixel
- Problem 可见性由拓扑服务计算，Runner 不能手工塞全局 Problem
- 支持 SPAWN / OFFER / BID / ACCEPT_BID / TRANSFER / CREATE_PROBLEM
- JSON 是机器真值；Markdown 仅为可读镜像
- Evidence 来源由引擎标记，Pixel 不能自封 `REAL_WORLD`
- `REQUEST_CLOSE` 必须经过 Evidence Gate + 独立语义 Validator
- 每轮决策顺序使用 seeded shuffle
- 所有 Pixel 都支付 maintenance
- 模型失败 Fail Fast，不允许 random/heuristic fallback
- 非事件 Pixel 不调用 LLM
- 运行时 Self-Check 检查局部性与模型审计，不只扫字符串

## 快速开始

```bash
pip install -r requirements.txt

# OpenAI-compatible provider
set MCL_API_KEY=YOUR_KEY
# Linux/macOS:
# export MCL_API_KEY=YOUR_KEY

python -m scripts.self_check
python -m scripts.runner --rounds 1
python -m scripts.runner --rounds 9
```

建议实验节奏：

```text
1 Round
→ 审计
→ 10 Round
→ 审计
→ 30 Round
→ 审计
→ 100 Round
```

不要一开始直接跑 1000 Round。
