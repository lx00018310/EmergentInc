# 前端 React + TypeScript 迁移计划

日期：2026-09-16  
状态：待实施，仅设计；基于当前 Python/FastAPI 与静态 JS 前端审阅。

## 1. 目标与决策

将人与系统交互的前端独立到 `frontend/`，采用 **React + TypeScript + Vite**。保留 Python FastAPI、Python 引擎及 SQLite。

分层成立，但不以“再增加一两轮功能”作为机械阈值。当前 app.js 已集中管理运行、两类提示词、环境、文件、工具目录和执行历史，已有足够的拆分理由。迁移收益是明确交互状态、类型契约和组件边界，不是靠语言切换修复后端执行语义。

选择 Vite：这是已有 FastAPI 后端的本地交互控制台，当前没有 SSR、SEO 或 Node 服务端需求。第一版保持单页组件结构，不引入 Next.js、React Router、Redux、全套 UI 框架或新的 BFF。

完成后：

```text
React + TypeScript：人的操作、展示、表单、地图
        ↓ 现有 HTTP /api 接口
Python + FastAPI：请求校验、运行控制、文件响应
        ↓ 现有调用
Python engine / tools：世界演化、模型与工具执行
        ↓
SQLite + workspace 文件：现有状态与资料
```

只新增 frontend 顶层目录；Python 暂留 `emergentinc/ui`、`emergentinc/engine`、`emergentinc/tools`。不为了目录对称搬成 backend/engine，避免修改包路径、启动命令、工具和大量测试。

## 2. 范围与不变量

本次是功能等价迁移，不改版产品、不增加新的业务操作。

- Run、Round、能量、预算和工具回执仍以后端为准。前端不推算成功、不结算预算、不执行 SSH、不直接访问 SQLite 或 private 文件。
- `/api` 路径、HTTP 方法、请求字段及停止行为尽量不变；不将后端改造藏在前端迁移里。
- 保留工作区单进程锁，浏览器刷新、前端热更新和组件挂载不能启动 Run。
- 保持运行中不可修改提示词、工具 UNKNOWN 不当成功、空轮不当模型已调用等现有语义。
- 不迁移已经停用的 Owner 审批、回款、Loop 分支/回滚 UI；当前 app.js 内有遗留函数，不能逐行照搬。
- 不迁移数据库，不改引擎状态机，不增加 WebSocket/SSE，不新增工具执行 HTTP 接口。
- 上轮 review 的 T1 是独立后端问题。UI 开发可用模拟接口继续；真实 VPS 与真实付费视觉调用的集成验收，应在相应 T1 修复后进行。前端迁移不能宣称消除了这些风险。

## 3. 推荐目录

```text
frontend/
  package.json
  package-lock.json
  index.html
  vite.config.ts
  tsconfig*.json
  eslint.config.*
  README.md
  src/
    main.tsx
    App.tsx
    api/
      client.ts                 # fetch、错误解析、取消、编码
      types.ts                  # 实际 API DTO 与状态联合类型
      world.ts
      run.ts
      prompts.ts
      files.ts
      tools.ts
    hooks/
      useWorldPolling.ts
    components/
      Modal.tsx
      ErrorNotice.tsx
    features/
      run/RunControls.tsx
      run/RunStatus.tsx
      run/ConsolePanel.tsx
      prompts/PromptEditor.tsx
      environment/EnvironmentEditor.tsx
      pixels/PixelMapCanvas.tsx
      pixels/PixelMapRenderer.ts
      pixels/PixelDetails.tsx
      files/ArtifactBrowser.tsx
      files/PrivateFileBrowser.tsx
      files/FilePreview.tsx
      tools/ToolCatalog.tsx
      tools/ToolExecutionHistory.tsx
    styles/
      index.css
  tests/
  e2e/
  dist/                         # 构建输出，不手改、不入 Git
```

这是职责划分，不要求为每个小函数建文件。相关 DTO 少时放一个 types.ts；不预建通用插件 UI、复杂状态仓库或空模块。新增页面遵循已有 feature 结构即可。

## 4. 功能迁移与 API 映射

