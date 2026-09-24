# Owner Guide

Owner 提供商业目标、预算和现实权限，也可以明确委托 Codex 决定常规方案并推进。Pixel 的实际产物须保留来源，客户付款和反馈须按真实证据记录。首发采用的权益及操作步骤见 [协助体验说明](../launch/DELIVERY.md)。

所有操作走本机 HTTP API（默认 `http://127.0.0.1:8765`，前缀 `/api`），启动方式见根目录 `README.md` 或双击 `EmergentInc_UI.bat`。

## 1. 推进世界

```bash
# 跑 1 轮（默认 run 预算 1,000,000 token）
curl -X POST http://127.0.0.1:8765/api/run/start \
  -H "Content-Type: application/json" \
  -d '{"rounds":1,"run_budget_tokens":100000}'

curl http://127.0.0.1:8765/api/run/status     # 观察进度与 stop_reason
curl -X POST http://127.0.0.1:8765/api/run/stop   # 优雅停止：refund 后退出，不推进轮次
```

界面的 Run Tokens 输入值保存在当前浏览器本机；每次运行的实际额度写入 SQLite。累计消耗保留审计记录，不再作为预算上限。

## 2. 启动前的健康检查

```bash
curl http://127.0.0.1:8765/api/audit/workspace
```

* `OK` → 可以启动。
* `RECOVERY_REQUIRED` → 有未决预留 / 未知结果调用 / 未决消息，禁止启动。`POST /api/run/reconcile` 只列出需要审阅的项目，不会自动把未知调用当作未计费。核实服务商用量后逐条决议；以下只是已证实未计费时的请求形状：

```bash
curl -X POST http://127.0.0.1:8765/api/run/recovery/resolve \
  -H "Content-Type: application/json" \
  -d '{"kind":"model","id":"<call_id>","decision":"confirm_not_billed","reason":"未产生计费 token"}'
```

`kind` ∈ `model | tool | run | message`；`decision` ∈ `confirm_not_billed | settle_billed | settle_reserved | abandon | acknowledge`。每次决议都会写 `recovery_decisions` 审计行，不要用 `--no-verify` 式的绕过。

## 3. 提供现实事实（environment）

```bash
curl -X POST http://127.0.0.1:8765/api/environment \
  -H "Content-Type: application/json" -d '{"content":"过去24小时站点独立访客=0；VPS 未部署。"}'
```

写事实、写观测、写限制。**不要**写策略（"去 GitHub 发广告"），那会污染涌现判断。

## 4. 对单个 Pixel 下指令（mandate）

```bash
curl -X PUT http://127.0.0.1:8765/api/pixels/0_0_0/mandate \
  -H "Content-Type: application/json" -d '{"content":"先完成 X 再谈发布"}'
curl http://127.0.0.1:8765/api/pixels/0_0_0/mandate
curl -X DELETE http://127.0.0.1:8765/api/pixels/0_0_0/mandate
```

`mandate.md` 与 `pixel.md` 物理隔离：模型只读 mandate，主链禁止把它写进自己的心智。想改变长期心智只能通过 environment 与 mandate 反复提供事实。

## 5. 区分真实收入与 Energy 奖励

真实交易保存在忽略的 `workspace/private/first_revenue_orders.json`，核验到账、买家来源及交付/退款状态。下面的 `reward.amount` 只是内部 Energy，不能据此计算人民币收入；只有另行决定激励 Pixel 时才使用：

```bash
curl -X POST http://127.0.0.1:8765/api/pixels/0_0_0/reward \
  -H "Content-Type: application/json" \
  -d '{"amount":100,"idempotency_key":"wxpay-2026-09-18-001","source":"wechat","reason":"外部客户自愿购买"}'
```

* `amount` 必须是正整数，`idempotency_key` 必填（1–200 字符）用于防重复入账，重试同一个 key 不会重复加能量。
* 自己测试付款请如实写 `source`（例如 `owner-test`），不要伪装成外部客户 —— 这个世界的唯一成功标准就是「≥1 个真实外部用户自愿支付 ≥1 CNY」。
* 观察：`GET /api/pixels/:id/rewards`、`GET /api/pixels/:id/step-costs`、`GET /api/tool-executions`。

## 6. 提示词与工具

```bash
curl http://127.0.0.1:8765/api/genesis-prompt     # 创世提示词（GET/PUT）
curl http://127.0.0.1:8765/api/temporary-prompt   # 临时初速度（GET/PUT）
curl http://127.0.0.1:8765/api/tools             # 所有工具及有效 enabled 状态
```

这些提示词有保存接口，但当前运行主链不据此注入新任务。本次首发以已接入的 Human Mandate 为准。

控制区的“老板窗口”“创世提示词”“临时提示词”均以弹窗打开。老板窗口可询问项目进度等问题；每次提问会读取当时的世界状态、运行和账本摘要，并按问题选择最多 4 个代码、Pixel 文档或文本交付物阅读。回答显示读取时间与依据。`.env`、`workspace/private` 和原始数据库文件不会发给模型。对话记录保存在当前浏览器本机；模型调用单独记入 `owner_chat_calls`，不消耗 Pixel 能量或 Run Tokens。使用老板窗口需要配置真实模型。

## 7. 凭据与私有资料

凭据保存在 `workspace/private/`，不提交 Git。Pixel 通过 `read_private_file` 工具访问受控资料，敏感 profile 只返回脱敏投影，私钥拒绝返回原文；不要依赖文件扩展名代替权限检查。管理 API 的 private-files preview 只预览图片，不等同于 Pixel 文本工具。

工具授权只在 `workspace/private/tools.json` 的 `enabled` 配置中决定；VPS 工具默认禁用。启用只代表允许调用，不证明 SSH 已连接。以实际工具回执区分认证失败、目录不存在和 `PATH_OUT_OF_SCOPE`；站点初始化由管理员工具完成，不能写成 Pixel 自主部署。

## 8. 不要做的事

1. 不手工改 SQLite 账本来"救活"某个 Pixel；能量只能通过 reward 或模型侧转账变化。
2. 不为历史数据保留归档、备份或快照目录（`recovery_backups` / `loops` / `runs` / `ui_state` 已按清理计划删除，别再建回来）。
3. 不把 `workspace/`、`.env`、任何凭据提交 Git。
4. 不替 Pixel 写 `pixel.md`：心智必须是模型自己写出的产物。
