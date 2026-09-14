# Model Adapter

统一接口：

```python
decide(local_view, genome, memory) -> PixelAction
validate_evidence(problem, evidence) -> Verdict
update_memory(event) -> MemoryDelta
```

环境变量建议：

```text
MCL_MODEL_PROVIDER
MCL_MODEL_NAME
MCL_API_KEY
MCL_BASE_URL
```

模型失败：

```text
CALL_FAILED
```

禁止：

```python
except:
    return random_action()
```
