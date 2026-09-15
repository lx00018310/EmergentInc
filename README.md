# EmergentInc V5 — API Sandbox

V5 的核心变化不是增加更多 Agent，而是把每一次 AI 推理真正关进认知沙盒。

正式实验结构：

```text
World Engine
   ↓ allow-list context
Context Sandbox
   ↓ single stateless API call
LLM API
```

模型在每次调用中都没有：仓库、文件系统、shell、browser、全局 world_state、非邻居 Pixel、未来计划或历史聊天。

## 覆盖升级

这是 V5 overlay。直接解压到当前 V4/V3 项目根目录并允许覆盖。

本包不包含也不覆盖：

```text
world_state.json
pixels/
problems/
rounds/
```

升级后：

```bash
pip install -r requirements.txt
python -m scripts.migrate_v4_to_v5
python -m scripts.self_check
```

## 正式实验只允许 API Sandbox

禁止用以下方式驱动 Pixel：

```text
agent_direct
agent_queue
Codex直接替Pixel决策
ZCode直接替Pixel决策
Gemini Coding Agent直接替Pixel决策
```

Codex / ZCode / Claude Code / Gemini Coding Agent 仍可以用于开发、部署、审计、修 Bug 和 Owner 运维，但不能产生 PixelAction / EvidenceVerdict / MemoryDelta。

## API 配置

可在项目根目录 `.env` 文件中配置（推荐，可参考 `.env.example`）：

```bash
MCL_API_KEY=YOUR_KEY
MCL_BASE_URL=YOUR_OPENAI_COMPATIBLE_ENDPOINT
MCL_MODEL=YOUR_MODEL
```

可分别指定各任务模型：

```bash
MCL_DECISION_MODEL=...
MCL_VALIDATOR_MODEL=...
MCL_MEMORY_MODEL=...
```

也支持通过系统环境变量导出：

```bash
set MCL_API_KEY=YOUR_KEY
set MCL_BASE_URL=YOUR_OPENAI_COMPATIBLE_ENDPOINT
set MCL_MODEL=YOUR_MODEL
```

运行：

```bash
python -m scripts.runner --rounds 10
```

每个调用都是新的无状态请求，只包含：system prompt + 一个沙盒 JSON。

## Owner 边界

Owner 只负责现实权限和客观事实，不负责商业策略。

Owner 可以批准 VPS / 域名 / 邮箱 / API / 支付观察能力，也可以记录客观访问量和真实外部交易。

如果 Problem 要求真实外部客户，则 Owner 自己付款、测试转账、模型自述都不能完成验收。

## WAIT_EXTERNAL

V5 的 WAIT_EXTERNAL 必须指定 `max_sleep_rounds`。即使没有事件，Pixel 也会定期醒来重新评估，避免部署页面后永久消极等待。