| 功能 | 组件/模块 | 使用现有接口 |
| --- | --- | --- |
| 世界指标、轮次、元胞 | App / RunStatus / PixelDetails | GET /api/world、GET /api/pixels/{id} |
| 运行、停止、快捷轮数、预算 | RunControls | GET /api/run/status、POST /api/run/start、POST /api/run/stop |
| 创世提示词 | PromptEditor 独立实例 | GET/PUT /api/genesis-prompt |
| 临时提示词 | PromptEditor 独立实例 | GET/PUT /api/temporary-prompt |
| 本地环境 | EnvironmentEditor | GET/POST /api/environment |
| 心智/状态文档 | PixelDetails / FilePreview | GET /api/pixels/{id}/document/{name} |
| 交付物列表、文本、下载 | ArtifactBrowser / FilePreview | GET /api/pixels/{id}/artifacts、/{filename}、/{filename}/download |
| private 列表、图片预览 | PrivateFileBrowser | GET /api/private-files、GET /api/private-files/preview |
| 工具目录 | ToolCatalog | GET /api/tools |
| 工具调用记录 | ToolExecutionHistory | GET /api/tool-executions |

不要为缺失的 API 臆造调用。例如当前 private UI 只有列举与图片预览，迁移不另加私密配置全文接口。文档/图片权限继续由后端控制。

## 5. TypeScript 契约与状态管理

### 5.1 API 层

- 开启 strict；禁止以全局 any、ts-ignore 或大量断言逃避迁移。未知工具 output 用 unknown，经类型判断后展示。
- 根据实际返回值建立 WorldDto、PixelDto、RunStatusDto、PromptDto、ToolSpecDto、ToolExecutionDto 和文件 DTO。区分 HTTP DTO 与组件表单草稿。
- 请求包含现有必填预算字段。`run_id`、可空值、UNKNOWN、COMPLETED_NO_ACTIVITY 等状态按当前后端定义处理；未知枚举显示原值与“未知状态”，不得映射成成功。
- 第一版使用手写、小范围 DTO 与契约测试。当前多个接口返回 Dict，直接从 OpenAPI 生成类型无法补出真实字段；不为代码生成全面重写后端 response_model。
- client 将响应先作为 unknown 处理，对关键结构进行必要检查。TypeScript 类型不会验证真实 HTTP JSON。
- 统一处理 400/409/422/500、非 JSON 响应、网络断开和取消；保留后端 detail。加载失败不能抹掉最后一次成功数据后显示绿色正常。
- 路径段及查询参数编码；统一使用相对 `/api`，不散落固定后端 URL。文件下载用现有 URL，图片通过后端受控响应展示。
- POST/PUT 不自动重试，尤其是 /run/start。请求超时后可读 status 核对，不能盲目再发一次启动请求。

### 5.2 页面状态

- App 持有世界快照、运行状态、selectedPixelId 和弹窗选择。第一版 React state + hooks 足够。
- 后端状态与表单草稿分离。世界轮询不得覆盖用户尚未保存的提示词或环境文本。
- PromptEditor 复用视觉和校验逻辑，但两类提示词各有 content/revision/hash/dirty/error，不共享草稿。
- 显示真实完成轮数、调用数、停止原因；若接口没有预算剩余值，显示未提供，不能用轮数冒充预算。
- Run 进行中禁用启动和两类提示词保存；HTTP 409 仍显示，因为前端按钮不代替后端校验。
- Run 启动请求进行中立即禁用重复提交；状态刷新后以服务器结果为准。

## 6. 轮询与 Canvas 生命周期

### 6.1 轮询

- 只建立一个世界/运行状态轮询 hook；沿用运行中约 600ms、空闲约 1500ms 的现有节奏。
- 当前一批请求结束后再安排下一批，不用 setInterval 堆叠未完成请求；独立 GET 可并行获取。
- 卸载时取消计时器并通过 AbortController 取消未完成请求；旧请求结果不得覆盖新组件状态。
- 工具目录、文件列表和执行历史按弹窗打开时读取；执行历史如需刷新，只在弹窗打开时有限刷新。
- 保留 React StrictMode；它用于暴露缺失清理。挂载/重挂载不得产生重复轮询、监听器，更不能发起模型或工具执行。
- 暂不引入 TanStack Query；只有实际出现跨页缓存、失效同步需求时再评估，不能为迁移先增大依赖面。

### 6.2 地图

