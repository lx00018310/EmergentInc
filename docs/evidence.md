# Evidence

核心：

```text
No Evidence → No Completion
```

## 引擎定义的证据来源

Pixel 不能自己指定这些等级。

- `MODEL_ARTIFACT`：LLM WORK 产生的分析/方案/代码文本。
- `TOOL_VERIFIED`：真实工具、测试、API 的机器结果。
- `ENVIRONMENT_VERIFIED`：Environment 注入的真实外部事件。
- `INDEPENDENT_PIXEL_VERIFIED`：独立 Pixel 审核结果。
- `HUMAN_VERIFIED`：人工确认。

## 关闭规则

每个 Problem 有：

```text
evidence_policy.allowed_sources
evidence_policy.min_items
```

只有来源满足政策，才进入语义 Validator。

例如商业方案类 Sandbox Problem 可允许 `MODEL_ARTIFACT`。

“客户已付款”类 Problem 必须要求 `ENVIRONMENT_VERIFIED` 或 `TOOL_VERIFIED`。
