# Security Boundary

边界目标只有一个：让模型拥有决策权，但不拥有现实操作权与秘密读取权。

## Pixel / 模型侧

1. 模型每次调用只拿到三类输入：自身 `pixel.md`、自身可见的邻居消息、`environment.md`。没有宿主 shell、没有全局世界状态、没有非邻居 Pixel 数据、没有聊天历史记忆。
2. 模型不能直接改世界。它的输出必须经 `DecisionCompiler` 编译成受校验的 `Effects[]`，未知动作与越界参数被拒绝并回喂 `[ENGINE_FEEDBACK]`。
3. 内置工具默认只有 artifact 读写/列举/转移与私有文件读取（`packages/tools/src/builtin/index.ts`）。唯一的进程/网络出口是 `vps_*` 适配器，且必须显式准入才注册。
4. `vps_*` 已原生实现（`vps_list_files` / `vps_read_file` / `vps_write_file` / `vps_upload_file` / `vps_download_file` / `vps_exec`，走系统 OpenSSH 客户端），注册由启动时的**纯本地**探测 `probeVpsAvailability(workspaceRoot)` 决定，探测不发起任何网络连接。`private/tools.json` 的 `enabled=true` 只能收窄、不能启用未被准入的工具。执行期还有三道独立门：`owner_vps_profile.json` 的 `allowed_operations` 白名单、`remote_root` 路径收敛、以及只支持**密钥认证**（`BatchMode=yes`，密码认证直接返回 `AUTH_METHOD_UNSUPPORTED`）。远端命令只经 argv 传递，路径参数拒绝 Shell 控制字符，写入/上传内容走 stdin，绝不拼进命令行；`vps_exec` 需要 Owner 在 `allowed_operations` 中显式授予 `ssh_exec`。
5. 写入被限制在自身目录，文件名白名单为 `pixel.md` / `tips.md`；`mandate.md` 只能由 Owner 经 API 写，模型侧只读，且严禁把 mandate 内容回写进 `pixel.md`。
6. 所有路径参数经 `containedPath()` / `validatePathSegment()` 校验，拒绝 `..`、`/`、`\`；私有工具另有 `PATH_TRAVERSAL_FORBIDDEN` 前缀检查。

## 秘密与凭据

7. 凭据只允许存在于 `workspace/private/`，该目录不进 Git（`.gitignore` 含 `workspace/`、`owner_*_profile.json`、`*.pem`、`*.key`、`id_rsa`、`id_ed25519` 等）。
8. 私有文件工具对凭据文件名硬拒绝：`*_profile.json`、`*credential*`、`*secret*`、`id_rsa|ed25519|dsa|ecdsa`、`*.pem|*.key|*.ppk`。Pixel 因此无法读到 VPS 连接资料内容，只能知道 Owner 提供了该渠道。
9. API 响应不返回私有目录内容以外的秘密；`/api/private-files/preview` 也走同一敏感名过滤。
10. 收款码等真实资产图片只描述、不转发：把原图或凭据写进 `pixel.md`、artifact 或消息都属于违规心智，需要人工纠正。
11. `.env`（模型 API Key）不进 Git，日志只打印掩码后的 key。

## 预算即安全护栏

12. 三级硬预算（PIXEL / RUN / GLOBAL）在同一事务内检查，超限立即 `BudgetExceededError` 并停调度，不允许"先花后补"。
13. 存在未决 `reservations` 或未结算调用时禁止启动新 Run；恢复必须走 `/api/run/recovery/resolve` 并留下 `recovery_decisions` 审计记录。
14. 外部真实收入只能通过 `/api/pixels/:id/reward` 由 Owner 提交，且必须带 `idempotency_key`，防止重复记账。
