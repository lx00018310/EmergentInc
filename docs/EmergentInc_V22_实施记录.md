# V22 本地四阶段实施记录

日期：2026-09-30。基线：`21e2635`（V22 BASE），业务代码基线：`f69c1c0`（V21 rebuild）。

Owner 确认的本次范围：本地四阶段实现与自动测试。未部署 Linux、迁移正式 workspace、调用真实付费模型或执行对外业务动作。本地通过不等于原计划最终“活过一代”验收。

## 实现与证据

| 阶段 | 已实现 | 本地验证 |
| --- | --- | --- |
| 1 生命数据 | 原 BusinessStore + Lineage Schema V2；每代独立 Current；G0001；LifeContext；白名单部分迁移 | 真实 SQLite：原表不重建、原表计数保留、online backup SHA/integrity、源库保留、两库隔离、记忆限20条、指针与基因冲突拒绝 |
| 2 身体生长 | Need → 候选 → 可信数据测试 → 自动激活；多槽；运行失败回退并写 Lineage Memory | 沙箱替身：无 Owner 逐次审批、代号不变、Body Revision 增加、槽互不覆盖、越界/接口/镜像/产物冲突拒绝 |
| 3 Memory/Dream | 即时 Gate；每日/手动/Final Dream；增量游标；严格三项式记忆与 Gene Proposal；原费用账本 | 无新事实0模型调用、批次与时区调度、提案仅 PROPOSED、未知结果禁止重发、账单核实后恢复保存响应 |
| 4 出生与回退 | 独立 Supervisor、准确 Hash 审批、候选复制双库、暂停排空、切版、恢复日志、冻结 Current、回退后 Dream | 真实 SQLite + 发布/进程替身：G1→G2成功；G3失败→G2恢复；出生前/正式启动失败；出生后回退；中断恢复；费用/订单/付款/记忆保留 |

另有实际编译后的候选服务器进程烟测：双库打开、live/ready、Owner auth、Business overview、Body registry、Evolution schema、业务写入禁止。候选模式不读 `.env`，不创建真实模型/连接器，不启动业务 worker。

新增 Supervisor 工作区只引用现有 persistence/protocol 内部包，没有新增第三方依赖。V21 Owner automation 审批路径保留；自主 Body 使用独立路径。

Body Need 接口接受可选 `candidate`（skill_id/purpose/source/interface_version/tests）。模型编写与外部提供的源码均走同一数据测试、沙箱和自动激活管线，不安装外部依赖或执行安装脚本。

## Windows 验证与离线迁移

```powershell
npm.cmd run typecheck
npm.cmd test -- --reporter=dot --maxWorkers=4
npm.cmd --prefix frontend run build
```

本次最终结果（含 Review 修复）：类型检查通过；65 个测试文件、457 个测试全部通过；前端构建通过；`git diff --check` 通过。测试中的模型、外部动作和发布切换使用替身；候选服务器烟测使用真实编译后的本地进程。

曾在全量测试与前端构建同时运行时出现4个5秒超时，包含原有测试。单独运行并限制4个worker后全部通过；未放宽测试超时或修改原有测试。可信候选构建也限制4个测试worker。前端仍有大chunk提示，未扩大本次改动处理。

已有 V21 数据需先停止服务，下例使用隔离离线副本：

```powershell
node scripts/business-maintenance.mjs inspect 'D:\isolated-v21\ledger\business.sqlite3'
node scripts/life-migrate.mjs 'D:\isolated-v21' 'D:\00_personalwork\EmergentInc元胞会社' v22-initial
```

检查 `lineage/migration-report.json`、`active-generation.json` 和 `generations/G0001/current.sqlite3`。迁移工具不覆盖已有目标；原 `ledger/business.sqlite3` 保留到最终验收。失败半成品须检查原因，不会自动删除重试。

Genome Hash 绑定受保护源码，源码变化时已有代不会静默更新基因。本地开发使用独立实验 workspace，正式升级走准确候选流程。

## Review 修复（基于 1303a4a，未暂存、提交或推送）

