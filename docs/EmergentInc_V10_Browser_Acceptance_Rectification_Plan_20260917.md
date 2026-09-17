# EmergentInc V10 浏览器验收整改计划

日期：2026-09-17（Asia/Shanghai）  
页面：http://127.0.0.1:8765/  
代码基线：`ae0ae58a045ceed66084c126e15ebac35b258ac2`

关联提交：

- `cab287cc811b8e4ef87bb927cba6d93e2a95160b`：TypeScript 实现。
- `46edf878ccfe2bd032756d7b36237efe8fe4cfad`：删除 Python Runtime。
- `ae0ae58a045ceed66084c126e15ebac35b258ac2`：更新 README。

## 1. 结论与边界

当前不能认定 V10 已完成可用性或 V9 等价验收。问题既包括页面交互，也包括生产启动实际使用 Mock、运行状态与世界轮次脱节、提示词未接入模型、VPS 工具实现缺失以及核心源码未提交。

本文件是交给后续 AI 执行的整改任务，不是已完成修复报告。本次仅新增该文档，没有修改业务代码、配置、提示词、数据库内容或凭据；数据库只读查询除外。通过页面按用户要求点击了一次“跑 5 轮”，该操作由应用正常新增 Run/消息/调用记录并扣减了 140 能量，没有回滚这些记录。未执行真实 VPS 操作。

实施原则：

1. 最小修改，修复已确认断点；不再次重写项目、不引入新框架。
2. 不用扩大文档 allowlist、伪造状态或新增默认 Mock 掩盖错误。
3. 不删除/重置真实 workspace、旧账本、等待消息和私有文件。新增测试使用隔离 workspace。
4. 本文不顺带重做此前暂缓的完整事务、Exactly-Once、数据迁移、Recovery 和依赖架构设计；发现相关危险状态应明确阻断并报告，不能宣称这些问题已解决。
5. 以 V9.14 已确认业务语义和已修订重构计划为目标；新发现的功能退化独立验收。

## 2. 本次实际证据

浏览器通过 Chrome 控制工具操作，没有以 API 测试替代页面复现。由于此前原生电脑工具无法识别 URL，本轮使用用户提供的本地 URL 新开测试标签页。

| 检查项 | 实际结果 | 证据等级 |
| --- | --- | --- |
| 地图滚轮放大 | 地图先变大，后续轮询后回到原比例 | 页面复现 + 代码定位 |
| `完整 pixel.md` | `-1_0_0`、`0_0_0` 均返回 Document 'pixel' 不在 allowlist 的 403 | 页面复现 + 代码定位 |
| `物理 state.json` | `-1_0_0` 返回 Document 'state' 的 403 | 页面复现 + 代码定位 |
| 元胞卡片的 `全局 environment.md` | 返回 Document 'environment' 的 403 | 页面复现 + 代码定位 |
| 控制区 `外部环境` | 能正常打开 environment.md；未保存任何变更 | 页面正常对照 |
| 元胞详情 | 心智概要为 `-`，诞生轮次、世代、交付物数、心智字数为空 | 页面复现 + DTO/文件证据 |
| 创世提示词 | 有 546 字符、Revision 2，却显示“已关闭” | 页面复现 + DTO 代码定位 |
| 跑 5 轮 | 仅出现 DISPATCH 和“成功启动”，最终仍是 Round 19、run: -、READY；没有结束摘要 | 页面复现 + 数据库证据 |
| 工具目录 | 12 个工具均显示 Enabled，包括 6 个 VPS 工具 | 页面复现 |
| 执行记录 | 显示“暂无工具执行历史” | 页面观察；此次 STOP 响应没有工具调用，不能单凭空列表判为缺陷 |

本轮测试记录（只记录诊断所需字段，不含私有资料或凭据）：

```text
Run: run_1789610463654_6wg0
点击前总能量: 99,994,807
点击后总能量: 99,994,667
页面 Round: 19 → 19
DB start_round=1, end_round=5
DB status=COMPLETED, stop_reason=ROUND_LIMIT_REACHED, run_spent=140
该 Run 有两条 model_calls；每条 prompt_tokens=50, completion_tokens=20
两条响应均为:
{"message_md":"V10 Small Runtime is running safely in offline mode.","send_to":"STOP"}
```

因此，“没有结果”的本次直接原因不是没有点击成功，而是执行了固定 STOP 的离线 Mock，同时页面缺少真实进度与结果反馈。不能据此认定五轮一定应产生新元胞或交付物；真实模型也可以合法选择 STOP。

