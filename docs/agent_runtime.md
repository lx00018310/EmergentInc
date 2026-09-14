# API + Agent 双运行时

## API Runtime

```text
MCL_RUNTIME_MODE=api
```

Runner 直接调用 OpenAI-compatible API。

## Agent Queue Runtime

```text
MCL_RUNTIME_MODE=agent_queue
```

Runner 把每一次独立推理请求写成文件，由 Codex/ZCode/Claude Code/Gemini Agent 等响应。

所有请求有独立隔离上下文。

Round 使用 checkpoint，可跨多次 Agent 调用恢复。
