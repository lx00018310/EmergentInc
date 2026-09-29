# V21 整体重构实施记录

更新时间：2026-09-29。基线提交：`333c9751a903b2ce179b3ba4bed59df187f4fa3c`（V21 BASE）。本记录对应 [整体重构 Plan](./EmergentInc_方案授权与自主经营_整体重构_PLAN.md)，不是完成声明。

## 当前交付边界

已建立独立 business 运行路径：单 Owner 登录、费用授权、方案拟定与版本审批、持久任务与周期调度、资源接续、资料报告、限定账号的 GitHub 议题、订单/人工收款凭据、反馈复盘、历史策略恢复。Owner 日常入口为“首页 / 方案 / 连接与资料”，不要求配置 Pixel 坐标、Energy 或 Run 轮数。

P5 另有独立运维通道：rootless 执行器、可信候选验证、持久 change_id、具体 hash 审批、自动化程序激活及失败回退；目前仅完成替身测试，未接 Pixel 自动生成、网页审批或业务任务。受限协作者、应用/内核发布监管、版本化经验库及旧主线只读历史投影仍未实现。未做 Linux 实机部署/隔离、真实付费模型试验、真实渠道运营、外部客户付款核验或目标用户验收。**不能把当前版本称为完整自主经营或自修改系统。**

## 按计划阶段核对

| 阶段 | 已落地 | 尚未完成 |
| --- | --- | --- |
| P0 | 分离业务库与旧库；运行模式互斥；独立数据目录；登录/来源校验；未知 schema 拒绝启动；一致性备份；systemd 模板；Windows 实际重启恢复 | Linux 实机进程/权限/代理/重启/恢复验收；旧数据逐项迁移盘点 |
| P1 | 拟定额度先授权；不可变方案版本/hash；精确批准签发 grant；重复批准去重；新版本撤销旧权限；暂停/到期/终止；资源待办 | 通用澄清对话与更广泛的经营方案能力；当前方案只能组合已注册的三种能力 |
| P2 | SQLite 事件/任务；worker 租约；依赖顺序；定时执行；停机合并；请求持久化；未知结果不重发；整数费用预留/结算；资料报告 | 更多任务类型的恢复策略；长期运行与 Linux 实机故障演练 |
| P3 | 一个真实 REST 连接器的代码路径；账号/仓库/正文范围验证；渠道回执和只读核验；订单/部分付款/退款；Owner/test 资金分开 | 当前 HTTP 测试均为替身；未取得真实对外行动、外部响应、交付和非 Owner 付款证据；支付来源均为人工确认 |
| P4 | 资料/连接申请与接续；GitHub 第二种明确能力；反馈按授权定时复盘；无新事实零调用；修订版本待批；历史策略恢复为新草案 | 独立版本化经验库、自动读取渠道反馈、通用 MCP 动态接入；未实现的能力不能靠“已提供”文字变成权限 |
| P5 | 独立 rootless 执行器；可信 CSV 汇总契约；候选 hash 绑定代码/镜像/用例；独立 SQLite 版本记录；运维 CLI 精确批准/激活/失败回退；Windows 拒绝宿主执行 | 尚未接入 Pixel 自动生成/网页审批/经营任务；没有协作者；没有应用/内核 release 监管；真实隔离、实际代码改进和失败回退未做 Linux 验收 |
| P6 | 三个日常页面；离线浏览器演练；旧行为回归保持通过；business 不暴露旧模型/Run/工具接口 | 目标用户完整验收、重大异常全覆盖、旧模式只读化、真实经营成功定义验收 |

## 实现入口与关键约束

| 入口 | 用途 |
| --- | --- |
| `packages/protocol/src/types/business.ts` | 可批准方案契约、能力版本、结构与范围校验 |
| `packages/protocol/src/types/business_schedule.ts` | 有界 interval / daily 时区调度 |
| `packages/persistence/src/business_store.ts` | 版本、grant、任务、事件、原子费用、恢复与反馈 |
| `packages/persistence/src/business_evidence.ts` | 订单、销售/交付状态、付款/退款证据、来源分类 |
| `packages/persistence/src/migrations/business_schema.ts` | 独立业务 schema，当前版本 1 |
| `apps/server/src/services/business_service.ts` | 有界模型拟定/复盘、纯报告、外部动作及响应恢复 |
| `apps/server/src/services/business_connections.ts` | 私有凭据保存、账号和仓库约束 |
| `packages/tools/src/business/github_issues.ts` | 固定 GitHub API 地址、有限响应、回执核验 |
| `apps/server/src/routes/business_routes.ts` | Owner 业务接口 |
| `apps/server/src/owner_auth.ts` / `runtime_config.ts` | 会话、单 workspace 进程锁、部署配置 |
| `frontend/src/features/business/` | 方案操作、资料、结果、费用核验和恢复界面 |
| `scripts/business-maintenance.mjs` | SQLite online backup、完整性/哈希/表计数清单 |
| `deploy/linux/` | 非 root systemd 服务与环境模板，尚未实机运行 |
| `packages/tools/src/business/rootless_sandbox.ts` / `automation_validation.ts` | 固定 rootless 容器边界、输出限制、可信候选测试 |
| `apps/server/src/services/automation_supervisor.ts` / `scripts/automation-supervisor.mjs` | 独立运维程序的候选持久记录、准确 hash 审批、激活及回退 |