另有历史记录 `run_1789609936579_a4fs`：`status=COMPLETED` 但 `stop_reason=INFRASTRUCTURE_FAILURE`，证明失败也被写成完成。检查时队列共有 56 条 `WAITING_PIXEL_BUDGET`，轮次范围 5～19；这些记录包含历史数据，不能全部归因于本次点击。

本地 `0_0_0/pixel.md` 实际长度为 152 个 Python Unicode 码点，`-1_0_0/pixel.md` 为 306；页面概要为空不是文件本身无内容。

## 3. 整改任务

### R01 [P0] 核心 Runtime 源码未进入提交

**证据：** `git ls-tree -r --name-only cab287cc -- packages/runtime` 与 `git ls-files packages/runtime` 都无结果；`git check-ignore -v packages/runtime/src/scheduler/round_scheduler.ts` 命中 `.gitignore:16:runtime/`。但 server、parity 测试、TS 项目依赖 `@emergentinc/runtime`。本地目录存在，被忽略，所以工作区状态看似干净。

**修改位置：** `.gitignore`、`packages/runtime/`、workspace/TS 构建配置，必要时修正 README。

**最小整改：** 缩小运行数据忽略规则的匹配范围，保留真正运行数据目录的忽略；将所需 Runtime 源码、package.json、tsconfig 和测试纳入版本控制。不要把 workspace 数据或 dist/node_modules 一起提交。后续提交由执行者按用户授权办理，本计划不代表自动提交授权。

**验收：** 从只包含 Git 跟踪文件的干净检出执行 Windows 安装、build、测试和 server 启动；不允许复制当前机器被忽略的文件补齐。确认三个关联提交本身不能作为完整运行交付，修复后的提交才是验收基线。

### R02 [P2] 地图缩放/平移被轮询重置

**根因：** `frontend/src/App.tsx:234` 每次渲染创建新的 onSelectPixel/onHoverPixel；`PixelMapCanvas.tsx:23` 初始化 effect 依赖这两个函数，每次轮询更新父组件都会 dispose 并 new Renderer。构造时 `resize()` 会初始化视角；`setData()` 本身没有重置缩放。

**最小整改：** 稳定回调身份（可直接传 setSelectedPixelId、使用稳定空回调），让 Renderer 仅在 Canvas 生命周期内创建一次，数据更新走 setData。保留卸载清理，避免新增全局视角状态库。检查详情卡片是否遮挡右上角缩放工具栏，若遮挡只做必要布局调整。

**验收：** 滚轮、加减按钮、拖拽平移后跨至少 3 个轮询周期保持视角；选中其他元胞、开关弹窗、Run 状态改变均不重置；只有“重置视角”恢复默认。组件测试应覆盖父组件重新渲染，不能只测 Renderer.zoomIn()。

### R03 [P1] 文档按钮与后端契约不兼容

**根因：** `PixelDetails.tsx` 发送 `pixel/state/environment`；`apps/server/src/routes/api_routes.ts:92` 只接受 `pixel.md/state.json`，environment 完全没有映射。单独 `/api/environment` 已正常。

**最小整改：** 在 API Adapter 保留前端现有文档别名的显式映射，`pixel → pixel.md`、`state → state.json`；environment 使用现有环境读取服务。复核 V9 合法文档集合，禁止任意文件路径透传。state 内容应与当前权威账户和元胞状态一致，不能修好 403 后仍展示过期余额。

**验收：** 对 0_0_0 和另一个元胞逐个点击三个按钮，内容与对应来源一致；`../`、编码穿越、凭据文件、非法 pixelId 仍拒绝；未知文档和不存在元胞返回明确错误。UI 使用的短名称必须进入集成测试，不只测试完整文件名。

### R04 [P2] 世界 DTO 缺字段导致详情卡片空白和误导

**根因：** `WorldService.getWorldDto()`（`world_service.ts:48`）只输出 id/position/energy/active/neighbors，而前端需要 parent、born_round、generation、pixel_md、pixel_md_length、artifacts_count 等。neighbors 当前为对象数组，前端类型却声明 string[]。`metrics/latest_message_flow` 也未返回，支出显示和消息动画失去数据来源。缺失 parent 被显示为 Genesis，可能误标子代。

**最小整改：** 明确并补齐 UI 消费的 DTO，按现有文件/账户/账本正确读取与投影；同一字段使用一致类型。未知值显示“未知”，不能假装 0 或 Genesis；已存在内容不能用 `-` 替代。保留观察者 UI 与模型认知隔离，不把全局 DTO 直接塞进模型。

