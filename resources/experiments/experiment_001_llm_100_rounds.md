# Experiment 001 — LLM-Native 100 Rounds

## Phase 1: Round 1–10

人工审计：
- 每个非 IDLE 行为是否有真实 LLM call
- Pixel 是否只看 Local View
- 是否存在假 Evidence

不通过立即停止。

## Phase 2: Round 11–30

观察是否真实发生：
- BID
- OFFER
- TRANSFER
- CREATE_PROBLEM

## Phase 3: Round 31–100

观察结构稳定性。

## Environment Schedule

Round 1–20：
- 低复杂 Problem
- Reward 8–20

Round 21–50：
- 混入需要拆解的 Problem
- Reward 15–40

Round 51–100：
- 高价值、竞争型 Problem
- Reward 25–80

Environment 每次只选择一个合法入口 Pixel。

## 成功判据

1. >95% 非 IDLE 行动有真实 LLM 审计。
2. 无全局 Problem 自动分配。
3. 至少一次真实竞价或明确拒绝。
4. 至少一次 LLM 自主创建子 Problem。
5. 至少一次 Resource 生存压力。
6. 存在非硬编码行为差异。

## 失败判据

- Evidence 仍由计数器推进
- Runner 用 if/else 决定主要动作
- 坐标顺序固定先手
- Pixel 看见全局世界
- 永久零成本 IDLE
- 所有 Problem 被同一节点自动领取
