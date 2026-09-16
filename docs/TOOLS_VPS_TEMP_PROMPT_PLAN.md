# 临时提示词、私有文件与 VPS 工具：增量实施计划

日期：2026-09-16  
状态：设计完成，交由后续 Agent 实施；本轮未修改程序、连接 VPS 或执行远程命令。

## 1. 用户已确认的范围

1. 临时提示词独立于创世提示词，随时可保存、修改、清空。
2. VPS 开放完整操作能力：查看状态、读写文件、执行命令、安装软件、运行程序、部署和管理服务；实际权限以所配置 SSH 账号为准。
3. private 目录中的配置、文本、图片及附件可按需使用；已有文件不覆盖，缺失的必要配置才补模板。
4. 工具集中组织，未来添加数据库查询、社交账号运营等能力时，不再改造调度主流程。

沿用现有 V9 模型决策、operations 数组、消息反馈、Run 和预算。建立一个小型工具注册层，不增加第二套 Agent 框架、工具服务器、远程插件市场、通用工作流引擎或全局审批门禁。

“全允许”是本项目已配置 VPS 的操作范围，不意味着新增本机任意 Shell 或任意目录访问，也不自动扩展为未来社交账号的发布授权。未来能力按其接入时的任务范围启用。

## 2. 当前代码与配置证据

- `engine/llm.py`：实际 system prompt 在 `prepare_prompt()` 拼接创世提示词；目前用户消息为纯文本 JSON。
- `engine/genesis.py`：已有持久化、revision、清空关闭以及 Run 锁定语义，可借用约定，不覆盖创世文件。
- `engine/operations.py`：当前仅有交付物 save/read/list；不具备 private 读取或 VPS 执行能力。单纯把本机路径写进提示词不会读取文件。
- `engine/capability.py::_ssh_exec`：旧 SSH 实现绑定旧审批流程，且仅支持密钥路径；不可直接挂回整个 CapabilityGateway。
- 当前 `workspace/private/owner_vps_profile.json` 已存在。仅核实字段和类型，包含 host、port、username、password、allowed_operations、public_metadata；未输出实际凭据。**密码认证必须支持，不能只实现密钥登录。**
- 当前 private 还有 `README.md` 和一张 JPEG 图片。图片支持必须有真实内容解析，不能把路径或文件名当作读取成功。
- 当前正确默认路径为 `D:\00_personalwork\EmergentInc元胞会社\workspace\private`。用户聊天中的 `D:\00\_personalwork` 与 `owner\_vps` 不可作为代码硬编码路径。全部使用 `ProjectPaths.private_root`；UI 展示实际解析路径。
- `scheduler.py` 当前在工具执行前调用 `record_effect_once()`，而该函数直接写 APPLIED。这对 SSH 写操作不成立：标记成功后崩溃可能实际没执行，断线也可能已执行。
- 上一轮 review 的旧接口未断开、启动仍处理 Loop、启动失败留下 RUNNING、HEALTHY 不更新问题，实施时核对是否已修复；新功能不得依赖这些旧支线。

## 3. 目标路径

```text
用户保存临时提示词
  → 下一次 Run 锁定创世提示词、临时提示词、工具目录与配置版本
  → 模型从工具说明中选择 operations
  → 统一注册层校验参数与执行上下文
  → private 文件 / 本地交付物 / VPS 工具执行
  → 持久化真实回执 → ENGINE_FEEDBACK → 下一次元胞决策
  → UI 查看结果、交付物与错误，继续或停止
```

所有工具共享这一条调用路径。SSH 操作不生成 owner_request，不恢复旧审批页。

## 4. 工具目录：现在统一接口，按需增加能力

建议结构：

```text
emergentinc/tools/
  README.md                 # Agent 新增工具的操作说明、约定与示例
  contracts.py              # ToolSpec、ToolContext、ToolResult
  registry.py               # 显式注册、参数校验、目录生成、分发
  artifacts.py              # 现有三个交付物工具，保持工具名与行为
  private_files.py          # 私有文件列举、读取、图片解析
  vps.py                    # SSH / SFTP 工具
  registry_manifest.py      # 显式导入并注册各模块，唯一组装入口

workspace/private/
  tools.json                # 当前启用工具、profile 映射、超时等小型配置
  owner_vps_profile.json    # 复用已有，不覆盖
  ...                       # 既有资料、图片和凭据

tests/tools/
  ...                       # 各工具契约、路径、凭据、错误与执行回执测试
```