- 保留当前 2.5D 投影、缩放、拖拽、命中判断和消息连线算法，转为 TypeScript renderer；不改成 Three.js。
- Renderer 只负责 Canvas，不通过 document.getElementById 更新 React 面板。
- React 通过 ref 创建 renderer，传入 pixels/flows/selectedId；点击以回调传回 selectedPixelId。
- React 负责 PixelDetails、按钮和文件弹窗；以 Pixel ID 查最新数据，避免继续拿旧对象或 hover 对象读取错误文件。
- renderer 必须提供 dispose：清理 window/canvas 事件监听、ResizeObserver、动画帧和其他资源。resize/重渲染不能重复注册监听器。
- 保留选中元胞的稳定性，悬停仅作预览，不随世界刷新重置用户选择。

## 7. 开发与日常启动

### 开发模式

- FastAPI 仍运行在 127.0.0.1:8765，沿用 workspace lock；不要用未加锁的第二个 uvicorn 实例绕开入口。
- Vite 固定 127.0.0.1:5173，strictPort=true；`/api` 代理到 8765，前端不用配置宽泛 CORS。
- Vite root 是 frontend，禁止设置为仓库根，不扩大 dev server 文件访问到 workspace/private。
- 后端和前端分别在两个终端运行，第一版不编写复杂双进程守护器。

```powershell
# 终端一：仓库根目录
python -m emergentinc.ui.app --workspace .\workspace --no-browser

# 终端二：frontend 目录
npm.cmd ci
npm.cmd run dev
```

Node 版本按实施时选定 Vite 的官方要求核对，在 package.json engines 和 README 中注明；提交锁文件，不让下次安装自动变成另一组版本。不要未经检查在 Windows 上替换系统 Node。

### 日常使用 / 构建后

- `npm.cmd run build` 生成 frontend/dist；继续由 FastAPI 提供该静态页面。日常启动不必运行 Vite 或 Node 服务。
- `emergentinc/ui/app.py` 仅新增静态产物路径解析与挂载：`/assets` 对应 dist/assets，`/` 返回 dist/index.html，已有 /api 优先且不受前端路由影响。
- 第一版无客户端路由，不加“任意路径都返回 index.html”的兜底；未知 /api 应保持 JSON 404，缺静态资源应返回 404。
- dist 不存在时后端 API 仍能初始化和测试；根页面返回明确 503 构建提示，不能静默回到旧 UI。
- 保留 BAT/PowerShell 单击启动方式。启动器工作目录固定到脚本目录；不自动安装 npm 依赖或每次启动自动构建。缺产物给出明确构建命令。
- 所有路径从 project_root 解析，不依赖用户在哪个终端目录调用。`--workspace` 仍只选择运行数据，不能改变前端源码路径。
- 更新 README 区分开发 5173 与日常 8765，不沿用错误的 8000 地址。

## 8. 凭据与不可信内容

- 前端 `.env` 只允许公开界面配置，不复制根目录 `.env` 或 private 配置；API key、SSH 密码和数据库连接串不得使用 VITE_ 前缀进入浏览器。
- 不在 localStorage/sessionStorage 中保存私密资料或凭据。当前提示词草稿先保存在内存，是否持久化另议。
- 模型文本、远程 stdout/stderr、文件内容都用 React 文本节点/pre 呈现；不使用 dangerouslySetInnerHTML，不执行交付物中的 HTML/JS。
- 工具记录只展示后端已脱敏回执，前端隐藏字段不能修复后端泄露。不要靠前端校验宣称 T1 凭据问题已解决。
- 图片与下载复用后端 URL；不将 private、workspace、SQLite 或整个项目映射为静态目录。

## 9. 实施顺序

### P0：建立迁移清单

读取当时 HEAD、现有 API/UI 与未提交改动。记录功能对照和关键请求示例，全部使用隔离工作区或假数据。保留用户未提交文件，不启动真实 VPS 操作。

### P1：前端骨架与 API 层

建立 React/TS/Vite、strict 配置、现有 CSS、API DTO/client 和错误提示。先接只读世界/状态与静态地图。不改变旧 UI 的默认服务入口。

### P2：运行与编辑

迁移运行/停止/预算、日志、两类提示词和环境编辑。完成轮询清理、重复提交和 dirty 草稿验证。

### P3：地图、文件与工具页面

