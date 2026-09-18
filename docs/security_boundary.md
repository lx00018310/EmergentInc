# Security Boundary

边界目标只有一个：让模型拥有决策权，但不拥有现实操作权与秘密读取权。

## Pixel / 模型侧

1. 模型每次调用只拿到三类输入：自身 `pixel.md`、自身可见的邻居消息、`environment.md`。没有宿主 shell、没有全局世界状态、没有非邻居 Pixel 数据、没有聊天历史记忆。
2. 模型不能直接改世界。它的输出必须经 `DecisionCompiler` 编译成受校验的 `Effects[]`，未知动作与越界参数被拒绝并回喂 `[ENGINE_FEEDBACK]`。
3. 工具调用没有网络与进程能力：当前注册的内置工具只有 artifact 读写/列举/转移与私有文件读取（`packages/tools/src/builtin/index.ts`）。
4. `vps_*` 工具**不注册**。注册函数显式跳过所有 `vps_` 前缀定义：配置无法启用没有原生实现的工具。因此 `private/tools.json` 中 `vps_*` 的 `enabled=true` 不产生任何能力。
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
