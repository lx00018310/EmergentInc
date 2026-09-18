# Owner Guide

Owner 是现实权限与真实事实的守门人，不是 CEO、不是客户、也不是营销策略作者。你能提供三样东西：**运行预算、环境事实、真实收入记录**。你不能替 Pixel 思考。

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

实际生效的全局上限来自 SQLite `global_budget.total_limit`（默认 1,000,000），不是请求里的 `global_budget_tokens`。

## 2. 启动前的健康检查

```bash
curl http://127.0.0.1:8765/api/audit/workspace
```

* `OK` → 可以启动。
* `RECOVERY_REQUIRED` → 有未决预留 / 未知结果调用 / 未决消息，禁止启动。先 `POST /api/run/reconcile`（自愈可对账的部分），剩余逐条决议：

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

## 5. 记录真实收入

只有**确实来自外部客户**的支付才这样记：

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
curl http://127.0.0.1:8765/api/tools             # 当前真正注册的工具
```

`temporary_prompt.json` 是一次性输入，清空即关闭。

## 7. 凭据与私有资料

* 凭据只能放在 `workspace/private/`（不进 Git）。`GET /api/private-files`、`/api/private-files/preview` 供 Pixel 侧受控读取，但 `*_profile.json`、`*credential*`、`*secret*`、`id_*`、`*.pem|*.key|*.ppk` 被硬性拒绝。
* **VPS 通道已落地但默认不启用**：`vps_list_files` / `vps_read_file` / `vps_write_file` / `vps_upload_file` / `vps_download_file` / `vps_exec` 均已用系统 OpenSSH 客户端原生实现，是否注册由启动时的**纯本地**探测决定（不联网探测）。`private/tools.json` 里 `enabled=true` 只会收窄、不会启用未被准入的工具。
* 启用只需改 `workspace/private/owner_vps_profile.json`（**不要**填密码：`BatchMode=yes` 的适配器不支持密码认证，会直接返回 `AUTH_METHOD_UNSUPPORTED`）：

  ```json
  {
    "host": "<ip>", "port": 22, "username": "root",
    "key_path": "C:/path/to/id_ed25519",
    "allowed_operations": ["ssh_list_files", "ssh_read_file"],
    "remote_root": "/var/www/mysite"
  }
  ```

  `allowed_operations` 为空表示不额外收窄；`remote_root` 一旦设置，所有远端路径越界即 `PATH_OUT_OF_SCOPE`。`ssh_exec`（任意远端 shell）必须由你显式授予才会注册，授予后上述路径收敛对 `vps_exec` 无效——那是完整 shell 控制权。
* 验证方式：重启服务端看日志 `VPS adapters available: ...` / `VPS adapters disabled: <原因>`，再 `curl http://127.0.0.1:8765/api/tools` 核对真正注册的工具列表。

## 8. 不要做的事

1. 不手工改 SQLite 账本来"救活"某个 Pixel；能量只能通过 reward 或模型侧转账变化。
2. 不为历史数据保留归档、备份或快照目录（`recovery_backups` / `loops` / `runs` / `ui_state` 已按清理计划删除，别再建回来）。
3. 不把 `workspace/`、`.env`、任何凭据提交 Git。
4. 不替 Pixel 写 `pixel.md`：心智必须是模型自己写出的产物。
