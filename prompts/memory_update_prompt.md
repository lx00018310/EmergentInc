# Memory Update Prompt

根据旧 memory、本轮关键事件、结果、Resource 变化和 Evidence 结果，输出：

```json
{
  "memory_add": [],
  "memory_remove": [],
  "genome_change_proposal": null
}
```

原则：
- 不把一次成功当永久定律。
- 优先保留可重复局部经验。
- genome_change_proposal 每次最多一项。
