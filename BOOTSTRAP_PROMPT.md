# 给本地 Coding AI 的执行提示词

目标：以本目录为 V3 基线运行，而不是重新设计项目。

执行顺序：

1. 阅读 README.md 与 MASTER_PROMPT.md。
2. 阅读 docs/ 下所有规则。
3. 运行 `python -m scripts.self_check`。
4. 配置真实 LLM API。
5. 运行 1 Round。
6. 检查：
   - rounds/round_0001.md
   - pixels/*/llm_log.md
   - world_state.json
   - problems/*.json
7. Self-check 与 Round 1 审计都通过后，再运行到 Round 10。
8. 不允许添加 random_action、heuristic fallback、evidence_progress。
9. 如果模型不可用，实验失败，不得伪装继续。
10. 如果发现规则缺陷，先记录到 reports/，不要为了“跑通”偷偷改变世界公理。
