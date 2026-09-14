# EmergentInc V4 — Open World Overlay

V4 在 V3 的闭合数字世界上增加受控的现实世界通道：

```text
Digital Intelligence
        ↕
Owner / Capability Gateway
        ↕
Real World
```

## 这是覆盖升级包

把 ZIP 解压到现有 V3 仓库根目录并允许覆盖。

本包**不会包含/覆盖**：

```text
world_state.json
pixels/
problems/
rounds/
```

所以 Round 50、P0005、两个 Pixel、Resource、Memory、历史日志都会保留。

覆盖后：

```bash
pip install -r requirements.txt
python -m scripts.migrate_v3_to_v4
python -m scripts.self_check
```

---

## V4 新能力

Pixel 新增三个动作：

```text
REQUEST_CAPABILITY
USE_CAPABILITY
WAIT_EXTERNAL
```

### REQUEST_CAPABILITY

Pixel 如果发现要继续解决 Problem 必须接触真实世界，就可以向 Owner 请求能力，例如：

```text
ssh_vps
public_web_hosting
domain
email
browser
payment_observation
human_action
```

Owner 不是 CEO，不负责告诉 Pixel 应该怎么赚钱，只负责现实权限。

### USE_CAPABILITY

Owner 批准后，Pixel 看到：

```text
CAP0001
type = ssh_vps
allowed_operations = [ssh_exec]
```

Pixel 看不到 SSH 私钥/API Key。

Gateway 代替 Pixel 执行实际操作，并把结果作为 TOOL_VERIFIED Evidence 返回世界。

### WAIT_EXTERNAL

如果下一步只能等客户付款、Owner 批准、网站事件等外部变化，Pixel 可进入 WAIT_EXTERNAL。

WAIT_EXTERNAL 时不会每轮重复调用 LLM。

---

# 两种 LLM 运行方式

## 1. API 模式

适合 OpenAI-compatible API：

```bash
set MCL_RUNTIME_MODE=api
set MCL_API_KEY=YOUR_KEY
set MCL_BASE_URL=https://your-endpoint/v1
set MCL_MODEL=your-model

python -m scripts.runner --rounds 10
```

可用于 Gemini compatible gateway、OpenRouter、火山方舟等兼容接口。

## 2. Agent Queue 模式

适合：

```text
Codex
ZCode
Claude Code
Gemini Coding Agent
其他可以读写文件并执行命令的 Agent
```

Windows：

```bash
set MCL_RUNTIME_MODE=agent_queue
```

把：

```text
AGENT_RUNNER_PROMPT.md
```

交给 Agent。

Runner 会生成：

```text
runtime/agent_requests/*.json
```

Agent 只读取该 request 的隔离上下文，写：

```text
runtime/agent_responses/<same_request_id>.json
```

然后再次运行 runner。V4 使用 Round checkpoint，不会重复扣费/执行动作。

---

# 真实钱和 Resource 分离

```text
Resource = 人工世界内部能量
CNY/USD = 真实现金流
```

真实收入/支出写入：

```text
external_transactions/
```

例如：

```text
Revenue ¥1
VPS Cost ¥20
Real P&L = -¥19
```
