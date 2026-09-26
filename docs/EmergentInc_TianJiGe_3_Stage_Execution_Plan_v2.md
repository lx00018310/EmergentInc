# EmergentInc → 天机阁：三阶段执行 Plan（本地代码校准 / Luna max 执行版）

> 修订日期：2026-09-25。Plan 校准基线：本地 HEAD `7da4256`；Stage 1 执行基线：`fc3d4c7`。
> 来源：[评估天机阁方案](chatgpt-conversation://6ab64d3c-5200-83e8-870e-6b141a4e7604) 的六轮对话，以及用户下载的同名 v2 文件。
> 原文件 SHA-256：`338b7812659027c1002ce8942e9a50b68485cb80d339a64b4f580fc026bdfef6`。
> Plan 校准阶段只修改了本文；随后按本文执行了 Stage 1。未迁移真实 workspace，未运行真实模型，未宣称商业闭环完成。执行证据见 8.4。
> 本文继续使用原文件名，正文替代原 v2 中未落到代码的建议。未勾选项目均未完成。

## 0. 给执行者：先读这一节

### 0.1 目标与分工

最终形成：Pixel 运行 → 千机身份 → 招聘/试炼 → Mission → Product → 交付/反馈/收入 → 可交给 Muse 的事实材料。

- Engine / Codex：数据、状态机、预算、调度、工具边界、API、前端容器和测试。
- Muse：名字、称号、性格、缺陷、行为风格、角色图片、考题题材、故事和文案。
- 用户：方向、内容选择、录用、任务验收、阶段衔接、真实业务验证。
- 本 Plan：固定实施决策，减少 Luna 在跨层实现时自行补架构的空间。

人物内容可以替换，事实与历史 ID 不随人物改名而变化。保留“角色卡牌 + 场景式组织界面”的目标，同时保留现有 Engine 调试能力。

### 0.2 执行粒度与停止规则

1. 收到“执行这份 Plan”但未指定阶段时，只执行 Stage 1；完成技术验收后停止，提交阶段报告。
2. 指定阶段后，按该阶段任务编号串行推进。每次只处理一个任务包，相关测试通过后再进入下一个；不并行实施不同层，不开启 subagent。
3. 每个任务先读列出的现有入口，再改类型/持久层/业务/界面；不得仅根据本文猜函数签名。
4. 不自动提交、推送、部署、访问生产 VPS、发送外部消息、修改模型配置或运行真实付费模型。后续用户明确授权的操作，按该授权执行，不重复请示。
5. 阶段验收不通过，先修本阶段引入的问题。若需要改变本 Plan 的业务规则、放宽权限或破坏旧数据，列出具体冲突，在普通聊天中提问后停止。
6. Muse 正式素材缺失不阻塞通用代码和测试；使用明确标注的中性测试内容。不得编造正式人物，也不得把占位图验收成“正式美术完成”。
7. 代码完成、用户内容验收、真实业务验证分别报告。技术测试不能替代真人付款或真实交付证据。
8. 完成一个阶段后停止，不因为后续章节已经写好而自动跨阶段。

每个任务结束，在本文末尾的执行记录中记：修改文件、验证命令及结果、未通过项、下一任务。不要另建复杂任务管理系统。

### 0.3 当前工作区保护

修订时已有用户改动：`frontend/src/features/pixels/HeartbeatLightning.ts`。这是现有 3D 心跳效果工作，不属于本 Plan 改造目标；不得覆盖、格式化或回退它。

开始实施时重新执行 `git status --short`，记录新的用户改动。只改任务所需文件，不清理无关文件，不全仓替换 Pixel 命名。

## 1. 本地代码核对结果与本版修正

以下是 2026-09-25 读取代码得到的事实，不是对旧对话的推测。执行时若基线变化，先核对对应入口。

| 已核实的入口 | 当前行为 | 对 Plan 的影响 |
|---|---|---|
| `packages/model/src/prompt/prompt_builder.ts` | 五层 Prompt；输入字段有严格 allowlist | 新增 identity 必须同步输入契约、allowlist、组装和测试 |
| `packages/runtime/src/agent_step/agent_step_runner.ts` | human 进入 External；读取自身 mandate/artifacts；调用后结算，再执行 Effects | 身份和回复必须接入此链；不能另起人物 LLM 服务 |
| `apps/server/src/services/owner_chat_service.ts` | Owner 全局只读资料问答；独立 owner_chat_calls | 保留为老板助手，不冒充某个千机 |
| `packages/domain/src/router/routing_rules.ts` | 只允许 SELF、STOP、六邻居 | 不能用 send_to=human 实现人物回复 |
| `packages/protocol/src/types/decision.ts` | 无 Owner 回复字段 | Stage 1 增加小型 owner_reply 协议及幂等 Effect |
| `packages/persistence/src/repositories/message_repository.ts` | claimNext 按轮次全局领消息；无 Mission/Trial 隔离 | Stage 2 必须把执行范围带进领取、唤醒、派生消息和工具 |
| `apps/server/src/services/run_service.ts` | 单一 Run；DB 检查未决操作；round 写 world_state.json | 复用单一 RunService；试炼串行，不加第二调度器 |
| `packages/persistence/src/repositories/budget_repository.ts` | 预留检查 Pixel 和 Run；global_budget 是累计统计，不是硬上限 | 不把 Trial 预算字段当真实隔离；不恢复历史全局上限 |
| `packages/runtime/src/effects/effect_runtime.ts` 的 applyReproduce | 同坐标重生；旧文件归档到 live/history/<pixelId>/<effectId>；incarnation 在 state.json | 身份绑定须与重生事务衔接，旧档案路径不能指向新人的文件 |
| `packages/persistence/src/migrations/init_schema.ts` | 建表及加列；schema_meta 已存在 | 在现有迁移入口加版本化、可重复执行的迁移，不引入 ORM |
| `apps/server/src/routes/api_routes.ts` | 有 mandate/reward/step-costs；无 Qianji、Mission、Trial、招募创建入口 | 不能把“复用现有招聘 API”写成前提 |
| `CoreStore.applyExternalReward` | 增加整数 Token，写 external_reward 账本 | Token 奖励不是现金收入 |
| `external_revenues / external_refunds` | 表存在；当前源码未发现对应业务写入闭环 | Stage 3 必须实现收款/退款记账，而不只是加关联字段 |
| `model_call_repository.ts` 的 CostSummary | 保留成本 null 与已知小计，工具关联 model_call_id | 人物、任务和产品统计继承“未知不等于零” |
| `frontend/src/App.tsx` | 控件、Console、PixelMapCanvas、详情、模态框在一个入口 | 最小抽出 EngineView，复用现有组件，不重写 3D 渲染器 |
| 根 `tsconfig.json`、`frontend/package.json` | 根 build/typecheck 不包含 frontend 项目 | 验收必须显式运行前端 build/typecheck/test |

原 v2 的目标保留；下面几项改为明确实施规则：

- 首版人物聊天是“排队 → 用户启动 Run → 真实回复”，不承诺发送即自动执行。
- 试炼首版 2–3 个候选人串行，统一题目/预算/模型/工具；不做并行试炼。
- Mission 的生效输入由 SQLite 渲染；保留手工 mandate.md，避免两个可编辑事实源互相覆盖。
- 人物履历通过写入时的 binding 快照归属，禁止用“当前 pixel_id 的全部历史”冒充人物生涯。
- 首版能力画像显示可追溯证据计数，不臆造 0–100 能力分或声望公式。
- 商业收款与 Token 能量分开；不自动将人民币换成能量。
- 三阶段不建设通用主题引擎、插件系统、完整 CRM、动态 Avatar 或自动内容发布系统。

## 2. 跨阶段固定约定

### 2.1 分层与权限

- 保留现有 packages：protocol、domain、persistence、model、tools、runtime；不新建“大组织引擎”包。
- 类型放 protocol；纯转换/校验放 domain；SQL 放 Repository；Owner 操作编排放 server/services。
- 新路由分别放 `qianji_routes.ts`、`organization_routes.ts`、`business_routes.ts`，由现有 registerApiRoutes 注册，沿用 /api 前缀和 app.ts 的 Origin 检查。
- 新服务在 `apps/server/src/main.ts` 装配，通过 ApiRoutesOptions 注入；同步更新测试构造，不新增全局单例。
- Owner API 是本机控制面，不等于已经具备互联网账户认证。本计划不改变 HOST/公网暴露方式。
- Pixel 不能调用 Owner 控制面来改身份、录用、完成任务或确认收入；不把这些 API 注册成 Agent 工具。
- 人物人格影响模型表达，不能增加工具权限、修改预算或越过局部认知隔离。

### 2.2 ID、时间、状态与幂等

- Qianji/Mission/Trial/Product 等新增 ID 用带前缀的 randomUUID；名字不作为主键。
- DB 时间沿用 Unix 秒；DTO 命名统一：TypeScript camelCase，SQL snake_case。已有 API 字段保持兼容，不批量改名。
- 所有新状态转换由服务调用纯状态规则并在 DB 事务中检查旧状态；不能接受前端任意 PATCH status。
- 创建、聊天入队、发布、开始、裁决、记账使用 idempotencyKey。相同 key + 相同规范化请求返回原结果；同 key 不同请求返回 409。
- 新增一个小型 `owner_action_requests` 表：key 主键、action、request_json、result_json、created_at。与该次 DB 变更同事务写入；已有 external_reward_requests 不迁移。
- 列表默认 limit=50，最大 200，按 created_at + ID 使用游标；空列表与查询失败必须区分。
- 错误体沿用 detail，可增 code；400 输入非法，404 不存在，409 状态/版本/幂等冲突。不得吞错后返回成功或空数组。
- 不把 await 放进现有 SqliteDatabase.transaction 回调；它只支持同步事务。
- 每个业务状态变化与对应 WorldEvent 同事务写。工具/文件的外部副作用仍遵循现有恢复机制，不声称整个世界拥有跨文件原子事务。

### 2.3 事实与叙事

WorldEvent 最小字段：

    event_id, event_type, subject_type, subject_id,
    qianji_id nullable, binding_id nullable, pixel_id nullable,
    round_num nullable, source_key UNIQUE, payload_json, created_at

- payload 只含该事件需要的结构化事实和证据 ID，不复制 raw_response、私有文件、完整 Prompt 或客户原话。
- source_key 固定由动作/来源 ID 派生，例如 qianji:<id>:created、narrative:<id>:<revision>；重放不重复事件。
- 不存强制故事标题。前端默认用中性中文标签；用户可提供 eventType → label 的纯文本映射。
- Stage 1 把组织标题、栏目标签、事件标签放在 `workspace/runtime/world_presentation.json`，通过 GET/PUT /api/world/presentation 整体读写并严格校验。
- 此配置只有 plain text labels；不接受 HTML、JS、模板表达式、数据库字段路径或可执行内容。默认“天机阁”只是显示文字。
- 没有 Muse 文案时直接展示事实，不能让模型代写事实源。

事件类型按阶段扩展，不使用自由输入的事件名：

- Stage 1：QIANJI_PROFILE_CREATED、QIANJI_NARRATIVE_UPDATED、QIANJI_BOUND、QIANJI_UNBOUND、QIANJI_RETIRED。
- Stage 2：RECRUITMENT_POSTED、TRIAL_STARTED、TRIAL_AWAITING_SELECTION、TRIAL_COMPLETED、TRIAL_CANCELLED、QIANJI_RECRUITED、MISSION_ISSUED、MISSION_STARTED、MISSION_AWAITING_ACCEPTANCE、MISSION_COMPLETED、MISSION_FAILED、MISSION_CANCELLED。
- Stage 3：PRODUCT_CREATED、PRODUCT_STATUS_CHANGED、EXTERNAL_FEEDBACK_RECEIVED、DELIVERY_STATUS_CHANGED、REVENUE_RECEIVED、REFUND_RECORDED。

同一人物已退役时不重复发退休事件；关闭binding仍记录QIANJI_UNBOUND。查询人物事件时，除直接qianji_id外，还通过Mission参与表、Trial候选表及收入贡献关系查关联对象事件，再按event_id去重。

## 3. Stage 1：身份、人物卡、真实对话、Engine 入口

完成形态：默认打开天机阁大厅；已有 Pixel 有独立人物身份；可以导入人设和静态图、查看经历、向人物发消息并看到真实运行回复；Engine 完整保留。

### S1-01 类型、表和最小 Repository

**先读**：protocol/src/index.ts、types/pixel.ts、types/model.ts、types/message.ts；persistence/src/core_store.ts、sqlite/db.ts、migrations/init_schema.ts。

**新增文件**：

- `packages/protocol/src/types/qianji.ts`
- `packages/protocol/src/types/world_event.ts`
- `packages/persistence/src/repositories/qianji_repository.ts`
- `packages/persistence/src/repositories/world_event_repository.ts`
- `packages/persistence/src/repositories/owner_action_repository.ts`

**固定数据契约**：

    QianjiProfile:
      qianjiId, careerStatus(candidate|trial|active|retired),
      narrative, narrativeRevision(integer), createdAt,
      retiredAt?, retiredReason?

    QianjiNarrativeSpec:
      displayName, title?, roleLabel?,
      traits: Record<string, number>,
      behaviorProfile: string[], flaw?,
      shortBio?, appearanceSpec?, portraitAsset?,
      contentRevision?  // Muse 标签，不用于并发控制

    QianjiBinding:
      bindingId, qianjiId, pixelId, incarnation,
      boundAt, unboundAt?, birthEffectId?, archiveRelativePath?

表：qianji_profiles、qianji_bindings、qianji_narrative_revisions、world_events、owner_action_requests。

- Profile 存当前 narrative_json 和整数 revision；revisions 以 (qianji_id, revision) 唯一，保存内容历史。一次内容更新同时写二者和 Event。
- binding 用 unbound_at IS NULL 表示当前绑定，不再维护第二个 is_current 真值。
- 建立两个部分唯一索引：当前 qianji_id 唯一、当前 pixel_id 唯一；另加 (pixel_id, incarnation) 唯一。历史绑定不可改归属。
- incarnation 是同一 Pixel 坐标的载体代次，不是人物改名次数，也不是 Pixel generation。
- 无内容时只用“未命名千机 <短ID>”；traits={}、behaviorProfile=[]、其他可选字段为空。
- 先不暴露任意“换身体”接口；本三阶段支持身份永久保存、重生解绑及新人物建立，不做心智迁移/人物复活。
- 在 CoreStore 和 packages 出口注册 Repository，沿用现有同步事务与迁移入口。
- 迁移以 schema_meta 标记；旧表新增字段必须 nullable，旧数据不凭空补人物关系。

**测试**：新建/重开 DB、重复运行迁移、双重绑定被 DB 拒绝、改名 ID 不变、同版本并发更新只有一次成功、事件重试不重复。

**完成条件**：以上测试通过；仅建结构，不自动修改用户现有 Pixel 文件或授名。

### S1-02 身份迁移与 Pixel 重生衔接

**先读**：WorldService.getWorldDto、PixelRepository、EffectRuntime.applyReproduce、v11_historical_economy.test.ts。

**新增**：`apps/server/src/services/qianji_service.ts` 与 `scripts/migrate-qianji.ts`。

迁移命令契约：

    .\node_modules\.bin\tsx.cmd scripts/migrate-qianji.ts --workspace <绝对测试workspace> --dry-run
    .\node_modules\.bin\tsx.cmd scripts/migrate-qianji.ts --workspace <绝对测试workspace> --apply

1. 脚本默认 dry-run；不导入 server/main.ts，不加载 .env，不调用模型。
2. dry-run 必须只读打开 DB，不实例化会自动执行 initSchema 的 CoreStore；列出账户、当前载体代次、已有绑定和冲突。
3. 正式 apply 只在服务已停止、无 RUNNING Run 和未决调用/预留时执行。对真实 workspace 的首次 apply 需要用户安排停服与批准；先完成测试副本演练。
4. 为目前每个有账户和当前 Pixel 目录的载体创建身份。迁移身份 careerStatus=active 是“接纳现有成员”的迁移规则，不由 energy/active 推导；物理失活另显示。
5. incarnation 优先读取有效正整数 state.incarnation；老数据缺字段才使用 1。字段非法、账户/目录孤立、已有绑定不一致时列明冲突并不执行整批迁移。
6. 不把 live/history 内旧载体全部归给新角色；不改 pixel.md、tips.md、mandate.md、artifacts，也不改既有 Ledger/ModelCall 数值。
7. 同一 (pixelId, incarnation) 重跑必须复用已有绑定，零新增人物、零新增事件。
8. 已绑定载体重生时，在现有重生 DB 事务内：关闭旧 binding、记录实际 archiveRelativePath、把旧人物退役并记录原因 body_replaced、创建新 candidate 身份和新 binding。新生人格为空，不继承旧人设。
9. 对没有人物绑定的旧 Pixel，原 Engine 重生仍可执行；新载体创建中性 candidate 绑定。Stage 1 不新增“候选人禁止普通运行”规则，该组织准入门在 Stage 2 落地。
10. generation 继续沿用现有亲代规则。已绑定载体的 incarnation 从当前绑定校验并递增，再投影到 state.json；两者矛盾时拒绝重生，不能默默选一个。
11. 保留现有文件归档/失败回滚及 TARGET_NOT_RESETTABLE 条件；身份写入失败也应回滚同次账户和文件变化。重放既有成功 Effect 不重复建人。
12. 旧版已经成功的重生不倒推“前世人物”；无法确定的历史保持未归属。

**测试**：重复迁移、已有 incarnation=3、同坐标第4代重生、归档文件仍可读、身份事务失败后旧文件恢复、未决目标拒绝重生。

**完成条件**：测试副本迁移前后心智/交付物哈希、旧账本条数和金额不变；新增身份及事件数与 dry-run 一致。真实迁移尚未授权时注明“待操作”，不虚报完成。

### S1-03 人设、静态图片和展示配置 API

**新增**：qianji_routes.ts、`frontend/src/api/qianji.ts`；纯校验放 `packages/domain/src/qianji/validation.ts`。

接口采用本节固定路径：

| API | 行为 |
|---|---|
| GET /api/qianji | 列表；可按 careerStatus 过滤 |
| GET /api/qianji/:id | 人设、当前/历史 binding、物理状态；未绑定不伪造能量 |
| PUT /api/qianji/:id/narrative | {expectedRevision, narrative}，整份替换；版本冲突 409 |
| POST /api/qianji/:id/portrait | {mimeType, dataBase64, expectedRevision} 上传一张静态图 |
| GET /api/qianji/:id/portrait | 当前图片；未配置返回 404 |
| GET/PUT /api/world/presentation | 中性显示标签配置 |
| GET /api/world/events | 分页事实事件，可过滤 qianjiId |

统一导入示例；这是格式样例，不是正式人物：

~~~json
{
  "expectedRevision": 0,
  "narrative": {
    "displayName": "未命名角色",
    "title": null,
    "roleLabel": null,
    "traits": {},
    "behaviorProfile": [],
    "flaw": null,
    "shortBio": null,
    "appearanceSpec": null,
    "portraitAsset": null,
    "contentRevision": "muse-v1"
  }
}
~~~

- displayName 1–80 码点；title/roleLabel 各 ≤80；flaw ≤500；shortBio/appearanceSpec 各 ≤2000。
- traits 最多16项，键长1–32，仅有限数值0..1；behaviorProfile 最多12条，每条≤300码点；contentRevision≤100。
- 拒绝未知字段、NaN、Infinity、错误类型；输出字段错误位置，不静默裁剪输入。
- narrativeRevision 由系统递增，contentRevision 只是外部标签。Owner 可改 retired 人物的展示内容，历史运行仍引用旧 revision。
- 人设更新在 Run 执行时返回409；已发起但待执行消息在首次调用时冻结实际使用 revision。
- 图片固定存到 workspace/assets/qianji/<id>/<hash>.<ext>；只允许 PNG/JPEG/WebP，解码后≤2MiB，核对文件头与 MIME。请求 bodyLimit 为3MiB。
- portraitAsset 是服务签发的本角色资产 ID，不是 URL/绝对路径。JSON 可引用已上传且归属本角色的资产，不能借 JSON 读磁盘任意图片。
- 上传先写受控新文件，再 CAS 更新人设 revision；DB 失败仅清理本次新文件。不覆写已被历史版本引用的图片。
- UI 缺图显示中性占位；不自动生成美术。使用同源图片路由，不挂整个 workspace 静态目录。
- 纯文本展示，不使用 dangerouslySetInnerHTML。

**测试**：越权路径、伪造 MIME、超限、错误 JSON、旧 revision、Run 中编辑、替图不改 ID/历史 revision、缺图占位。

### S1-04 Prompt 与历史归属

**修改入口**：PromptBuilder、AgentStepRunner、ModelCallRepository、MessageRepository、LedgerRepository、CoreStore.settleAndStoreModelResponse，以及协议 types/model.ts、types/message.ts。

1. PromptInputs 增加可选 identity；更新严格 allowlist，不放开任意 Record 输入。
2. identity 只包含自身 qianjiId、bindingId、narrativeRevision、显示名/称号/职位/traits/行为原则/缺陷、careerStatus。不注入其他人物档案、全局世界或 Owner 文件。
3. IDENTITY 放在 user content 的 EXTERNAL 之前；CONSTITUTION 仍在 system。明确“设定不是权限；规则与工具授权优先”。
4. 无绑定时省略 IDENTITY 层，保留原五层输入的来源语义；UI 显示“未绑定 Pixel”。非法绑定不能伪装成未绑定。协议模板变化可能改变promptHash，必须用固定输入核对黄金样本差异，不以删断言换通过。
5. 同步 `resources/prompts/v9_system_prompt.md` 的层级说明；不改模型名称、温度或工具全局授权。
6. 新 messages 增 sender_binding_id、recipient_binding_id（nullable）；入队冻结归属。原消息内容字段不变。
7. 新 model_calls 与 reservations 均增 binding_id、narrative_revision；在 reserve事务中持久化首次调用快照，成功/未知结果/无效响应都使用它。重放和人工结算不查当前人设覆盖旧快照。
8. ledger_entries 增 binding_id；费用、奖励、能量转移两端、重生两端按动作发生时角色归属写入。工具履历通过 model_call_id/message_id 的快照关联。
9. 旧消息首次领取时可记录当时 recipient binding；旧已完成消息/调用/账本保持 null。不得把迁移前全部消费回填到当前人物。
10. 人物历史 GET /api/qianji/:id/history：分别返回“身份建立后的归属记录”与“载体旧记录（未归属）”。后者只作旁列参考，不能加进人物累计值。
11. 交付物区分当前 binding 与归档 binding；归档文件通过服务保存的受控相对路径解析，禁止从用户参数拼历史目录。当前目录文件列表不能算“生涯累计产物总量”。
12. 所有模型与工具成本保持 null 语义。未知成本显示“未知/已知小计”，不转换成0。

**测试**：只注入自身身份、无绑定仍兼容五层输入、同输入与模板产生稳定hash、身份不能改工具权限、改名后旧调用 revision 不变、重生前后两人统计分离、旧记录不自动归属、成本 null 保留。

### S1-05 人物聊天的完整往返

**关键限制**：复用 AgentStepRunner，不复用 OwnerChatService 的全局上下文；不改六邻居路由去支持 human。

**新增**：`qianji_chat_repository.ts`，以及协议 owner_reply / OWNER_REPLY Effect。

表 qianji_chat_turns：

    turn_id PRIMARY KEY, qianji_id, binding_id,
    message_id UNIQUE, request_key UNIQUE,
    question, reply nullable, reply_call_id nullable,
    created_at, replied_at nullable

执行流程：

1. POST /api/qianji/:id/chat 接收 {content, idempotencyKey}；content=1..2000 Unicode码点。
2. 校验当前绑定、载体 active、无退款赤字、人物非 retired。Stage 2 起还需 active 且无 Mission/Trial 占用。
3. 同事务建 turn + enqueue human 消息；sender=human，recipient=绑定 Pixel，roundNum=worldRound+1，记录 recipient binding。返回202和 turn/message ID。
4. 仅排队，不自动调用模型、不自动启动世界。UI 明确显示“待运行”；用户使用可见的现有 RunControls 选择轮数和预算启动。
5. 在该消息 Prompt 中要求 `owner_reply` 为公开给 Owner 的回复，最多2000码点；可同时产生原有决策。不要展示 raw_thought。
6. AgentDecision 增可选 owner_reply，Parser 校验其字符串和长度；旧模型输出未包含它仍兼容。
7. Compiler 在既有 Effect 顺序末尾追加 OWNER_REPLY，不改变既有 Effect 的 index/ID。绑定 turn/message/binding 必须由服务端上下文确定，不能信任模型传 ID。
8. EffectRuntime 对属于合法 chat turn 的回复，在事务中更新 reply 并记录 Effect；重放只写一次。非聊天消息输出 owner_reply 应记录拒绝/反馈，不创建虚假对话。
9. 原来“结算后载体失活则不执行副作用”的规则保留；这种情况显示“已计费，未产生回复”，不能再次自动调用补回复。
10. GET /api/qianji/:id/chat 分页读取该人物 turns，并从消息/调用推导 queued、processing、replied、no_reply、blocked、failed。只有消息 COMMITTED 且有 reply 才显示完整回复。
11. 模型缺 owner_reply 显示“本次没有直接回复”，可查看 tips/产物；不把邻居 message_md 或 tips 冒充回答。
12. 未决结算、失败、停止显示真实状态，保留输入，沿用既有 Recovery。HTTP 超时重试用原 idempotencyKey，不重复入队。
13. 首版不把 UI 全部聊天历史回灌模型；持续记忆仍由该 Pixel 的 pixel.md 承载。界面历史是可见审计，不新增隐式全局记忆。

**测试**：重复发送一条消息、一条真实模拟回复落库、Effect重放不重复、刷新后历史可见、错误归属拒绝、缺回复、结算未知、能量耗尽、非邻居路由原测试仍通过。

### S1-06 大厅与卡牌，保留现有 Engine

**修改/新增**：

- 从 App.tsx 抽出 `frontend/src/features/engine/EngineView.tsx`；现有控制/弹窗回调按需要传 props，勿复制两套状态。
- 新增 hall/TianJiHall.tsx；qianji/QianjiCard.tsx、QianjiProfilePanel.tsx、QianjiChatPanel.tsx、QianjiNarrativeEditor.tsx。
- 新增 `frontend/src/hooks/useQianjiPolling.ts` 与 qianji API DTO；保留 useWorldPolling 的既有数据契约。
- 样式增量写入现有 index.css 的新作用域，避免改坏 Engine 样式。

首页结构固定为：

    顶部：组织名 | 当前轮次 | 运行/停止/未决状态 | Engine入口
    主区：人物卡牌列表（静态图、名字、称号、职位、职业/物理状态）
    侧区：最近事实事件；简洁的能量与成本摘要
    点击卡牌：人物详情 → 对话 / 经历 / 交付物 / 人设与图片
    Engine：原地图、RunControls、Console、Recovery、工具/资料/Prompt入口

- 两层用 App 内 view 状态切换；暂不引入路由库/状态库/新 UI 框架。
- 前景以人物静态图为核心；沿用现有深色基础色与字体，布局体现组织大厅。Muse 背景/场景图未提供时保留背景插槽和中性样式，不擅自画世界观。
- 人物职业状态和 Pixel active 分开显示，例如“正式成员 / 能量不足”。能量不叫现金资产。
- Stage 1 无 Mission/Trial 功能时不做可点击假入口或虚构进度；现有 mandate 以“阁主令（手工）”读取。
- World数据、人物列表共享选中 ID 的明确映射；切回 Engine 可定位 boundPixelId；无绑定/退役人物禁用运行操作。
- 数据失败显示错误，不用空列表假装成功；轮询卸载/切页要清理，沿用现有刷新节奏。
- 大厅需要直接可达的 RunControls 或等效复用入口，让“待运行对话”能在世界视图启动；停止和未决恢复提示始终可见。
- 桌面1440×900与窄屏390px检查：卡片不溢出、弹窗可滚动、长名字换行、键盘可操作。

**前端测试**：大厅默认页、卡片选择与真实 qianjiId、内容导入错误保留草稿、聊天待运行/回复/失败、未知成本、缺图、Engine入口及Recovery未丢失。

### S1-07 阶段验收与停止

技术验收：

- [x] 身份与绑定持久化；迁移可重复；重生不覆盖旧人历史。
- [x] JSON/图片导入无需改代码；人设改名不改 ID。
- [x] Prompt 使用自身身份，认知/工具边界仍成立。
- [x] 使用测试 Provider 完成“卡牌 → 人物发消息 → Run → owner_reply → 刷新历史”。
- [x] 默认大厅，Engine现有操作保留，用户 HeartbeatLightning 改动未覆盖。
- [ ] 第7节列出的相关检查通过；记录未通过项，不能只看后端 build。

用户内容验收（与技术验收分开）：

- [ ] 用户/Muse 提供至少两套正式人设和两张静态图，验证替换后布局。
- [ ] 用户确认大厅、人物卡和交流方式符合创意方向。
- [ ] 若授权真实模型：以明确预算做一次人物对话，核对费用与回复。
- [ ] 若授权真实迁移：停服备份后完成，并记录报告。

技术完成但正式素材/真实操作未完成时，报告“Stage 1 技术完成，内容/操作验收待完成”，然后停止。不要进入 Stage 2。

本次执行状态以 8.4 为准：Stage 1 实现已完成，但一项既有自动测试未通过，故技术验收尚未全绿；按停止规则留在 Stage 1。

## 4. Stage 2：招聘、串行试炼、Mission 和可核查履历

前置：Stage 1 已获用户验收，用户明确要求进入本阶段。
本阶段新增执行隔离，但仍只有一个 RoundScheduler、一个 AgentStepRunner、一个活动 Run。

### S2-01 组织类型、状态机和表

**新增类型**：protocol/src/types/mission.ts、trial.ts、execution.ts。
**新增纯规则**：domain/src/mission/rules.ts、trial/rules.ts、qianji/lifecycle.ts。
**新增 Repository**：mission_repository.ts、trial_repository.ts、execution_repository.ts。

数据固定为：

| 表 | 最小字段 |
|---|---|
| recruitments | recruitment_id, role_label, jd, status(open/closed), created_at |
| trials | trial_id, recruitment_id, challenge_text, acceptance_criteria, total_budget_tokens, rounds_per_candidate, candidate_budget_tokens, allowed_tools_json, model_name, status, winner_qianji_id?, decision_reason?, created_at |
| trial_candidates | candidate_id, trial_id, qianji_id, binding_id, execution_id, ordinal, evidence_json?, selected |
| missions | mission_id, title, mission_type(开放字符串), objective, acceptance_criteria, budget_tokens, rounds_limit, deadline_round?, status, owner_qianji_id, acceptance_note?, created_at, completed_at? |
| mission_participants | mission_id, qianji_id, binding_id, duty?；组合唯一，duty由Owner填写 |
| executions | execution_id, kind(mission/trial_candidate), subject_id, budget_tokens, spent_tokens, reserved_tokens, rounds_limit, rounds_used, status, input_snapshot_json, tools_snapshot_json, created_at |
| execution_participants | execution_id, binding_id, released_at nullable；组合唯一；binding_id在released_at IS NULL时部分唯一 |
| execution_evidence | evidence_id, execution_id, binding_id, operation_id?, relative_path?, sha256?, size_bytes?, evidence_type, created_at |

状态转换：

- Mission：draft → issued → running → awaiting_acceptance → completed / failed；draft/issued/running/awaiting_acceptance 可 cancelled。
- Trial：draft → running → awaiting_selection → completed；draft/running/awaiting_selection 可 cancelled；基础设施阻塞用 execution 状态表达，不冒充候选落选。
- Execution：ready → running → awaiting_review / blocked；blocked 可在未决已处理且用户显式恢复后回 running；终止为 closed。
- Qianji：candidate → trial → active 或 retired；active → retired。Trial取消可把仍未裁决者退回 candidate。retired 本版无恢复入口。
- 迁移来的 active 是历史接纳例外，不要求补跑虚假面试。
- 同一 binding 不得同时参与两个未关闭 execution。发布后的目标、题目、参与者、预算和工具快照冻结；要更改先取消并建新任务。
- Mission预算与rounds_limit均为Owner输入的正安全整数；issue复制到execution。execution关闭时同事务设置参与行released_at，未决费用未解决前不释放。
- deadlineRound 用绝对世界轮次。到期只停止新调用、进入待验收并记录 deadline_reached，不自动宣告成功。
- Mission complete 只能由 Owner 提交验收说明和证据 ID；模型说“完成了”只作为产物。

**测试**：非法转换、重复参与、非候选参加试炼、退役参与、重复裁决、改变已发布输入、过期不再发起新调用。

### S2-02 在现有调度链增加执行范围

**必须覆盖文件**：run_service.ts、round_scheduler.ts、message_repository.ts、agent_step_runner.ts、effect_runtime.ts、feedback_factory.ts、tools/context.ts、tools/runtime.ts、builtin/artifacts.ts。

1. runs、messages、reservations、model_calls 加 nullable execution_id。execution_id=null 表示普通世界运行，兼容旧记录。
2. RunService.start 接受服务端解析的 executionId；前端不得任意提交参与者或工具快照。世界 / Mission / Trial Run 共用现有 DB 互斥。新增仅供内部调用的同步 onRunCreated(runId) 回调，在既有创建Run事务内写业务状态和起始消息；回调失败整笔回滚，提交后才设置内存running并启动runLoop。HTTP请求不能传入回调。
3. claimNext、countPendingMessages、hasProcessableMessages、预算等待恢复全部带执行范围；世界只领 null，任务只领自身 ID。SQL括号要保证所有 OR 分支均受范围约束。
4. beginRound 自然唤醒只作用于本次范围的合格成员。candidate/trial/retired 不参与普通世界运行；未绑定旧 Pixel 暂保留兼容，但不能作为任务成员。
5. 有活动 execution 的成员不被普通 Run 唤醒或领取。其普通排队消息留原队列，不转移归属，也不误标 COMMITTED。
6. 任务内自产 SELF、环境读取响应、工具反馈、六邻居消息和预算等待消息继承 execution_id；去重键加入 execution_id 和 binding 归属。
7. Mission 邻居通信仍需“六邻居且同 execution”。创建时验证参与者构成六邻居连通集合；不自动经过未参与者中转。
8. Trial 每个 execution 只有本候选，禁止向其他 Pixel 发消息、能量转移、繁殖、transfer_artifact；SELF/STOP与本候选私有产物正常使用。
9. Mission 也禁止任务中繁殖，避免新成员预算/归属不明确；能量转移和交付物转移只允许同 execution 内合法邻居。
10. 工具有效权限 = 注册表 enabled AND execution工具快照。Prompt目录与实际执行都按交集过滤；不修改全局 tools.json、不向全局 registry临时注册/禁用工具。
11. ToolContext 显式携带只读 execution 范围/允许收件者；transfer_artifact 在 handler 内复核，不能只在 UI 检查。
12. 对任务 scope 不允许读取全局 workspace/private 内容；需要的考题/材料放本 execution 的受控输入快照和自身文件。
13. 若 messages.recipient_binding_id 与当前绑定不匹配，记录 ABANDONED/归属失效原因，不向新人投递旧消息。
14. Run结束把 execution置awaiting_review；未决调用则blocked。进程重启不自动重新发起模型，先走现有Recovery再由用户恢复。
15. 恢复同 execution 可创建新 Run，但预算累计不重置，输入/工具快照不变；Run终止与任务业务完成相互独立。executions.rounds_used在每次实际开始范围轮次时持久化递增；runs加last_scope_round，以(runId, round)防止重复计次。中断的已开始轮次也占一个额度，界面明确此口径；世界round仍按原规则只在成功完成后推进。
16. 本节改变现有调度资格/任务内动作规则，必须同步 runtime_invariants.md、security_boundary.md；不顺手修其它无关文档。

**测试**：世界/候选A/候选B各有队列时只能消费选中范围；其他队列内容和状态不变；自然唤醒不越界；SELF去重不串任务；工具反馈不丢 scope；工具越界调用 handler前被拒绝；重启恢复不重复模型费用。

### S2-03 预算必须进入 reserve / settle / refund

**修改**：BudgetRepository、CoreStore结算及resolveRecoveryOperation、AgentStepRunner、对应协议状态。

- scoped调用在同一个 reserve事务检查 Pixel余额、Run剩余、execution剩余；Trial还检查所属trial全部execution的 spent+reserved 汇总。
- 创建 Trial 时候选人数2–3、各候选预算相同，N×candidateBudget ≤ totalBudget，均为正安全整数。轮数、模型、工具快照相同。
- global_budget继续只累计，不新增累计硬门槛。
- scoped请求的预留量 = 当前Prompt估计输入 + 请求输出上限。将输出上限裁到各层剩余预算允许值；余量不足时不发请求。
- PromptBuilder 可能由 MCL_MAX_TOKENS/模型名提高上限，必须在最终 PreparedModelRequest生成后再施加执行预算上限，且Provider不得再次放大。
- 不假称本地输入估算等于供应商精确分词。若实际usage超过预留，真实记账并设置预算超支阻塞，禁止下一调用；不得截断usage来做“预算内”假账。
- 预算门槛是模型Token额度；工具CNY成本单独记录，不谎称此额度限制所有外部支出。试炼默认不启用付费或远端写工具。
- settle/refund/人工确认未计费/人工结算都同时维护execution统计；未知usage保留OPEN与reserved。
- 给 MessageStatus 增 WAITING_EXECUTION_BUDGET；普通Run的resetWaitingRunBudgetMessages不得清掉它。
- BudgetExceededError增加EXECUTION种类；达到范围预算时关闭本次Run并让execution待审阅，不自动补预算或重试。
- 对失败、付费非法响应重试和中断仍计真实消耗；恢复同execution不得重置spent。
- 人工补确认的已知usage需刷新关联统计；保留“实际usage”和“按预留结算”的区别。

**测试**：两候选共享总预算、reserve回滚不半记账、输出上限不会被环境配置冲掉、未知usage不释放预算、所有Recovery决策同步额度、异常后重试不重置、超支如实记录并阻止后续调用。

### S2-04 Mission 服务与阁主令输入

**新增**：server/services/mission_service.ts、routes/organization_routes.ts。

API：

    GET/POST /api/missions
    GET /api/missions/:id
    PUT /api/missions/:id                 仅draft
    POST /api/missions/:id/issue
    POST /api/missions/:id/start
    POST /api/missions/:id/resume
    POST /api/missions/:id/accept         {outcome: completed|failed, note, evidenceIds, idempotencyKey}
    POST /api/missions/:id/cancel

- issue校验负责人在参与者中、所有人物active/当前binding有效、拓扑连通、无占用；冻结输入并建立execution。
- start在同一DB事务内创建Run、更新状态、生成每位参与者一次human起始消息；Run创建失败时不遗留半启动Mission。事务提交后启动原runLoop。
- scoped的humanMandate由Mission快照实时渲染：目标、验收、预算/轮次、本人职责。不是从任意可改文件读回。
- 手工mandate.md原样保存；任务范围内不混入它。GET /api/qianji/:id/effective-mandate明确返回 source=manual|mission|trial、内容及关联ID。
- 占用期间原PUT/DELETE mandate接口返回409；取消/完成后恢复使用原文件，不需要复制/恢复文件内容。
- start/resume接收本次rounds（正安全整数），不得越过deadline或execution剩余轮次；恢复也累计已开始轮次，不能通过新Run绕过期限。职责为空时仅展示共同目标，不自动替参与者分配故事职位。
- 产物证据登记成功工具结果中的operationId/filename/hash/size，并保存在workspace/evidence/<executionId>/的只读快照，防止原文件被覆盖后验收对象变化。
- 只从已成功save_artifact等已知回执登记，核对当前文件hash；不符则明确证据采集失败，不接受模型伪造路径。
- 文件快照失败不得把Mission标成功；成功副作用不重新执行，允许显式重做“证据收集”这一步。
- awaiting_acceptance只说明运行已结束。Owner验收后写完成/失败事件并关闭execution/释放成员。
- cancel必须先requestStop并等待Run真正终止；若有未决则保持占用，完成Recovery后才关闭。未消费范围消息逐条标ABANDONED并保留原因，不并入普通队列。

**测试**：DB启动失败无半状态、手工mandate字节不变、运行结束不自动完成、人工验收证据不存在/被替换拒绝、取消中未决不释放、resume延续预算与期限。

### S2-05 招贤榜与候选人落地

**新增**：server/services/trial_service.ts；复用QianjiService，不做角色生成模型。

API：

    GET/POST /api/recruitments
    GET/POST /api/trials
    GET /api/trials/:id
    POST /api/trials/:id/candidates

- candidates请求包含正式/测试narrative、Owner选择的三维整数坐标、initialEnergyTokens、idempotencyKey。
- 首版只允许从未存在过账户、Pixel目录、artifacts目录、binding历史的空坐标创建候选；冲突409。坐标用严格三整数校验，不仅依赖parseInt。
- 默认不给用户的既有Pixel清空记忆；不拿老成员冒充公平的空白候选。
- 候选初始化空pixel.md/tips.md/mandate.md、自身state.json；创建candidate人设和binding。
- 初始能量通过CoreStore.applyExternalReward记账，source=trial_seed；明确这是Owner注入的Token，非现金收入。创建账户/身份/奖励在同一DB事务内。
- 先在任务临时目录准备文件，再受控安装到未占用路径；事务/安装失败仅撤回本次新建路径。崩溃残留必须检测并阻止重试覆盖，不以catch吞错重建。
- 第一次创建候选与所有重试共用幂等key，不重复注入能量。
- 候选人数限2–3，初始能量相同且至少为candidateBudget；无独立“随机抽卡人设”功能。
- candidate能量非零不代表可普通运行，S2-02按careerStatus阻止其自然唤醒。
- 招贤榜描述/考题由Muse/用户填写；空内容报错，不自动编题。

**测试**：占用坐标拒绝、不覆盖旧目录、2–3候选初始化一致、重复创建不加钱、文件安装失败回滚、重启发现残留时明确阻塞。

### S2-06 串行试炼与 Owner 裁决

API：

    POST /api/trials/:id/start
    POST /api/trials/:id/resume
    POST /api/trials/:id/select
    POST /api/trials/:id/cancel

1. start冻结challenge/criteria/model/tools/预算/rounds，候选status转trial，按ordinal依次执行各自execution。
2. 使用同一个RunService，一个候选Run完全终止且没有未决后再启动下一个；单独排队编排，不循环新建其它Runtime。
3. 每候选一个真实scope；共用相同题目和验收标准，自身identity不同。Prompt不包含对手心智、产物或运行记录。
4. 默认allowedTools为save_artifact、read_artifact、list_artifacts；若用户显式选中，可增加已全局启用的webfetch、github_repo。不允许VPS、private-files、transfer_artifact进入Trial。
5. 工具权限/模型配置/题目快照期间不得漂移；若实际环境与快照不一致则暂停，提示重开Trial，不偷偷降低一位候选权限。
6. 顺序不同与公开网页随时间变化可能影响结果；界面说明“同规则串行试炼”，不宣称严格可重复科学基准。
7. 中断或未知结果：整个Trial暂停等待Recovery，禁止自动换候选掩盖费用；恢复从持久化状态开始，不重跑已完成候选。
8. 全候选完成后awaiting_selection；展示每人的证据、实际Token、已知/未知CNY成本、错误和未完成项。
9. select接受winnerQianjiId（允许null表示不录用）、reason、evidenceIds、idempotencyKey；只允许在无活动Run/未决时裁决一次。
10. 胜者active；其余retired，写退场原因和事件，关闭execution。取消试炼不等于落选，可退回candidate但仍不能普通运行。
11. 本阶段不让LLM自动打分、自动裁决，也不让便宜等同于优秀。
12. 新录用者保留真实试炼记忆/文件及原Pixel能量，不复制一个“获胜替身”。

**测试**：候选不并发、相同规则hash、A读取B失败、A失败被记录、未知费用暂停后续、重启不重跑A、重复select不改变录用/重复事件、null胜者全退役。

### S2-07 履历、档案与组织界面

**新增前端**：

- recruitment/RecruitmentBoard.tsx
- trial/TrialArena.tsx
- mission/MissionBoard.tsx、MissionDetail.tsx
- archive/ArchiveHall.tsx
- qianji/QianjiHistory.tsx

实现范围：

- 招贤榜包含JD、考题、统一预算和候选卡；不是仅一个后台表格。
- TrialArena独立页面：上方统一规则，中间2–3张候选卡，下方各自运行/费用/产物对照与Owner裁决。
- MissionBoard明确draft/issued/running/awaiting_acceptance/终态，不能用Run COMPLETED代替任务验收。
- ArchiveHall可查退役原因、旧人设revision、旧binding、归档交付物和真实消费。普通操作无删除人物入口。
- 人物生涯统计只聚合冻结归属：调用数、实际Token、完整/已知成本、任务通过/失败数、试炼次数、工具记录和证据。
- 能力画像首版用“按missionType分类的已验收任务数+证据列表”；维度为用户输入的标签，不固化五种职业/技能，不生成0–100分。
- 成功率=completed/(completed+failed)，分母0时null；cancelled和待验收不进分母。
- active人物退休先检查无活动Run/未决、无进行中任务；本版必须先结束/取消任务才退休。退休后即使reward使Pixel active，也不得普通调度。
- 增 POST /api/qianji/:id/retire，要求reason/idempotencyKey；不删除账户和文件、不燃烧剩余Token。

**测试**：候选状态、裁决表单、待验收与完成区分、退役不能再聊天/接任务、奖励不能绕过职业准入、未归属历史不混入生涯。

### S2-08 阶段验收与停止

- [x] 创建招贤榜与2–3位空白候选；同题同模型同工具同预算串行运行。
- [x] Runtime真实链路有scope隔离，预算经过reserve/settle/refund和Recovery。
- [x] 裁决录用一次，落选者可查档案。
- [x] 获胜者执行Mission，生成不可变证据快照，由Owner验收。
- [x] 旧Engine世界运行不消费任务队列，不越过职业准入。
- [x] 不触碰现有六邻居、私有artifact隔离、结果未知不自动退款等边界。
- [x] 完成模拟Provider全链测试及桌面界面验收（1280×720）。
- [ ] 用户/Muse提供正式题材后，若授权，在有限预算下跑一次真实试炼和Mission。

上述最后一项没有授权/素材时作为待验证项列出；Stage 2技术完成后停止。

## 5. Stage 3：产品、真实商业记账与 Muse 事实导出

前置：Stage 2验收并明确要求进入Stage 3。
产品对象只选Product，不同时建Venture。第一版CNY单币种、Owner人工录入，不接支付网关、不建CRM。

### S3-01 Product、反馈、交付的事实结构

**新增**：protocol/src/types/product.ts、business.ts；对应product_repository.ts、business_repository.ts；server/services/business_service.ts、routes/business_routes.ts。

数据：

    products:
      product_id, name, description, target_user, problem_statement,
      owner_qianji_id, status, created_from_mission_id?, created_at

    product_missions:
      product_id, mission_id UNIQUE

    customer_feedback:
      feedback_id, product_id, mission_id?, contact_alias?,
      source, private_feedback_text, public_summary?, occurred_at, created_at

    deliveries:
      delivery_id, product_id, mission_id, contact_alias?,
      evidence_ids_json, status(draft|delivered|accepted|rejected),
      delivered_at?, accepted_at?, acceptance_note?

- Product状态：idea → validation → building → live；非retired可paused；paused只恢复到保存的previousStatus；任意非retired可retired，必须填原因。
- 产品阶段变化由Owner操作；live表示Owner确认上线事实，不触发部署。
- 一个Product多个Mission，一个Mission最多归一个Product；已开始Mission后冻结关联，避免改变历史成本归属。
- 既有已开始/完成Mission仍无关联时，不默默追溯归产品；本版从新业务Mission开始关联。
- 交付必须引用已验收Mission的证据快照，不能只填“已交付”故事文本。
- 真实客户信息用别名；原文仅留本地业务详情，Narrative导出默认不包含。
- customer_feedback中的public_summary由Owner明确填写，空值就不导出内容。
- 产品退役不删除旧交付、退款、反馈或Mission。

API：

    GET/POST /api/products
    GET/PUT /api/products/:id
    POST /api/products/:id/transition
    POST /api/products/:id/missions       关联尚未开始的Mission
    GET/POST /api/feedback
    GET/POST /api/deliveries
    POST /api/deliveries/:id/transition

**测试**：错误关联、Mission重复归属、产品退役历史仍查、交付引用无效/未验收证据拒绝、公开摘要与私有原文分离。

### S3-02 收入与退款：复用表，补齐真正写入链

**先读**：init_schema.ts中的两张external表、CoreStore.applyExternalReward、WorldService的external_accounting。旧文档把reward称收入的说明必须同步修正。

现有external_revenues / external_refunds保留旧列，增量加列：

- revenue：amount_fen、currency、product_id、mission_id、primary_qianji_id、primary_binding_id、evidence_ref、record_source、idempotency_key。
- refund：refund_amount_fen、evidence_ref、idempotency_key。
- 新写记录用整数“分”作为权威金额，currency固定CNY；旧net_amount/refund_amount_cny同步投影为元以兼容。
- 新收款amount_tokens=0，新退款tokens_deducted=0、deficit_tokens=0；现金不自动增减Pixel能量。Token奖励仍走原reward入口。
- 新增revenue_contributions(external_tx_id, qianji_id, share_bps, evidence_ref)，以人物组合唯一；share_bps整数0..10000且每笔合计10000。
- 第一版默认负责人10000bps；Owner可在首次记账时分配给该Mission参与者，提交后冻结，角色改名不改变份额。
- 主归属Pixel/binding从Mission参与快照取得，不从当前绑定查；即使人物退役或同坐标重生也能正确记录迟到付款/退款。
- 旧行无可验证amount_fen/关系时保留legacy_unattributed，不猜来源、不计入新系统“已验证收入”。
- 提供显式旧行核对入口只在确有旧数据时实施；本版不自动给旧行补关联。金额无法精确换分则标待核对。
- evidence_ref是Owner提供的本地凭据索引或外部交易参考；声明“Owner确认已收款”。有字段不等于系统自动核验了银行流水。

API：

    POST /api/revenues
      {externalTxId, amountFen, productId, missionId,
       primaryQianjiId, contributions, evidenceRef, idempotencyKey}
    GET /api/revenues
    POST /api/revenues/:externalTxId/refunds
      {refundId, amountFen, reason, evidenceRef, idempotencyKey}

规则：

1. 金额为正安全整数，外部交易ID唯一；重复请求不重复记账，同交易ID不同金额409。
2. 同事务校验product/mission/参与人、记收款或退款、贡献关系和事实Event。
3. 退款支持多次部分退款；累计退款不能超过原收款；原收款行不被覆盖。两次并发退款也必须受同一事务约束。
4. 退款沿用原份额进行收入回冲，不查当前人物/产品状态。
5. 事实事件REVENUE_RECEIVED、REFUND_RECORDED；退役产品仍允许合法退款。
6. world新商业指标从DB读取。旧world_state.json的external_accounting作为旧字段兼容保留，不再写另一套商业真值；大厅明确使用新字段。
7. 不把免费试用、意向、Token奖励、内部转账或测试数据标成现金收入。
8. 测试数据只在隔离workspace；不向真实账本插入“首单样例”。

**测试**：重复/冲突交易、两次部分退款、超额退款、并发退款、退役后退款、份额100%约束、真实现金与Token余额互不影响、旧行不伪归属。

### S3-03 成本、净收入与归因口径

**新增查询服务**：business_service内的聚合函数即可，不新建分析引擎。

- Mission成本按execution_id聚合model_calls与tool_executions；同一个call/operation只计一次。
- Product成本为唯一关联Mission成本之和；Trial与未归属世界运行成本列作组织开销，不摊给产品。owner_chat_calls是独立老板助手开销，单列已知/未知成本，不归人物或产品；若显示组织总成本，必须把该项纳入，并在导出中注明范围。
- 人物成本按binding历史聚合；范围含世界/对话/任务，页面注明此口径。任务成本不能再加一次到人物总成本。
- 模型成本只取model_calls.cost_cny；工具取tool_executions.cost_cny，不把兼容tool_cost再相加。
- 完整成本null时，返回knownCostCny、unknownModelCount、unknownToolCount、totalCostCny=null。
- 净收入 = 收款 - 退款。参与贡献 = 原份额×净收入；以整数分分摊，余数按qianjiId稳定排序逐分分配，确保总和等于净收入。
- ROI = (净收入元 - 完整成本元) / 完整成本元；成本未知或≤0时null，不能显示Infinity或把收入/成本比冒充ROI。
- 人物展示“归因收入”，不重复给每位参与者整笔金额。故事贡献、合作次数不作为付款依据。
- 没有付款记录时，“已确认收入=0”可成立；这不意味着成本完整或商业已验证。
- 模型美元报价换算沿用UsageMeter现有逻辑，不另建汇率系统；本阶段不提供投资建议或财务审计结论。

**测试**：一调用多个工具不重复费用、未知成本ROI为null、退款后净收入减少、1分多成员分摊、未归属费用不偷偷摊入产品。

### S3-04 Narrative Export 和 Muse 内容回导

**新增**：server/services/narrative_export_service.ts；protocol/src/types/narrative.ts；narrative_artifacts表/Repository。

API：

    GET /api/narrative/export?from=<ISO>&to=<ISO>
    POST /api/narrative/artifacts
    GET /api/chronicle

导出格式版本固定为1：

~~~json
{
  "schemaVersion": 1,
  "generatedAt": "ISO timestamp",
  "period": { "from": "ISO timestamp", "to": "ISO timestamp" },
  "characters": [],
  "events": [],
  "missions": [],
  "trials": [],
  "products": [],
  "deliveries": [],
  "feedback": [],
  "artifactMetadata": [],
  "businessMetrics": {
    "confirmedRevenueFen": 0,
    "refundFen": 0,
    "knownCostCny": 0,
    "totalCostCny": null
  },
  "omittedCounts": {},
  "warnings": []
}
~~~

- 查询区间[from,to)，单次最多31天、2000条Event；超限返回400并要求缩小范围，不静默截断。
- 使用同一DB读事务拿一致快照；不把文件大内容混进DB事务。
- 本期指标只算区间内交易/调用；另外给出的累计值须以明确lifetime字段命名，禁止混口径。
- 每条事实带稳定来源ID、时间、人物/binding及当时narrativeRevision；可同时附当前显示名，但不改写旧设定。
- 只导出必要公共字段：目标/验收标准、状态、成本口径、事件白名单payload、Owner填写的public_summary。
- 默认不导出 .env、workspace/private、raw_response、完整Prompt、pixel.md、客户原文/联系方式、支付凭据、内部绝对路径、artifact正文。
- artifact只导出证据ID/hash/大小/类型及Owner指定的publicTitle；不默认导出可能含客户名的文件名。
- 每类被省略的数据返回omittedCounts/说明，不把未导出内容算作“没有发生”。
- 返回JSON文件供用户下载；Engine不自动调用Muse或任何发帖渠道。
- narrative_artifacts保存title、body、sourceEventIds、sourceMissionIds、contentRevision、createdAt。来源ID必须存在；正文是叙事层，不回写业务状态或数字。
- 回导重复内容按idempotencyKey处理；页面Facts/Narrative分开。文本按纯文本或禁用HTML的现有安全渲染路径显示。
- 用户/Muse是否准确解释事实仍需内容验收；系统只保证来源关联与事实数据，不声称自动证明故事正确。

**测试**：导出时间边界、一致性、收入退款口径、未知成本、秘密标记/客户原文不出现、不存在来源ID拒绝、叙事导入不改业务表、区间超限不偷偷截断。

### S3-05 产品阁、纪事与两级验收

**新增前端**：products/ProductGallery.tsx、ProductDetail.tsx；chronicle/Chronicle.tsx、NarrativeExportPanel.tsx。

- 产品页：需求、关联Mission、真实交付、反馈、已确认收款/退款、成本及未知项。
- 纪事页按时间/人物/任务/产品过滤；事实与Muse正文分区，能点击来源ID。
- 人物卡保留人物形象优先；详页再显示能力证据、产品参与和贡献，不把卡片堆成财务表格。
- 图片仍静态；不预先添加model_3d/voice_profile等未使用字段。
- 不新增支付按钮、自动发布按钮、客户抓取和营销任务。

技术验收：

- [x] 隔离临时workspace以测试Provider完成Product → Mission → 证据 → Owner验收 → 交付确认 → 反馈 → 测试收款 → 部分退款 → 事实导出。
- [x] 同一记录贯通Product/Mission/Qianji；归因收入及成本口径测试无重复。
- [x] Muse样例正文回导只改变叙事表。
- [x] 页面显示未知成本、试炼候选标记、收款来源与凭据索引；Engine可通过原导航进入。
- [x] 相关自动检查及桌面UI验收通过（1280×720）；窄屏人工视觉检查未做。

真实商业验证（由用户组织，不能让代码执行者无限追逐）：

- [ ] 一个真人需求、实际交付物、真人反馈。
- [ ] 至少一笔可验证的真实付款，记录证据及退款情况。
- [ ] 真实数据导出交给Muse，用户确认一篇基于事实的内容。
- [ ] 是否公开发布由用户另外决定；本文不授权自动发布。

没有真实付款时结论必须是“技术能力完成，商业闭环未验证”。不能以测试收款替代，也不能为完成Plan擅自拉客户或收费。

## 6. 迁移、恢复与真实 workspace 操作

1. 每阶段先在临时workspace和旧结构fixture上测试，不用真实数据作测试夹具。
2. schema迁移只增表/加nullable列/加索引；如唯一索引遇到旧重复数据，报告冲突，不删行凑通过。
3. 迁移重复运行必须无额外效果；用schema_meta保存已执行版本，禁止手工反复改“已完成”标记。
4. 正式迁移前停止服务，确认没有其他进程使用DB；备份整个workspace到明确的新目录。SQLite处于WAL模式，不能只复制正在使用的主sqlite文件。
5. 备份命令由执行者根据用户批准的绝对路径准备；不把任何备份放Git，不删除旧workspace。
6. 记录备份位置、版本、迁移前后账户/消息/调用/账本计数、关键文件hash与新增记录数。
7. 恢复演练先在测试副本进行。回滚代码不能回滚新增业务事实；恢复旧备份会丢失备份后的写入，真实恢复必须明确用户选择。
8. 迁移本身不创造历史收入、历史人物、已完成Mission或试炼成绩。
9. Run内发生未知结果时沿用现有Recovery；新业务不能用“取消/重新开始”清空未知费用。
10. 本次 Stage 1 执行没有对真实 workspace 执行上述操作；只使用隔离测试副本验证迁移。后续若实施真实操作，须注明授权、备份和前后计数。

## 7. 验证命令与执行顺序

使用 PowerShell 和仓库内 `.cmd` 二进制；不通过 `npx.cmd pnpm` 临时下载包管理器。本次实跑结果见 8.4。开始前记录状态与 HEAD，并只在确认生成文件于基线干净时恢复它们。

~~~powershell
Set-Location 'D:/00_personalwork/EmergentInc元胞会社'
git status --short
git rev-parse --short HEAD
node --version
.\node_modules\.bin\tsc.cmd --version
.\node_modules\.bin\vitest.cmd --version
~~~

开始S1-01前做一次基线检查并保存结果。依赖已在本地则不重复install，不升级包；缺依赖才依据锁文件安装。

按任务运行相关文件测试，例如：

~~~powershell
.\node_modules\.bin\vitest.cmd run packages/model/tests/model.test.ts
.\node_modules\.bin\vitest.cmd run packages/runtime/tests/v11_historical_economy.test.ts
.\node_modules\.bin\vitest.cmd run apps/server/tests/server.test.ts
~~~

阶段末完整检查顺序：

~~~powershell
.\node_modules\.bin\tsc.cmd -b --force
Push-Location frontend
.\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
$buildOut = Join-Path ([System.IO.Path]::GetTempPath()) ('emergentinc-vite-' + [guid]::NewGuid().ToString('N'))
.\node_modules\.bin\vite.cmd build --outDir $buildOut
Pop-Location
.\node_modules\.bin\vitest.cmd run --reporter=dot
git diff --check
git status --short
~~~

- 根 Vitest workspace 已包含 packages、apps、tests/parity 和 frontend；完整验收用不带路径筛选的 `vitest.cmd run --reporter=dot`。带 `packages apps tests/parity` 参数在本仓库只选中了 parity 项目，不能代替全仓测试。
- 新增功能测试按现有目录：packages/*/tests、apps/server/tests、frontend/tests。至少一个测试同时穿过API→真实Repository→真实Runtime→模拟Provider。
- fixture的假人设、收入、图片仅放测试目录/临时workspace；测试不发网络请求或访问真实工具凭据。
- 不为纯展示文字建立机械快照；关键UI覆盖选择、状态、错误、不可点击条件和字段提交。
- typecheck通过后不替代Vite build；TS项目根build不会生成frontend/dist。
- 记录已有基线失败，不能为了本阶段通过而跳过/删除断言或顺手修无关功能。
- 如需要本地UI演示，使用测试专用装配入口注入临时workspace和模拟Provider，所有远端写工具关闭。
- 不直接运行现有main.ts的--mock来保证免费演示：当前main.ts会先检查有效模型Key，且workspace固定指向真实目录。先实现明确隔离的演示启动入口或只用app.inject测试。
- 实际UI验收记录视口、场景与结果；未经检查不能写“视觉验收通过”。

重点回归保留：

- 六邻居路由、SELF/STOP、hop/每轮上限。
- 私有artifact读取/转移边界、工具enabled最终检查。
- 结算未知不退款、付费非法响应有界重试、Effect幂等。
- Pixel重生归档、余额和退款赤字约束。
- 现有OwnerChat仍为全局只读助手。
- Engine的运行、停止、费用、恢复和3D地图仍可达。

## 8. Luna 执行记录与交接模板

### 8.1 任务清单

本清单只在实际完成相应工作后勾选，不能在读完计划后勾选。

| 阶段 | 任务 | 状态 |
|---|---|---|
| 1 | S1-01 类型/表/Repository | 已完成 |
| 1 | S1-02 迁移/重生绑定 | 已完成（仅测试副本） |
| 1 | S1-03 人设/图片/API | 已完成 |
| 1 | S1-04 Prompt/历史归属 | 已完成 |
| 1 | S1-05 人物聊天往返 | 已完成（模拟 Provider） |
| 1 | S1-06 大厅/Engine | 已完成（自动及视口检查） |
| 1 | S1-07 验收并停止 | 已执行；1项既有测试失败，正式内容验收待完成 |
| 2 | S2-01 组织状态与表 | 已完成 |
| 2 | S2-02 Runtime范围隔离 | 已完成（本地模拟/测试） |
| 2 | S2-03 预算结算 | 已完成（本地模拟/测试） |
| 2 | S2-04 Mission | 技术完成（合成运行与Owner验收测试通过） |
| 2 | S2-05 招聘/候选载体 | 技术完成（隔离workspace） |
| 2 | S2-06 串行试炼 | 技术完成（同规则串行测试通过） |
| 2 | S2-07 履历/档案/UI | 技术完成（自动交互测试；未做现场数据验收） |
| 2 | S2-08 验收并停止 | 技术验收通过；真实题材/模型未验证 |
| 3 | S3-01 产品/反馈/交付 | 技术完成（隔离测试） |
| 3 | S3-02 收款/退款 | 技术完成（只验证人工记账逻辑；无真实收款） |
| 3 | S3-03 统计归因 | 技术完成（含成本未知和区间退款口径） |
| 3 | S3-04 Muse导出/回导 | 技术完成（隐私白名单、来源校验、幂等） |
| 3 | S3-05 UI/验收并停止 | 技术完成；真实商业闭环未验证 |

每个任务完成后追加一个短记录：

    任务：
    基线 / 修改文件：
    通过的测试和命令：
    失败或未做的验证：
    已知限制：
    下一任务：
    真实workspace是否修改：否 / 具体操作与授权

### 8.2 Luna max 执行提示

> 先读 8.4 和当前 Git 差异。Stage 1 已完成实现，不能重复迁移或覆盖已有改动。若用户要求继续 Stage 1，先复核既有测试失败是否属于本阶段；不得顺手修改无关功能或断言。Stage 1 验收后停止。未获用户验收并明确要求前，不进入 Stage 2。不要开 subagent，不自动提交/推送/部署，不运行真实付费模型，不迁移真实 workspace。Muse 正式素材缺失时使用中性测试素材，并明确标注。

### 8.3 后续阶段交接

只有在上一阶段被用户验收后，才使用：

> 继续本Plan的Stage 2（或Stage 3），从该阶段第一个未完成任务开始。先核对前一阶段执行记录和当前代码差异，不重复已完成迁移；按本阶段规则完成并在阶段末停止。没有真实业务证据时明确列为未验证，不制造数据补齐。

### 8.4 2026-09-25 Stage 1 执行记录

基线为 `fc3d4c7`，开始实施时代码工作区干净。用户已有的 `frontend/src/features/pixels/HeartbeatLightning.ts` 未修改。Stage 1 修改均留在工作区，未提交；真实 workspace 未迁移，未运行真实模型、部署或外部操作。身份迁移及聊天闭环只在隔离测试副本和模拟 Provider 中验证。

| 任务 | 修改文件 | 验证与结果 |
|---|---|---|
| S1-01 类型/表/Repository | 新增 `packages/protocol/src/types/qianji.ts`、`world_event.ts`；`packages/persistence/src/migrations/init_schema.ts`、`core_store.ts`、`repositories/qianji_repository.ts`、`world_event_repository.ts`、`owner_action_repository.ts`；新增 `packages/domain/src/qianji/validation.ts` 与持久层测试 | `qianji_repository.test.ts` 及完整 workspace 测试通过；含 schema 重复迁移、唯一绑定、历史和成本为空值保护。 |
| S1-02 迁移/重生绑定 | 新增 `apps/server/src/services/qianji_service.ts`、`scripts/migrate-qianji.ts`；调整 `packages/runtime/src/effects/effect_runtime.ts`；新增迁移服务和重生回归测试 | 测试副本 dry-run/apply、重复迁移、归档与失败回滚相关用例通过；真实 workspace 未迁移。 |
| S1-03 人设/图片/API | 新增 `apps/server/src/routes/qianji_routes.ts`、`world_presentation_service.ts`、`frontend/src/api/qianji.ts`；更新路由注册；新增人设编辑/详情界面和服务测试 | 输入校验、展示配置、人物履历与静态图片路由相关用例通过；未提供正式 Muse 图片/人设。 |
| S1-04 Prompt/历史归属 | 调整 `packages/model/src/prompt/prompt_builder.ts`、`packages/protocol/src/types/model.ts` / `message.ts`、model-call/message/ledger/budget repositories、`agent_step_runner.ts` 和 `resources/prompts/v9_system_prompt.md`；新增 golden hash fixture | Prompt 身份快照、归属、未知成本和历史隔离用例通过；测试 Provider，无真实模型调用。 |
| S1-05 人物聊天往返 | 调整 `decision.ts`、`effect.ts`、响应解析/编译、Runtime Effect；新增 `qianji_chat_repository.ts` 与 API 闭环测试 | `qianji_chat.test.ts` 验证排队、幂等、显式启动 Run、模拟 Provider 回复及刷新历史；Runtime 的非聊天回复拒绝用例通过。 |
| S1-06 大厅/Engine | 更新 `frontend/src/App.tsx`、`features/run/RunStatus.tsx`、`styles/index.css`；新增 EngineView、大厅、人物卡/详情/聊天/编辑组件及 polling hook 和 UI 测试 | 默认大厅、Engine 导航和人物交互测试通过。浏览器实测 1440×900、390×844；无横向溢出，桌面纵向溢出为 0，窄屏内容纵向滚动正常。 |
| S1-07 验收并停止 | 本执行记录 | Stage 1 实现已结束；有 1 项既有全仓测试失败，未进入 Stage 2。正式素材/用户内容验收、真实模型和真实 workspace 操作待后续授权。 |

全仓验证结果：`tsc.cmd -b --force` 通过；前端 `tsc.cmd -p tsconfig.app.json --noEmit` 通过；`vitest.cmd run --reporter=dot` 共 284 项，283 通过、1 失败（43 个测试文件中 42 通过、1 失败）；Vite 生产构建通过。唯一失败是 `frontend/tests/run_status.test.tsx:13` 仍期待 `EmergentInc V11 商业元胞自动机`，而基线 `fc3d4c7` 的 `RunStatus.tsx` 已显示 `EmergentInc 元胞会社`。这是本阶段开始前已有的断言/文案不一致，本次未改无关断言；因此 S1-07 自动验收项保持未勾选。Vite 另提示现有 bundle 超过 500 kB；构建仍成功。

界面由临时本地 API 与中性测试数据供给，未使用真实 workspace 数据。`tsc -b --force` 生成的三个 tracked `tsconfig.tsbuildinfo` 文件已恢复到基线。执行后 `git diff --check` 通过；未提交。

下一步：停止于 Stage 1。先处理或明确接受上述既有测试失败，并完成正式内容/界面人工验收；用户验收 Stage 1 且明确要求后才进入 Stage 2。真实 workspace 仍未修改。

### 8.5 Stage 2 执行记录（技术实现完成；真实业务验收未做）

#### S2-01 组织类型、状态机和表

- 基线：`fc3d4c7` 加上 8.4 所列 Stage 1 工作区改动。
- 修改：新增 `mission.ts`、`trial.ts`、`execution.ts` 协议类型；`domain/mission/rules.ts`、`domain/trial/rules.ts`、`domain/execution/rules.ts`、`domain/qianji/lifecycle.ts`；新增 `mission_repository.ts`、`trial_repository.ts`、`execution_repository.ts` 并接入 CoreStore；迁移入口增加组织表和 `organization_schema_version`。
- 验证：`vitest.cmd run packages/domain/tests/organization_rules.test.ts packages/persistence/tests/organization_repository.test.ts packages/persistence/tests/qianji_repository.test.ts --reporter=dot`，12 项通过；`tsc.cmd -b --force` 通过。
- 未做/限制：无真实业务数据；服务/API 和 Run scope 尚未接入。
- 下一任务：S2-02；真实 workspace 未修改。

#### S2-02 Runtime 范围隔离

- 基线：`fc3d4c7` 加 Stage 1、S2-01 工作区改动。
- 修改：`runs`、`messages`、`reservations`、`model_calls` 增加 nullable `execution_id`；RunService 增加服务端 execution scope 和事务内 `onRunCreated`；MessageRepository 按范围领取、计数、恢复预算等待消息、区分 SELF/environment 去重，并在 binding 失效时记录 `ABANDONED` 原因；RoundScheduler 限定世界/任务成员自然唤醒、队列消费和轮次计数；AgentStepRunner/EffectRuntime/FeedbackFactory 派生消息继承范围；工具目录和 handler 复核已启用工具与 execution 快照交集，任务私有文件工具拒绝执行，artifact 根隔离到 `workspace/evidence/<executionId>/artifacts`；任务路由、能量/产物转移限制在同 execution 六邻居，禁止繁殖；更新 `docs/runtime_invariants.md` 与 `docs/security_boundary.md`。
- 验证：`tsc.cmd -b --force` 通过；`vitest.cmd run packages/persistence/tests/organization_repository.test.ts packages/persistence/tests/qianji_repository.test.ts packages/runtime/tests/execution_scope.test.ts packages/runtime/tests/scheduler.test.ts packages/runtime/tests/effect_runtime.test.ts apps/server/tests/server.test.ts --reporter=dot`，6 个文件、49 项通过。包括世界/任务队列隔离、绑定失效、SELF 去重、私有工具越界拒绝、产物根隔离、事务回滚及 task round 幂等。
- 未做/限制：未运行真实模型；未接入 Stage 2 的 execution 预算 reserve/settle；未修改真实 workspace。执行工具权限和输入快照后续由 Mission/Trial 服务创建与冻结。
- 下一任务：S2-03；真实 workspace 未修改。

#### S2-03 执行预算 reserve / settle / refund

- 基线：S2-02 已通过定向验证的工作区状态。
- 修改：`BudgetRepository` 在事务内校验 Pixel、Run、Execution 和 Trial 全候选共享额度；reserved token 同步写 execution，settle/refund 与人工恢复同步更新 execution 账目；AgentStepRunner 在最终 PreparedModelRequest 上裁剪 `maxTokens`，scoped reserve 使用输入估算加最终输出上限；新增 `WAITING_EXECUTION_BUDGET` 与预算耗尽停机原因；Run 结束检测实际超支并阻塞 execution。
- 验证：`tsc.cmd -b --force` 通过；`vitest.cmd run apps/server/tests/server.test.ts packages/persistence/tests/execution_budget.test.ts packages/runtime/tests/execution_budget.test.ts --reporter=dot`，3 个文件、22 项通过。覆盖 Trial 共享预算、reserve/settle/refund、未知调用人工结算、环境变量输出上限、Run/Execution 实际超支如实记录并阻塞。
- 未做/限制：Trial candidate 数量和 `N×candidateBudget <= totalBudget` 的服务入口校验在 S2-06 招聘/试炼编排中完成；未运行真实模型或真实 workspace。
- 下一任务：S2-04；真实 workspace 未修改。

#### S2-04 Mission 服务与阁主令输入

- 修改：新增 `mission_service.ts`、`organization_routes.ts`；将 Mission 作用域接入 Run、消息、有效 mandate、任务证据快照、取消与Owner验收；手工改令在任务占用时拒绝；新增 Mission 看板和证据列表 API。修正 Execution 占用查询的 SQL 字段歧义。
- 验证：`mission_service.test.ts` 覆盖输入冻结、作用域启动、人工验收、断联拒绝和无效证据拒绝；服务、运行隔离及预算测试通过。
- 未做/限制：仅本地模拟 Provider；没有真实用户任务或真实 workspace。
- 下一任务：S2-05；真实 workspace 未修改。

#### S2-05 招贤榜与候选载体

- 修改：新增候选人服务/API、正式与试炼人设分离、空白 workspace staging、全局未使用坐标约束、候选初始 `trial_seed` 能量奖励及请求幂等；同一候选不重复奖励。
- 验证：`trial_service.test.ts` 覆盖安全坐标、重复请求、staging安装失败和残留阻断；类型检查通过。
- 未做/限制：没有创建任何真实候选人；坐标与workspace均为临时测试数据。
- 下一任务：S2-06；真实 workspace 未修改。

#### S2-06 串行试炼与Owner裁决

- 修改：新增统一题目/模型/工具快照、2–3人数量与共享预算约束、串行运行、失败/未知费用暂停与恢复、候选证据/成本展示、一次性裁决和落选者退役。
- 验证：测试校验规则hash一致、候选不并发、阻塞后恢复及Winner/Loser状态；跨服务测试覆盖录用候选执行Mission、保存不可变证据快照并由Owner验收关闭。
- 未做/限制：真实模型调用、正式题材和用户裁决待实际使用。
- 下一任务：S2-07；真实 workspace 未修改。

#### S2-07 履历、档案与组织界面

- 修改：增加人物生涯聚合、退役前置检查、活跃绑定像素/产物归档、同幂等键安全重试；任务占用期间保护聊天/人设/手工令。前端增加Mission、招聘/试炼、产品、档案、纪事页面和大厅导航；Mission参与者可选择，档案可下载归档文件。
- 验证：Server集成测试验证开放Mission阻止退休、关闭后归档及退役人物不可聊天；人物面板、导航和组织台交互测试通过。
- 未做/限制（当时）：本地浏览器大厅可访问，但API服务未启动，人工桌面/窄屏视觉检查未完成；后续在S3-05用隔离mock服务补做1280×720桌面检查，窄屏仍未人工检查。
- 下一任务：S2-08；真实 workspace 未修改。

#### S2-08 阶段验收并停止

- 验证：跨服务合成链覆盖候选串行试炼、Winner裁决、Mission执行、SHA-256证据快照和Owner验收；范围隔离、预算结算、Recovery、六邻居、私有artifact、退款赤字及旧Engine回归由现有服务/Runtime测试覆盖。Stage 2技术项完成后按用户明确要求进入Stage 3。
- 未做/限制：真实题材、真实模型和用户/Muse人工验收未做；不以合成数据替代。
- 下一任务：S3-01；真实 workspace 未修改。

### 8.6 Stage 3 执行记录（技术实现完成；商业闭环未验证）

#### S3-01 Product、反馈与交付

- 修改：新增Product/Business/Narrative协议类型、增量表与 `BusinessRepository`；实现Product生命周期、Mission关联冻结、私有反馈/公开摘要分离、仅凭已验收Mission证据登记交付及反馈/交付事实事件。
- 验证：产品状态、Mission关联、证据hash/大小校验、反馈隐私和历史保留由BusinessService测试覆盖。
- 补充端到端验收：模拟 `ModelProvider` 驱动真实Runtime和 `save_artifact` 工具，经Owner验收后串联产品交付、反馈、测试收款、部分退款和Facts导出；记录只在临时workspace及内存DB。
- 未做/限制：没有真实客户信息、真实交付或反馈。

#### S3-02 收款与退款

- 修改：复用外部收款/退款表，金额以CNY整数分为准；加入外部交易号、证据索引、幂等键、参与人份额和兼容金额投影；退款不改Token，允许部分退款并在同事务内校验累计上限。
- 验证：重复/冲突收款、份额归属、部分退款、超额拒绝、旧行不归属、Token余额不变及区间退款日期均有测试。
- 未做/限制：系统只记录Owner声明，不核验银行；本次没有向业务账本写入测试或真实收款。

#### S3-03 成本、净收入和归因

- 修改：实现组织/Product/Mission/Qianji指标；按Execution/绑定统计模型与工具成本、Owner助手成本单列；未知成本保留null；净收入、整数分摊、ROI和区间收款/退款分别计算。
- 验证：一分多人稳定分摊、未知成本ROI、成本不重复计数及按交易发生区间统计通过测试。
- 未做/限制：历史旧行保持待核对，不推测归属。

#### S3-04 Narrative事实导出与回导

- 修改：增加最大31天/2000事件导出、公开事件payload白名单、反馈原文/绝对路径/模型原始响应省略计数、来源ID校验、Chronicle按时间/人物/Mission/Product筛选；Muse草稿纯文本保存，回导用OwnerAction幂等键且只写叙事表。
- 验证：隐私、范围、来源校验、重复回导、事件过滤和区间收退款统计均有测试。
- 未做/限制：Muse内容的事实解释准确性需人工审核；没有自动发布。

#### S3-05 产品阁、纪事与阶段验收

- 修改：App增加组织控制台入口；实现Mission、试炼、Product、反馈、交付、人工收退款、退役档案/交付物及Facts/Narrative分区页面；产品成本走Product范围统计；加入响应式样式。
- 验证：`tsc.cmd -b --force`、前端Vite生产构建通过；导航、Mission参与者、产品记账来源/凭据及未知成本交互测试通过。修正过时的RunStatus标题断言。全仓 `vitest.cmd run --reporter=dot` 为53个文件、318项全部通过。Vite有一个883 kB chunk超过500 kB提示，但构建通过。
- UI验收：使用不含根目录 `.env` 的临时副本，以 `--mock` 在隔离workspace启动服务；API正常。于1280×720检查天机阁及组织控制台Mission、招贤与试炼、产品、档案、纪事页面，未观察到遮挡或横向溢出。窄屏未人工检查；样式有700px响应断点。
- 未做/限制：没有真实收款、退款、客户交付、正式Muse内容或外部发布，结论为“技术能力完成，商业闭环未验证”。
- 后续人工事项：提供真人需求/交付/反馈；确有收款时由Owner录入真实外部交易号与凭据索引；用户将事实导出交给Muse并审核内容。公开发布需单独决定。

#### Stage 2/3 总体验证与工作区边界

- `tsc.cmd -b --force` 与前端生产构建通过；`git diff --check` 通过（仅有Git LF/CRLF提示）。全仓53个文件、318项全部通过；定向服务/Runtime/界面测试通过。
- 测试使用临时目录、内存DB和模拟Provider；没有迁移真实workspace、运行真实模型、部署、提交或推送。全阶段修改留在工作区待审。

## 9. Plan 校准交付标准（修订阶段）

- 保留三阶段愿景及Engine/Muse/用户的分工。
- 把未存在的能力明确标为新增，给出当前真实代码入口。
- 明确人物回复、历史身份、重生、调度隔离、预算结算、证据、收款退款和叙事导出的闭环。
- 每个任务有输入、范围、实现约定、验证条件；不把关键架构选择留给执行者猜。
- Plan 校准阶段不更改业务源码、不运行真实业务；后续 Stage 1 实施情况以 8.4 为准。
