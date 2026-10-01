# /GENE 四层生命架构页面整改实施记录

日期：2026-10-01。代码基线：`fabf640`。依据：[整改 Plan](EmergentInc_GENE_四层生命架构页面整改_PLAN.md)。

本次完成页面整改和本地验收。未变更原 workspace 的数据库、代际指针或维护审批；未部署独立 Supervisor、未执行正式实例切代。

## 完成内容

1. `GET /api/evolution/overview` 增加 `trust / genome / evolution / body`，保留旧顶层字段。所有生命数据来自现有 Genome、Lineage 和 Current，未新增数据库。
2. Recovery 仅通过 `EMERGENTINC_RECOVERY_ORIGIN` 指定的无认证 `/health/live` 探测，设置 1.5 秒超时、禁止重定向，不携带凭据；未配置为 `NOT_CONFIGURED`，只有 `alive: true` 且 `role: recovery` 才显示 `REACHABLE`。可达不等于可信控制通道已连接。
3. 信任根显示现有 Lineage 裁决与 Memory Gate 中的出生、失败、回退、边界证据。未读取 Supervisor 私有数据库；准确 Hash 审批、详细验证与恢复控制未接入时明确展示待审或未连接。
4. `EvolutionPanel` 改为兼容导出；页面拆成四层组件、统一状态条和事件流。默认折叠详情，每层始终显示当前状态、最近发生、等待事项。
5. Genome 显示真实 Hash、接口版本、受保护路径和能力契约，保留提案的批准方向 / 拒绝操作与最近六代历史。形成提案的事件与提案内容分开显示。
6. Evolution 显示 Dream 计划、时区、待整理事实、运行结果、保存响应恢复、Memory 来源与进化流水线。事件按实际记录时间倒序取最近 20 条；长时间运行的 Dream 按完成时间进入事件流。
7. Body 显示实际 Revision、每项 Skill 的激活 Revision、Needs、最近 20 个候选和 Current Events；回退事件明确显示失败 Revision 与恢复 Revision。经营摘要使用服务端现有业务表，原工作台继续复用。
8. `/GENE` 登录后默认进入“生命总览”，导航为“生命总览 / 经营 / 方案 / 连接与资料”。费用与业务表单保留在原经营区域。

## 自动检查

| 检查 | 结果 |
| --- | --- |
| API 测试先行 | 初始 3 项因缺少四层 DTO 失败，实现后通过；最终扩展为 5 项 |
| `pnpm test --maxWorkers=4` | 70 个测试文件、489 个测试全部通过 |
| `pnpm typecheck` | 通过 |
| `pnpm --dir frontend build` | 通过；原有大 chunk 提示仍存在 |
| `git diff --check` | 通过 |

最终回归覆盖未认证访问、无配置 / 错误服务 / 离线 Recovery、只读投影、契约来自 API、事件排序与限量、独立边界证据不被合并丢失、身体回退 Revision、登录后的默认四层、Dream 异常与保存响应恢复、原经营入口。

一次默认并行回归与构建同时运行时，原有 `generation_supervisor` 的 G0003 回退测试触发 5 秒超时；构建结束后使用 4 个 worker 单独跑完整回归通过。未修改该测试或放宽时限。

## 真实浏览器验收

使用 Codex 内置浏览器访问 `http://127.0.0.1:8765/GENE`，连接真实编译后的服务器与独立临时 workspace，启用候选模式以暂停后台业务。没有替换浏览器中的 API 数据，也没有使用原 workspace 的私有配置。

- 完成 Owner 登录，默认出现四层而非费用首页。
- 在默认 `1280 × 720` 视口中，Root / Genome / Evolution / Body 的下边界分别为 `300 / 437 / 573 / 709px`，四层摘要完整进入首屏，无横向溢出。
- 分别展开四层，检查信任状态、契约与折叠历史、进化流水线与 Memory 来源、身体空状态与工作摘要。
- 从 Body 进入经营；再访问方案与连接资料页，确认预算、业务方向、订单凭据、资料上传与 GitHub 连接入口保留。
- 最终页面控制台没有 error / warn 记录。

临时 workspace 由现有初始化流程建立为 `G0001 / R0`，Manifest 的声明代数仍为 `4`，详情分别显示两者；页面未写死计划中的 `G0004`。运行中的实际代号决定首页身份。

首屏截图：

![四层生命页首屏](C:/Users/ASUS/.codex/visualizations/2026/09/30/01a0f192-078f-70a1-a996-be8c1bc48b42/gene-four-layers.png)

## 使用边界

这是页面与本地工程验收，不是独立恢复底座或 Linux 部署验收。可信控制通道仍显示 `NOT_CONNECTED`，没有新增网页切代、强制回滚或准确候选审批按钮。

前后端源码属于当前受保护路径，修改会改变 Gene Hash。原 workspace 正式运行本次源码仍须走原有准确候选审批与受控升级流程；本次没有覆盖已有代的 Hash，也没有自动执行升级。验收临时进程在检查结束后停止。


## 正式 workspace 发布补记（2026-10-01）

后续稳定启动修复已将此四层页面与 Hash V2、冻结启动流程共同发布为 G0005（`local-20261001-g5-frozen-v3`）。此前“原 workspace 尚未升级”的记录描述当时状态；目前 8765 正式实例已通过三个页面的 Edge 验证，人物、元胞与历史运行记录保持不变。完整证据见 [稳定启动修复记录](EmergentInc_V22_整改实施记录.md#稳定启动修复冻结批准版本)。本次发布不增加四层架构的真实隔离或自动候选能力。