不创建尚未实现的 database/social 空模块。以后加入 `database.py`、`social_x.py`，注册工具并补对应测试即可。

### 4.1 统一契约

`ToolSpec` 至少包含：

- `name`：稳定、唯一名称；旧 save_artifact/read_artifact/list_artifacts 不改名。
- `description`：模型可读用途及限制。
- `input_schema`：JSON Schema，严格校验参数类型、必填项、未知字段。
- `effect`：read / write；用于回执与重放策略，不把“读工具”设为免校验。
- `timeout_seconds`、输出上限与 `handler`。

`ToolContext` 由引擎创建，含 workspace 路径、pixel_id、run_id、message_id、稳定 operation_id、停止信号及后端配置解析器。模型参数不能覆盖身份、私有根目录或凭据来源。

`ToolResult` 至少包含：operation_id、tool、status、output、error_code、error_message、duration_ms、truncated、可选 result_ref 和 usage。状态统一为 SUCCESS / FAILED / UNKNOWN；远程命令输出另带 exit_code。

工具配置或输入错误返回结构化 FAILED；不能吞异常冒充成功。注册时发现重复名称应直接报错。

### 4.2 Agent 如何发现与调用

- 注册层从 ToolSpec 自动生成模型工具说明，包含名称、参数和简短例子；只展示已启用且可用的工具。工具文档和参数定义只有这一份事实源。
- 保留 `operations: [{"tool": "...", "args": {...}}]` 响应形状，不再手写日益增长的 `_dispatch` if/else。
- 保留每次决策最多 3 项工具操作；逐项执行并检查停止信号。一步失败/结果未知则停止该批剩余操作，反馈具体原因，允许后续决策处理。
- 前一步结果必须到下一次模型决策才可用于构造后一步参数；不增加字符串变量替换或隐藏的工具链语言。
- UI 可通过只读 `GET /api/tools` 查看同一份目录及配置状态，绝不返回凭据。模型目录从后端直接构造，不通过 HTTP 自调用。
- 工具多起来后先只注入启用工具；本期不建向量检索或智能工具推荐服务。

### 4.3 现有代码衔接

`OperationExecutor` 暂保留为薄适配器，委托 registry 执行并沿用现有回执接口。先迁移原有三个工具并验证行为不变，再增加新模块。scheduler 不感知某工具是 SSH、数据库还是社交平台。

tools.json 首次不存在时才创建最小模板。现有文件合并所需缺项并保留用户值；配置格式错误明确报错，不静默重置。禁用某工具不能使本地核心无法启动。

## 5. 临时提示词

- 独立文件：`workspace/runtime/temporary_prompt.json`；默认空白，不自动填建议内容。
- 独立 UI 卡片：“临时提示词”，保存与清空按钮。新增 GET/PUT `/api/temporary-prompt`，复用创世提示词的类型校验、换行规范、12,000 字符上限及原子写入约定。
- 保存后下一次 Run 生效；与创世提示词一样，运行中编辑返回 409，UI 禁用编辑并提示先停止。不要做每一跳动态换提示词。
- 顺序：基础系统规则 → 工具目录 → GENESIS_CONTEXT → TEMPORARY_CONTEXT。临时文本补充当前任务，不改变工具真实权限或执行边界。
- 仍保持 state / pixel_md / message_md 三项业务输入。临时提示词放 system，不自动写入元胞记忆、环境或广播消息。
- Run 开始就读取并锁定内容与 revision/hash，传给调度器和模型客户端；实际完整 prompt 必须计入预算估算及调用 hash。
- 清空后后续 Run 不注入，重启不恢复默认内容。清空不会删除已形成的 pixel.md、队列、历史日志，也不会撤销已完成的远程动作；UI 简洁注明。
- 保存临时提示词不自动唤醒、不自动发起 SSH。用户仍点击运行；若需要唤醒，沿用已有启动消息和自然唤醒语义，不能偷偷重复注入任务。

推荐用户输入示例：

> 使用 private 中的 owner_vps_profile.json 配置连接 VPS。先验证当前账号和工作目录，再根据任务执行操作；依据工具回执记录实际结果。

