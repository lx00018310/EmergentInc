# 隔离执行器与候选验证（P5 实施中）

`RootlessSandbox`、候选验证器与 `scripts/automation-supervisor.mjs` 构成 V21 可信管理员自动化通道，其准确 hash 审批保持不变。V22 新增独立的自主 Body 路径和 rootless worker，并增加 Gene Supervisor 安装模板；说明见 [V22 实施记录](../../docs/EmergentInc_V22_实施记录.md)。本文的 V21 通道仍不负责整个应用 Release，所有 Linux 真实隔离与切代尚待实机验收。

## 环境要求

- 专用非 root Linux 用户；该用户拥有独立 rootless Docker daemon。服务主进程不应获得该 Docker socket 的访问权限。
- cgroup v2、systemd 驱动，实际支持 memory/swap/pids/CPU quota 控制；daemon 报告 rootless 和 builtin seccomp。
- 管理员预先审查并拉取包含 `/usr/local/bin/node` 的 Node 镜像，填写完整 `name@sha256:<64位摘要>`。不接受可变 tag，不自动安装或拉取。
- 可信代码、验收用例和后续发布监管器由独立运维身份维护，不能由候选程序覆盖。

```bash
# 在选定 Linux 测试机执行，摘要必须来自管理员实际核验的镜像。
export EMERGENTINC_SANDBOX_IMAGE='node@sha256:<实际镜像摘要>'
node scripts/sandbox-check.mjs probe
node scripts/sandbox-check.mjs validate /path/to/candidate.mjs /path/to/new-validation-receipt.json
```

Windows 或 root 身份执行会拒绝。没有正确环境时保持不可用，不使用宿主 Node、shell 或虚拟机上下文兜底。

## 已编码的边界

当前仅支持接收 JSON、返回 JSON 的默认导出函数 `export default async function(input) { ... }`。不接入安装依赖、通用网络代理或外部能力 IPC。

候选代码和显式输入通过 stdin 进入容器。无宿主 bind mount、数据库、private、代码目录或 Docker socket；网络为 none；根文件系统只读；移除全部 Linux capabilities；no-new-privileges；以 65534:65534 运行；256 MiB 内存、0.5 CPU、32 进程、15 秒执行上限、64 KiB 输出上限；临时空间为有界 noexec tmpfs。运行前再次检查容器实际配置。应用环境变量不继承给 Docker 客户端或候选。

执行结束、失败或超时均清理该次随机命名容器。清理不能确认时停止后续运行。**主机执行器进程被强制杀死时，容器可能留存**；管理 CLI 在验证、激活或执行前取得独占目录锁，再调用 `recoverInterrupted` 清理专用 daemon 上带本产品标签的残留容器。该恢复目前只有替身测试，未在 Linux 强制终止场景验证。管理员不得对多个数据目录或并行执行器共享该 daemon 后调用恢复。独立的 `sandbox-check.mjs` 仅用于手工诊断，不提供持久进程监管。

## 首个候选验证契约

`csv_numeric_summary@1` 针对现有 CSV 报告不能汇总文本金额的问题：输入 `rows` 与明确 `numericFields`，输出 `{ rows, totals, invalid }`。验收包括空表、文本金额、负数、编号保留、公式/缺失值拒绝，以及仅统计指定字段。

可信用例固定在 `automation_validation.ts`；它在容器外比对输出。候选返回 `passed:true` 不构成通过。候选 hash 同时绑定源码、固定运行镜像、契约版本和可信用例 hash；激活必须重新核对这些值。手工诊断收据由调用方写入一个新文件，不覆盖已有证据；单独的收据文件不构成上线许可。

## 独立程序版本管理通道

管理目录必须与业务 workspace 分开，由专用运维用户拥有，Linux 权限 0700。`changes.sqlite3` 保存源码、问题证据、状态、可信验证结果、批准 hash、前版指针和事件历史；候选容器没有此目录挂载。目录独占锁阻止第二个管理进程并行切版。不要让业务应用用户读取或写入这个目录。

```bash
# request.json: {"id":"change-唯一标识","source":"export default ...","problem":"复现问题","evidence":"证据参考"}
node scripts/automation-supervisor.mjs /var/lib/emergentinc-supervisor submit request.json
node scripts/automation-supervisor.mjs /var/lib/emergentinc-supervisor validate change-唯一标识
node scripts/automation-supervisor.mjs /var/lib/emergentinc-supervisor show change-唯一标识
# Owner 独立审阅源码、可信验证与具体 candidate_hash 后，运维执行：
node scripts/automation-supervisor.mjs /var/lib/emergentinc-supervisor approve change-唯一标识 <实际candidate_hash>
node scripts/automation-supervisor.mjs /var/lib/emergentinc-supervisor activate change-唯一标识
node scripts/automation-supervisor.mjs /var/lib/emergentinc-supervisor run input.json
node scripts/automation-supervisor.mjs /var/lib/emergentinc-supervisor rollback change-唯一标识
```

同一 id 的相同请求返回原记录，内容改变则拒绝；重复激活不会二次切版，也不会复活已回退候选。验证中断在下一次独占恢复后重新成为待验证。候选激活只更新该纯计算程序的版本指针，不重启经营应用、不迁移数据库。

运行时还验证输入/输出结构。程序失败自动回退到通过相同可信规则、镜像兼容且已获批的前版；没有前版时保持停用。环境变化、清理失败或回退无法确认时清除活动版本并标为 `RECOVERY_REQUIRED`，不宣称恢复成功，不自动用前版重跑这次输入。查询历史无需再次运行候选。

此 CLI 的执行身份是运维信任边界，不是网页 Owner 登录。当前需要运维携带 Owner 的明确版本决定操作；后续接入网页审批及 Pixel 开发任务时，必须加上父方案 grant、累计预算和资料范围校验，不能把本 CLI 暴露成任意 shell 工具。

## 必须在 Linux 实机补做

1. 尝试读取宿主 private、业务库和 socket，尝试写根目录、访问公网，确认失败。
2. 制造无限循环、过量输出、内存/进程耗尽，确认限制生效且容器被清理。
3. 强制终止执行器，确认 supervisor 独占恢复可清理遗留容器。
4. 使用管理 CLI 在真实容器中验证具体 hash 审批、持久 change_id、激活、运行失败停用和回退，并确认业务事实没有被改写。

目前仅有命令契约与可信验证器单元测试，未验证实际 Linux 隔离。

依据：[Docker rootless](https://docs.docker.com/engine/security/rootless/)、[容器运行约束](https://docs.docker.com/engine/containers/run/)、[seccomp](https://docs.docker.com/engine/security/seccomp/)。
