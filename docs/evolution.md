# Evolution v0.2

Spawn:

```text
Child Genome = Parent Genome + exactly one mutation
```

一次 mutation 只允许改变一项：
- 某个 tendency 的小幅变化
- 修改一条策略语句
- 增加/删除一条 learned principle

Mutation proposal 可由 Parent LLM 提议。
引擎只验证范围与单变异约束。

后代继承 genome 和极短 inherited note。
不继承完整 memory/history/current Problem。