## 6. private 文件能力

### 6.1 工具

| 工具 | 参数与结果 |
| --- | --- |
| `list_private_files` | path 默认空、分页参数；返回相对路径、类型、大小，不返回内容；目录按需展开 |
| `read_private_file` | path、offset、limit；文本返回内容片段、编码、是否截断及下一偏移；配置返回可用结构；其他格式返回明确类型及内容处理方式 |
| `inspect_private_image` | path、question；返回对图片内容的真实观察及模型用量，不能只返回元数据 |

路径允许 private 内相对路径，以及解析后确实位于 private 内的绝对路径，满足用户粘贴路径的习惯。禁止用字符串 startswith 判断包含关系；用 resolve 后的目录包含判断，覆盖 Windows 大小写、盘符、UNC、`..`、符号链接和 junction。不得因路径拼错自动扫描整个磁盘。

文本 UTF-8 优先；无法解码时返回明确错误及可指定编码，不以忽略错误方式伪造完整内容。长文本分页，反馈只给有界片段。二进制附件可取得元数据，并由 VPS 上传工具按文件引用传输，不将 base64 当成模型已经理解内容。

本期实际需求是 JSON、Markdown、文本与 JPEG/PNG。PDF、Office、音视频等如暂无解析器，明确返回 CONTENT_PARSER_UNAVAILABLE，并允许文件传输；不能宣称支持语义读取所有格式。后续解析器使用相同注册契约新增，不侵入 scheduler。

### 6.2 凭据和图片

- 后端能完整读取 VPS profile 及认证材料，模型读取该配置时得到 host、port、username、认证方式、配置是否完整和 profile 引用；password、私钥、token 的原文不进入普通回执、prompt 或日志。
- 对已知凭据文件使用明确的字段投影，私钥文件只返回可用于认证的引用；不要以普通全文读取工具绕过该处理。普通业务资料按用户授权返回内容。
- 这不是要求用户重复批准访问：系统直接使用已配置的凭据登录。若确有传输凭据文件的业务任务，必须区别普通业务附件，不能默认为模型可发布的素材。
- 图片通过 `inspect_private_image` 调用配置的视觉模型，结果作为工具文本反馈，保持主调度的三输入接口。不要假定当前文本模型支持图片。
- 视觉模型复用现有供应商适配、预算预留和真实用量结算，需有明确模型配置与计价；未配置则明确不可用，不能自动换模型、免费调用或硬编码估算账目。
- 图片仅在该工具实际被调用时发送至配置的模型服务；对文件大小、像素和输出设限。图像上传内容属于这次工具调用，不把整个 private 目录自动加载到上下文。
- UI 提供按需文件列表和图片预览，复用弹窗。预览也通过受路径校验的接口，不把 private 挂为静态目录；凭据原文不通过预览暴露。

## 7. VPS 能力

### 7.1 配置与认证

- 默认 profile_id 为 `owner_vps`，映射现有 `owner_vps_profile.json`。模型只传 profile_id，host、账号、认证资料由后端读取，不接受模型在调用参数中改连任意主机。
- 本期同时支持密码认证和密钥认证。建议集中使用 Python SSH/SFTP 库实现，在 requirements 中声明依赖；不采用 Windows 不通用的 sshpass，也不通过命令行明文传密码。
- 旧 profile 的 allowed_operations 可能只有 ssh_exec。显式兼容该旧操作名并记录新工具映射，不能因旧枚举使新增文件工具无故不可用；按用户本次授权配置完整 VPS 能力，不新建每命令审批。
- 已有 host/port/username/password 不改、不打印。缺配置才生成带占位符的示例并列出待填项；不能伪造登录资料或覆盖现有配置。
- 密钥路径相对 profile 所在目录解析；缺失或认证失败明确返回，不自动尝试其他账号。主机指纹存于 private 下独立 known_hosts；首次连接记录指纹，后续变更拒绝并明确原因，不静默覆盖。
- 非交互执行，不默认分配终端。需要提权时按账号已有权限执行；遇到 sudo 交互要求明确失败，不猜密码、不把 SSH 密码自动用于 sudo。

### 7.2 工具集