1. 代际指针只含代号，原子替换前明确设置0644，不受 Supervisor 的0077 umask影响；生产目录和文件所有权仍由 root 控制。Windows 测试验证权限调用，POSIX 下另验证实际模式；真实 Linux 用户权限仍待实机核验。
2. 先记录出生与停止服务的意图，再执行对应操作。切版前的迁移中断直接放弃候选并恢复旧服务运行，不要求新 Current 存在，也不停止旧服务；恢复响应丢失时保留日志供重试。切版后的冻结与回退流程保留。
3. Owner 可恢复旧代已核实费用且保存了响应的 Dream；直接消费原响应，不调用模型。记忆归原代，提案归当前代；各代 Current 游标独立，共享事实游标只前进。
4. Body 激活后只解除准确关联的方案资源等待；批准前激活、批准后激活及跨代继承均覆盖。仅迁移标记 carry_forward 且关联已激活候选的已满足 Need；接口不兼容时重新形成 Need 并保留验证限制。无关 Need、失败测试不能解除等待。

增加12个回归用例，未调整原测试超时、业务能力契约或 Owner 授权规则。本轮没有执行 Git 暂存、提交或推送。

## 可信 CLI 与 Linux 安装模板

`scripts/generation-supervisor.mjs` 只允许 Linux root，只调用 `/opt/emergentinc-supervisor/dist/cli.js`，没有仓库源码兜底。Owner HTTP API 只批准提案方向，不提供 Birth、准确候选批准或 Release 切换。

CLI 动作：`submit <request.json>` → `validate <id>` → `show <id>` → `approve <id> <exact-hash>` → `birth <id>`。另有 `rollback <id> <reason>`、`recover` 和 `post-rollback-dream <failed-id>`。

请求最小格式：

```json
{
  "id": "release-g2",
  "base_generation": "G0001",
  "base_release": "v22-initial",
  "proposal_id": "OWNER_APPROVED_PROPOSAL_ID",
  "patch": [{ "path": "genome/manifest.json", "content": "准确的新 manifest 文本" }]
}
```

`patch` 为源码相对路径与 UTF-8 完整文本列表；删除用 `content:null`。禁止宿主路径、凭据、编译产物、Root 模板修改。新 manifest 的 generation 对应下一代编号。准确 Hash 绑定 base、Proposal、Patch、Gene 和完整 Release，批准后内容变化将阻止出生。

后续安装要求（本次未执行）：

1. 将 Supervisor `dist`、`candidate_harness.mjs`、可信 launcher、固定版本 persistence/protocol 编译包及内部模块链接复制为独立安装树；依赖不得链接到可变 Release。root 所有，验证用户只读，`emergentinc` 无读写权限。更新仓库模板不会自动更新已安装可信根。
2. releases、current 父目录和生产指针由 root 控制。配置 `EMERGENTINC_ACTIVE_GENERATION_FILE=/srv/emergentinc/active-generation.json`，指针位于应用可写 workspace 外、应用只读。Linux 迁移命令的第4个参数可指定此指针；迁移完成后业务 workspace 的数据库/代际目录归应用用户所有。
3. root 0600 的配置参考 `deploy/linux/evolution-environment.example`。可信状态目录 root 所有、0750、group 为 `emergentinc-validator`；审批 DB/备份为0600。验证用户无 sudo、Docker socket、正式库和凭据权限。
4. Gene 构建在临时 systemd unit 中执行：独立网络 namespace、正式 workspace/凭据不可见、离线锁定安装、typecheck/test/build/前端 build、资源上限。完成后 Release 转 root 所有并只读，再计算 Hash。候选 smoke 只使用复制双库及临时口令。
5. Body worker 单独安装到 `/opt/emergentinc-body`，使用独立 `emergentinc-sandbox` 用户及其 rootless Docker daemon；应用只访问共享 group `emergentinc` 的 Unix socket，不持有 Docker socket。`body-sandbox-environment` 指定 Docker 路径与管理员核验的镜像 digest；unit 见 `deploy/linux/emergentinc-body-sandbox.service`。

出生前暂停并排空业务/Body/Dream，备份后执行 Final Dream。BIRTHING 正式服务保持暂停，健康检查成功后才开始业务。失败恢复代码和 Current 指针，绝不覆盖 Lineage；先冻结失败 Current，稳定后显式 `post-rollback-dream`。

## 尚未进行的最终验收

Linux 模板和真实隔离均未在本机安装/验证。仍需核验 rootless/seccomp/cgroup、无网络/宿主挂载/凭据、CPU/内存/PID/超时、Node permission 的实际文件/child_process 边界、强制终止清理、进程权限和真实切版恢复。

最终实验仍待真实 Linux：Body 实际生长 → Dream → Owner 两层批准 → G2接管 → G3故障 → G2恢复。完成后才能宣布“已经活过一代”。
