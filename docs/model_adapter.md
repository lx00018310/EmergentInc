# Model Adapter

统一接口：

```python
decide(local_view, genome, memory) -> PixelAction
validate_evidence(problem, evidence) -> Verdict
update_memory(event) -> MemoryDelta
```

环境变量与 `.env` 配置项：

可直接在根目录 `.env` 文件（或系统环境变量）中提供：

```text
MCL_API_KEY          # OpenAI 兼容 API Key
MCL_BASE_URL         # OpenAI 兼容 Base URL
MCL_MODEL            # 默认模型名称
MCL_DECISION_MODEL   # 决策场景专用模型（可选）
MCL_VALIDATOR_MODEL  # 验证场景专用模型（可选）
MCL_MEMORY_MODEL     # 记忆场景专用模型（可选）
```

配置文件 `config/world_config.json` 的 `model.env_file` 指定加载的 `.env` 文件路径（默认为 `.env`）。

模型失败：

```text
CALL_FAILED
```

禁止：

```python
except:
    return random_action()
```
