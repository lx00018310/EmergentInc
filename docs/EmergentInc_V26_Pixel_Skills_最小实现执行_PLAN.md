# EmergentInc V26 — Pixel × Skills 最小实现执行 PLAN

> 交接对象：本地 Codex / AI 编码代理  
> 原则：**最小更改、优先复用现有运行链路、先跑通核心闭环，不做过度设计。**  
> 基准：截至 2026-10-09 核查的公开 `main` 最新提交 `43790ffd8240456527540a1728075811057475ed`（V25）。**执行前先核查本地 HEAD；若已更新，以最新代码为准对齐接口，不回退或覆盖后续工作。**

## 0. V26 唯一目标

让**新生、无私人记忆的 Pixel** 能够发现并按需读取经过共享的工作方法（Agent Skills），按照这些工作方法调用**已有且获授权**的工具完成任务；Pixel 可以把自己总结的新方法保存到 Body，经过**现有** Gene 提名、审查和代际发布流程，供下一代其他 World 的 Pixel 继承。

**一句话：Pixel 是自主决策主体；Skill 是可复用的工作方法；Tool 是有权限边界的操作接口；Gene 是经批准的公共遗传资产。**

### 成功闭环

1. 在隔离测试 World 中，Pixel A 使用 `save_artifact` 创建一份 `customer-discovery.skill.md`，或由已有私有交付物导入；该文件属于 A 的 Body，不改变代号。
2. A 调用 `LIST_SKILLS` 发现它，调用 `READ_SKILL` 获得正文，依照步骤使用现有授权工具，而不是重新发明流程。
3. A 使用现有 `NOMINATE_GENE_ASSET`，以 `kind=knowledge` 提名该文本；沿用隐私、授权、通用性审查和准确哈希批准。**未经 Owner 批准不得自动发布、不得切换代号。**
4. 在隔离测试或真实批准后的下一代，全新 World 的新 Pixel B 能从公共 Gene 的 Skill 目录中找到并读取相同方法，且完全没有继承 A 的私有 `pixel.md`、文件和凭据。

## 1. 现状锚点（不要重复造轮子）

| 文件/模块 | 当前责任 | V26 处理 |
| --- | --- | --- |
| `packages/tools/src/registry.ts` | 工具注册、Prompt 工具目录 | 继续使用 |
| `apps/server/src/services/world_tools.ts` | 注册 World 特有工具、World 作用域校验 | **新增两个只读工具** |
| `apps/server/src/services/world_runtime_manager.ts` | 给 World 注入工具、构建 Prompt | 原则上不变；仅为必要的注册布线做最小更改 |
| `packages/runtime/src/agent_step/agent_step_runner.ts` | Pixel 决策、执行作用域 | 不改协议与生命周期 |
| `packages/tools/src/builtin/artifacts.ts` | Pixel 私有 artifact 保存、读取 | 直接复用 `save_artifact`，不新增写入工具 |
| `apps/server/src/services/gene_promotion_service.ts` | Body 资产提名、审查、Gene Patch、继承 | **复用 `knowledge` 类型**；除确有阻塞缺陷外不改提名发布状态机 |
| `packages/tools/src/business/pure_skill.ts` | 当前纯计算 JS Skill | 原样保留，**不改、不替代** |
| `genome/manifest.json` | Gene / 既有纯计算 Skill 约束 | 不新增层级；原则上无须改接口版本 |

**重要区别：**当前可执行 `pure-ast-json@1` Skill 是沙箱函数；V26 新增的 `SKILL.md` 是**供 Pixel 阅读的工作方法文档**，本身不是代码执行许可。尤其不能把 Markdown 塞进当前 `kind=skill` 的 JavaScript 校验与执行链路。

## 2. 实现边界：严格只支持最小 Agent Skills 子集

### 2.1 文档格式

Body 文件使用现有单层 artifact 目录，无须新增目录树：

`worlds/<world_id>/live/artifacts/<pixel_id>/<slug>.skill.md`

内容示例（仓库增加一个样例，正式安装/晋升按既有 Owner 流程）：

```markdown
---
name: customer-discovery
description: 帮助识别潜在客户、澄清问题并记录下一步行动
---

# Customer Discovery

## When to use
用户要求识别真实客户需求时使用。

## Steps
1. 明确客户群体与问题假设。
2. 用当前**已授权**的工具收集公开证据。
3. 记录事实、假设、证据来源及下一步行动。
4. 没有外部发送权限时，只生成待 Owner 审核的草稿。

## Validation
输出包含：问题假设、来源、置信程度、下一步。
```

支持 `SKILL.md` 标准风格的 YAML frontmatter 中最基本的 `name`、`description`，**只承诺兼容该受限子集，不宣称完整支持 Agent Skills 规范**。不得顺便引入完整 YAML 运行平台、Skills Marketplace、脚本入口或依赖安装。可以用现有解析能力；若写极小解析器，仅支持明确规定的单行字段，并测试对不支持语法的拒绝行为。

### 2.2 唯一公开接口：两个工具