| 工具 | 主要参数 | 行为 |
| --- | --- | --- |
| `vps_exec` | profile_id、command、可选 cwd、timeout_seconds | 单次非交互命令，返回 stdout/stderr/exit_code；支持安装、部署、服务管理等，不设置只读命令白名单 |
| `vps_list_files` | profile_id、path、分页 | SFTP 列出远程目录 |
| `vps_read_file` | profile_id、path、offset、limit | 按需读取远程文本片段 |
| `vps_write_file` | profile_id、path、content、overwrite | 写远程文本；默认不覆盖，模型明确指定覆盖才替换 |
| `vps_upload_file` | profile_id、source_kind、source_path、remote_path、overwrite | 从当前 Pixel 交付物或 private 业务附件上传原始文件，支持图片等二进制；不经过 LLM 搬运字节 |
| `vps_download_file` | profile_id、remote_path、artifact_filename、overwrite | 下载到当前 Pixel 交付物目录，不能指定任意本机目标 |

使用 exec 执行 `whoami`/`pwd` 即可验证登录，不另造持久会话管理器或独立 login 工具。每次工具调用独立连接，第一版不做连接池。cwd 等由执行器安全处理；禁止把本机文件路径拼成宿主 Shell 命令。

默认连接超时 10 秒、命令超时 60 秒，用户配置最大 600 秒；长任务可由模型显式启动远程后台进程并随后查询，后台启动成功不等于任务完成。输出分页或截断须给出标记，不能静默裁剪后宣称完整。

停止按钮阻止后续工具，并尽可能关闭当前连接；不能承诺关闭 SSH 就能杀掉远程进程。命令发送后超时/断线若无法确认完成状态，返回 UNKNOWN，不能自动重发。

## 8. 统一执行记录：只补外部工具必需的部分

现有“先写 APPLIED 再执行”的 operations 包装不能继续用于 VPS。为所有注册工具增加单一执行记录路径；不要同时保留两层相互矛盾的成功标记。

建议在现有 SQLite 增加小型 tool_executions 表：operation_id（唯一）、run_id、message_id、pixel_id、tool、args_hash、status、result、started_at、finished_at。不得存储明文认证材料。

- operation_id 由 message_id + operation index 确定；参数 hash 用于检测重放时参数冲突，不另生随机 ID 绕过唯一约束。
- 调用前登记 STARTED；收到真实结果后落 SUCCESS/FAILED 及回执；不跨 SSH 调用持有数据库事务锁。
- 重放已结束操作复用已保存结果，补投同一标识的反馈，不重复执行。
- 崩溃留下 STARTED 或写操作结果无法确定时转 UNKNOWN；不把它当成功，也不自动重新执行。只把具体动作的不确定性反馈给当前任务，不恢复旧审批系统或锁死所有本地 Run。
- 不宣称远程操作 exactly-once。未来数据库/社交平台有原生事务或 idempotency key 时，由对应工具利用稳定 operation_id 对接。
- 回执落库与反馈入队之间发生崩溃，恢复后须能从记录补发一次反馈；反馈去重以 operation_id 为依据。不能只跳过已执行动作，却把结果丢了。
- 图像分析等额外模型调用纳入现有 Run / Pixel / 全局预算，不把工具调用变成绕过预算的第二条模型通道。

## 9. UI、提示词与结果可见性

- UI 增加临时提示词卡片、工具目录及配置状态、private 文件查看入口；优先复用现有弹窗，不新增复杂管理后台。
- 显示最近工具名称、成功/失败/结果未知、执行耗时和有界结果；完整结果按引用读取。错误要能区分缺配置、认证失败、远程命令退出非零、超时与结果未知。
- 现有交付物详情只按文本展示；补齐图片预览和二进制下载分支，否则 VPS 下载的图片会被错误解码。模型的 read_artifact 也要明确区分文本与二进制。
- 基础 prompt 从“仅三个工具可用”改为以自动生成目录为准；保留 owner_request=null。工具输出、远程文件和 private 业务资料是数据，不自动成为新的系统规则。
- 修改 HEALTHY 状态为真实运行状态，不能新增功能后继续保留固定绿色健康标识。

## 10. 实施次序及边界