**验收：** 0_0_0 心智概要与实际文件一致；子代父节点、世代、出生轮次正确；心智码点长度和交付物数与内容一致；消费指标与账本一致。金额两位小数显示 ¥0.00 本身不足以证明错误，应用具有足够金额的 fixture 验证。邻居和消息流建立字段级契约测试。

### R05 [P1] 未配置真实模型时静默 Mock，造成“运行成功”假象

**根因：** `apps/server/src/main.ts:48` API Key 默认 `mock-key`，配置缺失时自动创建固定 STOP Provider。本次数据库原始响应与该分支完全一致；并非推测。该分支还以真实 Run/账户路径记录模拟 usage。

**最小整改：** 正常启动缺少有效模型配置时明确报错/禁止启动 Run，不默认降级 Mock。读取并兼容项目现有模型配置的装配入口；不打印密钥。Mock 仅用于显式测试模式和隔离 workspace，界面或启动输出要能区分模式。不得为了“有结果”强制模型复制、发消息或制造交付物。

**验收：** 无配置时不会出现假模型 SUCCESS，不扣真实实验账户；显式测试 Provider 的回执明确可辨。真实模式用脱敏配置验证 Provider 选择，随后按授权做一次受控真实调用验证；本次没有验证真实供应商连通性。

### R06 [P1] Run 轮次、终态与页面反馈脱节

**根因：** `RunService.start()` 写死 start_round=1、end_round=请求轮数；runLoop 每次从 1 开始。Scheduler 没有提交 world.round，而 `WorldService` 仍读取旧 world_state.json，页面又优先显示该 round。getStatus 只返回 running/current_loop/current_round/last_stop_reason，前端期待 run_id、stop_reason、completed_rounds、model_calls_completed、last_error 等；Scheduler 返回错误 stopReason 后 Run 仍写 COMPLETED。

**修改位置：** `apps/server/src/services/run_service.ts:23/56/91/107`、`world_service.ts:60`、`packages/runtime/src/scheduler/round_scheduler.ts`、`frontend/src/features/run/RunStatus.tsx`、`RunControls.tsx`、必要的结束摘要处理。

**最小整改：** 区分世界绝对轮次与本次完成轮数；从已完成世界轮次继续，完成一轮后更新现有持久化/投影出口，不另造事实源。记录实际完成轮数与实际终点。按正常完成、用户停止、预算等待、错误、恢复暂停映射终态；保留具体错误。补全已有前端 DTO，结束摘要按 run_id 去重，不能只显示 HTTP 启动成功。

**验收：** fixture 世界轮次 19，完整跑 5 轮后为 24，再跑 1 轮为 25；提前失败只记录真实完成部分。界面显示 runId、请求/完成轮数、模型调用数、消息数、花费和停止原因；0 次调用说明空转/等待原因。即使短 Run 在两次轮询之间完成，也能显示持久化最终摘要。注入基础设施错误后 DB/API/UI 都不能报告 COMPLETED/READY 为成功结果。

### R07 [P1] 预算等待消息无法再被调度，且自然唤醒使用假活动轮次

**证据：** 本地 `agent_step_runner.ts` 把所有 BudgetExceededError 统一写 WAITING_PIXEL_BUDGET 并抛出；Scheduler 统一转 INFRASTRUCTURE_FAILURE。`message_repository.ts` 的 claimNext 只领取 QUEUED/RESPONSE_STORED，没有等待状态的重新评估入口；countPendingMessages 又把 WAITING 计入 pending。Scheduler.beginRound 写死 lastActiveRound=0。这些是代码确认缺陷；本次未向账户充值来复现恢复。

**最小整改：** 分开 Pixel 余额、Pixel 单轮预算、Run/Global 预算不足的原因；按已确认计划在合法轮次/新 Run 重新评估等待消息，不忙轮询、不丢消息、不改为无限预算。读取真实 last_active_round，成功活动后更新；使用既有自然唤醒阈值，不写死假状态。

**验收：** 正余额不足保持 active 并让其他可运行 Pixel 继续；单轮预算下轮恢复；Run/Global 不足停止并显示预算原因；通过正常受支持方式补足预算后，同一等待消息恰好恢复执行一次；pending 消息不生成重复自然唤醒。不得修改真实 56 条历史记录来让测试变绿。

### R08 [P1] 提示词有内容却显示关闭，而且没有接入运行请求

**根因：** PromptService 返回 content/revision/sha256，缺前端使用的 active/hash。更严重的是 `main.ts:69` 只以 modelName 构造 PromptBuilder，没有装配基础 v9_system_prompt、工具目录、创世/临时提示词。Run 又固定记录 genesis_revision=1，本次页面实际为 revision 2。

