# Architecture

```text
EnvironmentScheduler
        ↓
ProblemRegistry
        ↓
VisibilityService ─→ LocalViewBuilder
                         ↓
                    Pixel LLM
                         ↓
                    PixelAction
                         ↓
                    RuleValidator
                         ↓
                    ActionExecutor
                         ↓
     ┌──────────────┬───────────────┐
     ↓              ↓               ↓
 ResourceLedger  SpawnService   EvidenceService
     ↓                              ↓
   State                          Close
     └──────────────┬───────────────┘
                    ↓
                 Storage
```

### 边界

- `PixelDecisionService`：想做什么。
- `RuleValidator`：能不能做。
- `ActionExecutor`：把合法动作写进世界。
- `EvidenceService`：能不能闭合。
- `ResourceLedger`：资源守恒与结算。
- `Storage`：机器真值。
