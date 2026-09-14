# Bootstrap Prompt for Coding Agent

请基于当前目录实现 My Company Life V2。

第一步不要直接跑 100 Round。

先完成最小 runner，使 Round 1 满足：

1. 读取 `config/world_config.json`
2. 加载 `0_0_0`
3. Environment 注入一个 Problem
4. 构造 0_0_0 的 Local View
5. 调用真实 LLM
6. 要求结构化输出符合 schema
7. RuleValidator 检查动作
8. 执行动作
9. 写 `round_0001.md`
10. 在 `llm_log.md` 记录模型调用

然后自动执行 `docs/self_check.md`。

只有 Self-Check PASS，才允许 Round 2。

禁止真实 LLM 失败后降级成 random / heuristic fallback。
失败应 FAIL FAST。
