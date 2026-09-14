# Implementation Contract

建议实现组件：

```text
LLMClient
PixelDecisionService
LocalViewBuilder
RuleValidator
EvidenceValidator
ResourceLedger
SpawnService
DeathService
RoundRunner
AuditLogger
```

边界：

```text
PixelDecisionService → 想做什么
RuleValidator → 允许不允许
EvidenceValidator → 满足没满足
ResourceLedger → 账
RoundRunner → 编排
```

任何组件不得跨界替 Pixel 做商业判断。