1. **核对基线**：查看当前提交与未提交改动；保留用户文件及 `.codex_test_owner_focus/`。只修复与主路径有关的已确认 review 问题，不另做整库重构。
2. **注册层**：建立 tools 目录、契约和显式注册，迁移现有三项工具，保持旧调用协议通过测试。
3. **临时提示词**：独立存储/API/UI、Run 锁定、完整 prompt 预算和 hash。
4. **private**：路径解析、分页、配置投影、图片解析及附件传输引用；复用现有文件，不创建第二份 VPS 凭据。
5. **执行记录与 VPS**：先实现可恢复回执，再接密码/密钥认证、exec 和 SFTP；更新工具配置与自动目录。
6. **UI 与回归**：查看文本/图片/二进制结果，错误与 UNKNOWN 可见；补齐操作记录查询。

本期不实现数据库或社交平台业务工具；只用下面的扩展演练验证接入方式。不要恢复旧 CapabilityGateway 的审批、Problem、Evidence 等依赖链，不做 MCP 服务化或工具自动下载安装。

## 11. 验收标准

### 自动化：临时工作区、假 SSH 服务/客户端与模拟模型

- 保存/清空临时提示词不会修改 genesis_prompt.json；空白默认关闭、重启不恢复；运行中改动被拒绝；下一次 Run 采用新版本。
- 实际模型请求包含临时提示词和工具目录，预算估算包含它们；三项业务 payload 不意外增加全局私有信息。
- 原三项交付物工具、复制、路由、预算与停止测试继续通过。
- registry 对重复名称、未知工具、参数错误给出明确结果；禁用/未配置工具不影响本地演化。
- private 相对/绝对合法路径可读，Windows 越界、junction、同前缀兄弟目录、错误编码和超大文件都按约定处理。
- profile 已存在时不覆盖；真实 password 不出现在回执、API、消息或错误日志中；密码认证与密钥认证分别测试。
- 图片用视觉工具实际读取像素并反馈内容；未配视觉模型明确不可用；用量记入预算；不能用固定假描述通过验收。
- SSH 非零退出、连接失败、命令发出后断线、超时、用户停止、上传下载失败分别覆盖；不能将所有异常统一视为“未执行”。
- 重启恢复同一 operation 时不重复写远程文件；成功回执可重放；STARTED/UNKNOWN 不自动重发；反馈中断可补投且去重。
- 上传现有 JPEG 字节不变；下载文件只落当前 Pixel artifacts，UI 能正确预览图片或下载二进制。
- **扩展演练**：测试中新增一个 fake_database_query ToolSpec，注册后即能出现在目录、通过 operations 执行并持久化回执；无需改 scheduler 或在 UI 写新分支。
- 停用 VPS 后，本地 1/10 轮运行仍可完成；旧审批与 Loop 不重新成为启动条件。

### 真实验收：实施阶段单独记录，不用模拟结果替代

在已配置 VPS 上执行一个有限闭环：从临时提示词发起 → 读取 profile 的可用信息 → 验证登录 → 在唯一命名的测试目录写入文本 → 读回 → 上传一张测试图片 → 下载并比对 hash → UI 查看结果。只清理本次创建的测试目录，先验证远程绝对路径。

完整 VPS 能力并不要求通过安装软件、重启生产服务或删除业务文件来验收；这些动作的参数传递和错误处理可先由模拟测试验证。真实连接结果、认证方式、退出码、文件比对和失败项应记录在实施报告中，禁止记入凭据。

## 12. 后续 Agent 新增能力的固定步骤

1. 在 `emergentinc/tools/` 新增一个能力模块，定义 ToolSpec、handler 和必要的后端客户端。
2. 在 registry_manifest 显式注册；在 private 中增加独立配置引用，不能把凭据写进源码或工具目录说明。
3. 补参数校验、失败分类、输出限制、外部副作用和幂等策略的测试。
4. 通过通用 operations 路径验证发现 → 调用 → 回执 → 后续决策，不新增工具专属调度分支。
5. 更新 tools/README 的短示例。数据库工具先明确连接与查询范围；社交工具区分读取、草稿和发布，并在接入时确定其授权范围，不继承 VPS 的“全允许”。

交付标准：临时提示词真正改变后续任务，模型能发现并调用 private/VPS 工具，结果可核验；以后增加工具主要改工具模块、注册和测试，而不是再改造整个系统。
