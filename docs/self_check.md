# LLM Involvement Self-Check

实验启动前必须 PASS：

- [ ] 存在真实模型 client
- [ ] provider/model 已配置
- [ ] Round 日志包含 model
- [ ] 非 IDLE LLM-required action 有 prompt_hash
- [ ] 有 token usage 或 provider-no-usage 标记
- [ ] 无 random_action fallback
- [ ] 无 evidence_progress += 1
- [ ] 无 available_probs[0] 自动分配
- [ ] 无 first_idle_neighbor 自动选择
- [ ] decision order 非固定坐标排序
- [ ] Local View 中无全局 Pixel / Problem 数据

任一失败：

```text
EXPERIMENT_INVALID
```