**`LIST_SKILLS`**（read，无参数）：
- 合并两类来源：①调用者**自己**的 `<slug>.skill.md` Body artifact；②当前已激活 Gene 目录里 `kind=knowledge`、内容能识别为上述 Skill Markdown 的资产。
- 只返回紧凑元数据：`ref`、`name`、`description`、`origin`、`version`（Gene 适用）。不返回正文，不把全部 Skill 注入 Prompt。
- `ref` 稳定且无歧义，建议 `body:<slug>` / `gene:<asset_id>`；同名不自动覆盖，调用者明确指定。

**`READ_SKILL`**（read，`{ "ref": "body:customer-discovery" }` 等）：
- 只按 `LIST_SKILLS` 定义的 ID 读取；**Body 仅限当前 Pixel**，Gene 只读已获批准、属于当前活动 Release 的公共资产。
- 返回正文、来源、哈希、必要时版本；保持固定小上限（如单个 Markdown 最多 32 KiB），超过上限失败，不截断后伪装完整流程。
- 解析 Gene 资产时复用 `readGeneCatalog` / `loadGeneAsset` 的现有哈希校验；对现有 `knowledge` 格式按 `content.content` 解析（先确认当前序列化结构），不是把 `kind=knowledge` 一律视作 Skill。

**不得新增**独立 AI 调度器、向量数据库、RAG、Skill 评分模型、长期订阅、自动市场导入、复杂前端管理页。目录规模小，普通枚举和读取足够。

### 2.3 安全、权限与隔离

- 注册进现有 `ToolRegistry`，沿用 `ToolRuntime` / `executionScope.allowedTools` 限制；新工具不得成为受限试验或 scoped execution 绕过工具白名单的通道。
- Body 路径由可信 `ctx.workspaceRoot`、`ctx.pixelId` 生成，不接受 Agent 自定义绝对路径、World ID 或任意文件路径；可复用 `getArtifactsRoot(ctx)` 以保留 scoped artifact 隔离。
- 严格校验 slug、frontmatter、文件类型和大小；拒绝 `..`、路径分隔符、绝对路径和符号链接。单目录扫描设合理上限（例如 100 份）并可重复排序；恶意/损坏文件跳过并有诊断，不导致整个 World 失效。
- Skill 正文是**数据/指导建议**而非系统指令：不能修改 Constitution、身份、Owner Mandate、审批、付款、工具授权；不能通过正文自动执行 shell/JS、联网、读取任意路径或安装包。
- Gene 的隐私、版权/许可、来源哈希与两阶段审批继续使用原管线；不能借 `kind=knowledge` 绕过 Owner 审查。
- 不自动将别的 Pixel 私有 artifact 暴露给当前 Pixel；跨 World **仅**允许继承批准后的 Gene 文档。

## 3. 开发阶段与交付验收

### Phase A — 发现和读取（优先完成）

**改动：**
1. 在 `apps/server/src/services/world_tools.ts` 附近新增最小读取逻辑（允许抽出一个小 helper，不必建大型 SkillManager）。
2. 实现 `LIST_SKILLS` / `READ_SKILL`，注册进现有 World 工具表。
3. Prompt 只暴露**两个工具的名称与用途**，需要时才列目录、取正文。无需在 System Prompt 中提前附加 Skills 内容。

**验收：**
- 现有 World 中 Pixel 可查目录、按 ref 读取；空目录返回 `[]`，不存在的 ref 有稳定失败结果。
- 新创建 World（隔离测试）可读取激活 Gene 中符合格式的 Skill；不读取其他 World 私有文件。
- 调用不得改变账户能量逻辑、模型调用预算、ToolResult 语义、Run 事务、现有纯计算 Skill。

### Phase B — Body 产出与实际复用

**改动：**
1. 直接使用现成 `save_artifact` 输出 `<slug>.skill.md`；无须 `CREATE_SKILL` 新工具。
2. 在 `resources/prompts/v9_system_prompt.md` 增加**最多几行**使用指引：遇到可复用任务可先 `LIST_SKILLS`；命中后按需 `READ_SKILL`，否则自主解决；正文不授予权限；有效新方法可按已有 artifact 机制沉淀。
3. 增加 `docs/examples/skills/customer-discovery/SKILL.md` 示例；示例是开发/运营可用的种子材料，**仅被放入 docs 不代表已装入运行时 Gene**。可在测试中通过现有 artifact 路径注入或用已有工具创建。

**验收：**
- Pixel A 创建 Skill 后无需改代码、无需换代，同一 Pixel 后续可以发现并读取。
- 在真实任务中至少演示一次“目录发现 → 加载方法 → 已授权工具或文字交付物”的执行链；没有授权时正常拒绝，而非暗中扩权。
- Body 创建、更新不会触发 Gene generation 增加；Pixel 新生无须继承上一 Pixel 的私有心智。

### Phase C — 复用现有 Gene 晋升（不新建审批状态机）