权限永远来自 Owner 批准的具体方案，而不是模型输出中的角色或权限字段。首版所有方案归属同一个负责人 Pixel，没有假装已实现多 Agent 协作。

金额使用 CNY 整数微元。实例累计余额、方案累计余额和拟定额度不能通过换版本重置；费用未知保留预留。自动复盘使用方案授权，不受首次拟定额度是否过期影响。模型/外部服务已发出的请求不因重启而重新发出；已收到且已结算的响应可恢复，不再付费。

账号授权失效会产生失败待办并暂停受影响方案。重启前未发出的外部任务需要 Owner 再决定。外部结果未知只阻止其依赖步骤；其他方案的资料处理可以继续。旧策略恢复保留费用和业务事实，生成新版本并重新审批。

资源、连接、方案和表格中的文本均不拥有执行权限。当前不接受任意代码、shell、任意 URL 主机或支付指令。GitHub 连接只适合已管理的指定仓库；不宣称这是所有小老板适用的获客渠道。

## 本地验证证据

环境：Windows、Node 24.14.1。所有经营测试使用临时数据库和受控输入，未调用实际付费模型或向 GitHub 发帖。

| 验证 | 本轮结果 |
| --- | --- |
| `pnpm.cmd test` | 59 个文件、403 项测试通过；包含基线 349 项、业务新增 40 项和隔离/版本管理 14 项 |
| `pnpm.cmd typecheck` | 通过 |
| 根 TypeScript 构建 | 通过；test 脚本先构建，避免 workspace 包读取旧 dist 导致假失败/假通过 |
| `pnpm.cmd --filter emergentinc-frontend build` | 通过；主 JS 约 902 KB，有原有大 chunk 提示 |
| 实际 Node bootstrap / HTTP / 强制停止 / 再启动 | 独立临时 workspace 数据保留；重新登录后仍有上传资料；模型未配置，不产生真实付费调用 |
| SQLite WAL 一致性备份及副本恢复演练 | online backup 包含已提交 WAL；新目标拒绝覆盖；副本 integrity check 与记录检查通过 |
| 浏览器离线旅程 | 测试口令登录、授权测试额度、提出方向、审批、报告、刷新保留；修订后恢复旧策略形成第 3 版待批草案，测试累计费用不增加；fixture 不含真实模型或外部账号 |
| P5 独立边界/版本管理测试 | 14 项通过，Docker 执行器为替身；包括拒绝 root/Windows/可变镜像/非法 socket、检查资源、清理失败停用、伪造通过无效、持久候选、精确审批、重复激活不复活、失败回退不重跑 |
| Windows 实际执行 sandbox probe | 明确返回 `ROOTLESS_LINUX_REQUIRED` 并以非零状态退出；没有宿主执行兜底 |
| 独立管理 CLI 进程演练 | 临时目录提交候选，退出后由新 Node 进程查询仍为 PROPOSED；Windows 激活被拒绝，没有执行候选源码 |

新增自动场景涵盖：预算未经许可不调用；并发预留不能花同一余额；版本/hash 精确审批；资料/账号越权；费用超预估保留事实；响应未知不重发；停机恢复与陈旧 worker；未来 schema；DST/定时合并；订单/部分退款/事件幂等；无新反馈不调用；已收费错误复盘暂停；旧反馈分批消化；策略恢复保留事实；网页付费重试复用请求标识。

既有 Canvas mock、React act、SQLite experimental、Vitest workspace 弃用和 Vite 大 chunk 提示仍存在，没有把这些提示当成通过的替代证据。

## 数据、备份与回退

业务数据库独立保存为 `<workspace>/ledger/business.sqlite3`。此次没有迁移或覆盖已有 `v9_core.sqlite3`，没有清除旧工作区、真实订单、凭据和历史记录。新业务 schema 尚处首次开发阶段；不能把旧版程序直接用于新业务库。

代码尚未形成新的 Git 提交或推送。V21 BASE 保持原样。本地修改可审阅；丢弃代码之前先保存实现和业务库副本。恢复旧运行方式要停服务、处理在途/待核实请求、保留业务库，再显式切 `legacy`。该操作不会把 business 任务搬进旧引擎，也不会撤销已发生的交易。

生产应用回退必须以候选发布的数据兼容验证为前提；当前只有独立纯计算自动化程序的版本管理器，没有应用 release 自动发布监管器，不能承诺经营服务自动切版恢复。详细启动、私有报价、异常操作和备份命令见 [业务模式指南](./guides/BUSINESS_GUIDE.md)；P5 运维通道见 [SANDBOX](../deploy/linux/SANDBOX.md)。

## 下一阶段所需条件

本机 `docker` 命令不可用；`wsl --list --verbose` 报告没有已安装的 Linux 发行版。P5 需要选择独立 Linux 测试环境，或明确允许在本机安装 WSL2/发行版及 rootless Docker。不能把依赖接口 mock 或普通子进程执行写成沙箱验收通过。

下一步先在选定 Linux 环境验证非 root、无 private/数据库/宿主写挂载、无 socket、默认无网络和资源上限，再验证候选审批/激活/运行失败回退，然后接入 Pixel 开发任务与网页审批。真实业务实验另需一份由 Pixel 提议、Owner 批准的具体预算、账号、方向和期限；当前开发授权不代替这些经营授权。