移植 Canvas 算法，拆分 React 元胞详情；迁移文档、交付物、private 图片、工具目录与执行历史。所有功能使用统一 API client，下载/图片使用统一 URL 构造。

### P4：构建产物接入

通过功能对照后切换 FastAPI `/` 到 dist，更新启动说明和脚本检查。开发中两套源码可短暂并存，最终只保留一个正式页面入口；不得通过加载失败自动切回旧页面。

### P5：删除旧前端与验收

验收后移除 static 下已替代的 app.js、index.html、pixel_map.js 及无使用者的 loop_tree.js；CSS 已迁入 frontend。先检查测试与其他引用再删除。旧源码可从 Git 恢复，不另留 legacy UI 模式。

若需回退，只回退该迁移的代码和前端产物，不恢复旧数据库快照，不重置 workspace。

## 10. 验收与测试

测试围绕实际风险，避免给每个纯展示组件写快照测试。

| 验收项 | 必须达到 |
| --- | --- |
| 类型与构建 | typecheck、lint、build 通过；不依赖 noCheck 或全局 any |
| 请求契约 | Run 请求保留必填预算；409/422/500 和非 JSON 错误可见；不自动重试写操作 |
| 运行控制 | 点击一次仅发一次 start；运行中不可重复启动；停止反馈准确 |
| 提示词隔离 | 两份草稿、保存和清空互不影响；轮询不覆盖未保存输入；运行中保存被拒绝 |
| 生命周期 | StrictMode 下只有一个有效轮询；卸载/重挂载后没有遗留 listener 或请求 |
| 地图 | 拖拽、缩放、点击、消息流与旧版一致；更新后 selectedPixelId 稳定 |
| 内容与文件 | 文本不会执行 HTML；图片可预览；二进制可下载；选择文件后不因 hover 变化读取别的 Pixel |
| 工具状态 | SUCCESS/FAILED/UNKNOWN 按实际显示，不渲染为默认成功 |
| 后端断开 | 保留最后数据并显式标记连接异常，不显示“健康/运行成功” |
| 开发连接 | Vite /api 代理正常；只存在一个拥有工作区锁的后端 |
| 静态服务 | 构建后 BAT 可打开 8765；API 404 不被 HTML 吞掉；缺 dist 有明确构建提示 |
| 核心回归 | Python 现有测试通过；迁移没有改变引擎、预算、队列和工具行为 |

建议 Vitest + React Testing Library 覆盖 client、表单及生命周期；Playwright 覆盖页面关键路径，使用假 API 或隔离测试后端，不调用真实模型/SSH。浏览器自动化验证至少一遍构建后 FastAPI 页面，而不只测 Vite 开发页面。

计划新增 npm scripts：dev、typecheck、lint、test、test:e2e、build、preview。build 必须执行类型检查后再打包。

```powershell
# frontend
npm.cmd ci
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test -- --run
npm.cmd run build
npm.cmd run test:e2e

# 仓库根目录：使用本次独立的新临时目录
python -m pytest tests -q --basetemp .frontend_migration_test_tmp -p no:cacheprovider
```

交付报告说明：迁移完成的功能、旧入口清理情况、测试结果、构建/启动步骤及未解决的后端问题。真实操作验收与模拟 UI 测试严格区分。

## 11. 后续功能添加规则

- 新工具首先在 Python tools 中注册，前端工具目录和执行记录自动显示，不为每个工具写一套页面。
- 只有确实需要人的专属交互时才新增 feature 组件；仍经 api 模块调用后端。
- API 实际契约稳定并补齐后端响应模型后，再评估生成 TS DTO，不提前建设代码生成平台。
- 数据库是否迁到 Postgres 由多 worker/并发写需求决定，与这次前端迁移解耦。

## 12. 官方参考（设计时已核对）

- [Vite 入门、React TypeScript 模板与运行环境要求](https://vite.dev/guide/)
- [Vite 开发代理与端口配置](https://vite.dev/config/server-options.html#server-proxy)
- [React StrictMode 对副作用清理的检查](https://react.dev/reference/react/StrictMode)
- [FastAPI 静态文件挂载](https://fastapi.tiangolo.com/tutorial/static-files/)

本计划采用这些基础机制；具体依赖版本在实施时核对并锁定，不把未来 latest 作为可复现版本。