**最小整改：** 修复 Prompt DTO；每次 Run 开始读取并锁定实际提示词 revision/hash，将基础 Prompt、启用工具目录、创世/临时 Prompt 传入模型请求。保持三输入 payload 边界，不能注入凭据。页面“已启用”必须与实际注入行为一致。

**验收：** 在隔离 workspace 保存可辨识测试文本，非空为启用、清空为关闭；捕获请求验证对应 system 内容确实包含文本和工具目录；运行中锁定、下次 Run 更新；Run 记录 revision/hash 与请求一致。不能仅验证文件保存成功。

### R09 [P1] 六个 VPS 工具只返回模拟成功，目录却显示真实能力已启用

**证据：** 页面目录 12 项 Enabled；`packages/tools/src/builtin/vps.ts:4` 的六个 handler 全部调用 getMockVpsResult，没有真实 SSH/SFTP 路径，即使没有 mockVpsHandler 也返回 SUCCESS 和 mock:true。此问题由代码确认，未向 VPS 发命令。

**最小整改：** 将 mock handler 限制为测试注入；恢复 V9 六项工具的实际参数和执行契约、受控连接/超时/取消/读写行为，接入 tools.json 的启用和超时配置。未实现或缺配置时明确 FAILED/CAPABILITY_UNAVAILABLE/配置错误，不能伪造成功或显示为已可用。不要新增通用 Shell 权限。

**验收：** 隔离适配器测试证明每个工具确实调用对应执行/传输接口、正确回传输出或错误；失败/未知结果不能伪造 SUCCESS；禁用工具在目录与调用边界一致。真实远端验收与离线测试分开记录，未经明确授权不执行远端写操作。

## 4. 实施顺序与提交边界

1. **交付完整性：R01。** 先确保其他 AI 能从干净检出获得相同源码；本地被忽略的 Runtime 在正式纳入 Git 前不能冒充提交内容。
2. **运行真实性：R05 → R06/R07 → R08/R09。** 防止模拟成功和错误终态继续污染对运行结果的判断。不要为真实测试直接改当前世界能量或等待队列。
3. **页面闭环：R03/R04 → R02。** 文档、详情和缩放修复可以独立实施，但不能将其完成等同于 Runtime 验收完成。
4. **真实启动路径验收。** 使用生产装配函数 + 隔离 workspace + 可控 Provider 的集成测试，随后 Chrome 重走用户入口。不能只测手工 new PromptBuilder/MockScheduler 的单元测试。
5. **报告与 README。** 核对 ae0ae58 中“已完成/等价/保留能力”等陈述，只保留有证据的结论。46edf87 已删除旧实现，V9 对照应从只读历史版本提取或运行于隔离环境，不恢复双主运行路径。

## 5. 验收清单

- [ ] 干净 Windows 检出可安装、构建、运行；packages/runtime 全部必要源文件在 Git 内。
- [ ] Chrome 缩放和平移跨轮询、选择元胞和开关弹窗稳定。
- [ ] 0_0_0 及子代的 pixel/state/environment 三个文档按钮成功且内容正确。
- [ ] 文档 allowlist、Pixel 隔离和凭据访问限制没有被放宽。
- [ ] 详情卡片不存在“文件有内容但显示 -”、缺字段空白或子代误标 Genesis。
- [ ] 跑 5 轮和再跑 1 轮的世界轮次连续，DB/API/UI 一致。
- [ ] 短 Run、0 调用、预算不足、模型错误、用户 Stop 都显示真实结果摘要。
- [ ] 正常模式不静默 Mock；测试模式不会写入真实实验账户。
- [ ] 提示词启用状态、实际 system 请求、Run revision/hash 一致。
- [ ] 预算等待恢复与自然唤醒不丢消息、不忙循环、不生成重复工作。
- [ ] 六个 VPS 工具真实实现和模拟测试明确区分，不再无条件 SUCCESS。
- [ ] 新测试覆盖实际浏览器使用的参数和 DTO；保留现有相关测试，不能删除断言或放宽预期来通过。
- [ ] 每项报告修改文件、验证命令/场景、实际结果与未验收项；不把测试数量作为等价证明。

## 6. 尚未覆盖的验证

本次未保存/修改提示词或环境、未真实调用 VPS、未做崩溃注入、未运行完整测试套件、未做真实供应商联网验收，也未完成所有三个提交的逐行审计。运行停止按钮与工具历史明细需要在有受控慢调用和固定历史记录的测试环境中补验。先前暂缓的 Exactly-Once、跨仓储原子性、完整迁移/恢复设计仍未解除；本计划不能用来宣称那些问题已修复。