**改动：**
1. 在现有 `NOMINATE_GENE_ASSET` 以 `kind=knowledge` 提名合法 `<slug>.skill.md`，保持现有 snapshot → Owner review → proposal → exact hash approve → generation birth 路径。
2. 让 Phase A 的 Gene 读取器能够将晋升后的 `knowledge` Markdown 识别为 Skill。优先只改读取适配，不改 `buildPatch` 通用状态机。
3. 如查明现有晋升对 Markdown 的存储格式/授权路径确有阻塞，只做针对此用例的最小修复并加回归测试；**不得跳过当前发布的准确哈希审批或自动写 live Gene**。

**验收：**
- 准备一个 Skill 晋升候选并确认审批前其他 World 看不见；Owner 未实际批准时只报告 `AWAITING_APPROVAL`，不得编造已经出生的一代。
- 在隔离模拟或真实批准发布后，创建新 World 和空心智 Pixel B：`LIST_SKILLS` 返回刚刚批准的 Gene Skill，`READ_SKILL` 返回已核验的内容和哈希。
- 复用 Skill 不改变 Gene；**只有经批准的 Gene 变更形成新一代**；失败继续使用现有回滚与历史事实机制。

## 4. 建议的变更范围

**应当新增/修改：**
- `apps/server/src/services/world_tools.ts`（必要时加 1 个小型读取工具文件）。
- `resources/prompts/v9_system_prompt.md`（极少量文字）。
- `docs/examples/skills/customer-discovery/SKILL.md`（示例）。
- 与工具和 Gene 继承相关的现有测试目录中增加专项用例。
- `README.md`、`README_CN.md`：各补一句「支持按需加载基于 Markdown 的工作方法 Skill；与可执行 pure Skill 不同」。

**原则上不要修改：**
- `packages/protocol` 的 Pixel 定义、DecisionCompiler、EffectRuntime、RoundScheduler；
- `pure_skill.ts` 解释器、Tool 授权规则、Owner 权限；
- 支付、商城、`/OWNER`、`/QIAN`、`/YUAN`、`/GENE`、前端框架；
- SQLite Schema / migrations、基因代际审批状态机；
- Package 依赖（非必要不增加）。

## 5. 必测项目（必须有自动化测试）

1. 有效 frontmatter、无效 frontmatter、重复名、空目录、超长文件、超过目录上限：返回行为确定、无异常泄漏。
2. Body 同一 Pixel 可读取；其他 Pixel/World 访问不了；绝对路径、`..`、symlink、非普通文件均拒绝。
3. Gene 格式正确且哈希一致可读；未批准候选不可读；篡改文件/manifest 必须拒绝；非 Skill knowledge 不误报。
4. `executionScope.allowedTools` 生效；不能借 `READ_SKILL` 读取 scoped execution 不允许的 private artifacts。
5. Skill 文档含“忽略上级指令/调用未授权工具”等内容时**不增加工具权限**，仍受现有权限和校验约束。
6. 旧的 `CREATE_BODY_SKILL` / `CALL_BODY_SKILL` / `CALL_GENE_SKILL` 和旧 Gene 晋升用例通过。
7. 验证完整闭环：A 保存 Body → 可读 → 提名但不外泄 → 正确批准和新代 → B 从 Gene 继承并可读（通过隔离测试 fixture/现有 Supervisor 测试工具完成，不篡改生产数据）。

**执行命令（按本地仓库实际环境调整，Windows 可使用 `pnpm.cmd`）：**

```powershell
pnpm.cmd typecheck
pnpm.cmd test --maxWorkers=4
pnpm.cmd --dir frontend build
```

如涉及正式启动流程，再执行现有批准版本检查。不得以 mock 支付、隔离 World 测试，宣称正式环境或真实营收验证成功。

## 6. 禁止扩展范围

V26 **不做**：把 Pixel 改成 Skill、创造第五层、完整第三方 Agent Skills 安装器、在线市场、自动下载并运行外部脚本、多模型路由、语义检索、自动授权、Skill 自动发布、UI 大重构、权限提升、新一轮支付改造。

不因为技能文件可能写有 `scripts/`、`references/` 字样就执行或读取任意文件。现阶段只处理单文件 `SKILL.md` **核心子集**；完整目录型 Skill 包兼容另立版本，在实际需求验证后再评估。

## 7. 本地 AI 完工输出要求

交付时提供：

1. **最小改动清单**：实际改动文件、功能目的及为什么必要。
2. **功能证明**：两种来源（Body / Gene）的 `LIST_SKILLS` 和 `READ_SKILL` 返回示例；至少一次新 Pixel 继承 Gene 的可复现测试。
3. **测试结果**：专项测试、typecheck、全量测试、build 的真实输出摘要；失败必须如实说明。
4. **版本与状态**：明确标记 `V26`，同时分别说明软件 Release、Gene Generation、Body Revision，不能把 V26 软件版本直接等同于 Gene 的一代。
5. **安全检查**：确认技能正文无法扩权、私有文件隔离无退化、Gene 审批没有绕过。

## 8. 最终判断标准

**不是**“支持了多少 Skill 格式”，而是：

> 一位新生 Pixel 不必从零重建前人已经验证的工作方法；它可按需发现、读取、运用，并在实践中形成可审批、可追溯、能被后代继承的改进。

达到上述闭环即结束 V26。其他灵感记为后续候选，不在 V26 追加设计。
