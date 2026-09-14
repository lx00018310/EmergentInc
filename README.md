# My Company Life V2 — LLM-Native Baseline

这是一个“商业版三维元胞自动机”实验基线。

核心目标不是模拟一个已有公司，而是验证：

> 在固定空间、局部交互、单 Problem 容量、Resource 约束、微变异繁殖与真实 LLM 决策下，
> 是否会自然出现专业化、竞争、合作、中间层、管理、组织结构与商业策略。

## V2 与 v0.1 的关键差异

v0.1 实际是：

```text
Cellular Automaton
+ Economic Rules
+ if/else/random Strategy
```

V2 必须变成：

```text
Cellular Automaton
+ Economic Rules
+ Real LLM Decision
+ Evidence Validation
+ Evolution
```

### V2 明确禁止

以下逻辑不得继续替 Pixel 做思考：

```python
if spawn_preference > ...
if random() < ...
available_probs[0]
first_idle_neighbor
evidence_progress += 1
```

规则引擎可以判断“是否合法”，但不能判断“应该做什么”。

## 启动顺序

1. `MASTER_PROMPT.md`
2. `docs/world_rules.md`
3. `docs/pixel.md`
4. `docs/problem.md`
5. `docs/resource.md`
6. `docs/space.md`
7. `docs/actions.md`
8. `docs/loop.md`
9. `docs/evidence.md`
10. `docs/evolution.md`
11. `docs/anti_bias.md`
12. `docs/implementation_contract.md`
13. `docs/model_adapter.md`
14. `docs/self_check.md`
15. `prompts/pixel_decision_prompt.md`
16. `schemas/pixel_action.schema.json`
17. `config/world_config.json`

首次实验按 `experiments/experiment_001_llm_100_rounds.md` 执行。

## 首次实验建议

不要直接跑 1000 Round。

```text
10 Round
→ 人工审计
→ 30 Round
→ 人工审计
→ 100 Round
```

先确认：
- LLM 真的参与
- 每次 LLM 输入只有 Local View
- Evidence 不是伪造
- Problem 没有全局广播
- 决策顺序没有坐标偏置
- Resource 会真正产生生存压力
