# Security Boundary

模型的外部能力仅由已注册工具和 Owner 配置授予；工具调用经过运行时记录与校验。

## Pixel / 模型侧

1. 模型每次调用只拿到三类输入：自身 `pixel.md`、自身可见的邻居消息、`environment.md`。没有宿主 shell、没有全局世界状态、没有非邻居 Pixel 数据、没有聊天历史记忆。
2. 模型不能直接改世界。它的输出必须经 `DecisionCompiler` 编译成受校验的 `Effects[]`，未知动作与越界参数被拒绝并回喂 `[ENGINE_FEEDBACK]`。
3. 内置工具包括 artifact 读写/列举/转移、私有文件读取，以及只读的 `webfetch` 和 `github_repo`（`packages/tools/src/builtin/index.ts`）。`webfetch` 只接受公开 HTTP(S) 地址，不执行网页脚本；`github_repo` 通过固定的 GitHub API 读取公开仓库目录与文本文件。
4. 所有内置工具始终注册，`workspace/private/tools.json` 的 `enabled` 是唯一的工具授权配置；未配置的 VPS 工具默认禁用。运行时只检查注册表中的有效 `enabled` 值。VPS 执行时仍须具备密钥认证（`BatchMode=yes`）；文件类工具还检查 `remote_root` 路径范围。`vps_exec` 启用后可执行任意远端命令，不受 `remote_root` 约束。文件类工具的路径参数拒绝 Shell 控制字符，写入内容经 stdin 传输。
5. 写入被限制在自身目录，文件名白名单为 `pixel.md` / `tips.md`；`mandate.md` 只能由 Owner 经 API 写，模型侧只读，且严禁把 mandate 内容回写进 `pixel.md`。
6. 所有路径参数经 `containedPath()` / `validatePathSegment()` 校验，拒绝 `..`、`/`、`\`；私有工具另有 `PATH_TRAVERSAL_FORBIDDEN` 前缀检查。

## 秘密与凭据

7. 凭据只允许存在于 `workspace/private/`，该目录不进 Git（`.gitignore` 含 `workspace/`、`owner_*_profile.json`、`*.pem`、`*.key`、`id_rsa`、`id_ed25519` 等）。
8. 私有文件工具对凭据文件名硬拒绝：`*_profile.json`、`*credential*`、`*secret*`、`id_rsa|ed25519|dsa|ecdsa`、`*.pem|*.key|*.ppk`。Pixel 因此无法读到 VPS 连接资料内容，只能知道 Owner 提供了该渠道。
9. API 响应不返回私有目录内容以外的秘密；`/api/private-files/preview` 也走同一敏感名过滤。
10. 收款码等真实资产图片只描述、不转发：把原图或凭据写进 `pixel.md`、artifact 或消息都属于违规心智，需要人工纠正。
11. `.env`（模型 API Key）不进 Git，日志只打印掩码后的 key。

## 预算即安全护栏

12. Pixel 能量与本次 Run 预算在同一事务内检查，超限立即 `BudgetExceededError`；历史累计消耗仅用于审计。
13. 存在未决 `reservations` 或未结算调用时禁止启动新 Run；恢复必须走 `/api/run/recovery/resolve` 并留下 `recovery_decisions` 审计记录。
14. 外部真实收入只能通过 `/api/pixels/:id/reward` 由 Owner 提交，且必须带 `idempotency_key`，防止重复记账。

## 组织执行隔离

15. Mission/Trial 通过现有 RunService 执行，并以 `execution_id` 隔离消息、预留和模型调用。HTTP world Run 不接受参与者、工具快照或内部事务回调；execution 参与者与工具范围由服务端从已发布快照解析。
16. 任务 Prompt 只列出 execution 工具快照内且注册表当前启用的工具。ToolRuntime 再次检查同一授权；不临时修改全局 registry 或 `tools.json`。任务 handler 不能读取 `workspace/private`；artifact 读写使用 `workspace/evidence/<executionId>/artifacts/<pixelId>` 私有范围。
17. 任务不加载载体 `mandate.md` 或全局 `environment.md`。Mission/Trial 指令来自 SQLite execution 输入快照；任务环境响应也只能使用该快照中的 `environment` 字段。
18. 任务路由和能量/产物转移只允许同一 execution 的直接六邻居。Trial 禁止跨成员通信及任何转移；所有 execution 都禁止繁殖。handler 本身复核范围，不能依赖 Prompt 或 UI 拒绝越权动作。
19. 接收 binding 与消息快照不符时消息进入 `ABANDONED`，不会向新载体继续交付。execution 结束不代表任务完成；Owner 验收及关闭成员占用由业务服务单独完成。
20. scoped 模型预留受 Pixel/Run/Execution/Trial 额度同时约束，输出上限在最终请求上执行。真实 usage 即使超过预留也按原值结算；未知用量继续占用预留并进入恢复审查，不以零成本放行。
