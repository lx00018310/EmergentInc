# EmergentInc V5 极简可视化控制台实施报告 (UI Implementation Report)

## 1. 概要
依据 `EmergentInc_V5_UI_IMPLEMENTATION_PLAN.md`，本项目已完整实现轻量级本地可视化主入口。
核心系统不引入 React/Vue/Node.js 构建链，基于 Python FastAPI + 原生 HTML5/CSS3/JavaScript 与 Canvas 2.5D 等距投影，实现对元胞世界状态的全局观察、多轮推进、异常自动停机、快照存储、分支分叉与回退。

---

## 2. 新增文件清单

### 双击启动入口
- [`EmergentInc_UI.bat`](file:///D:/00_personalwork/EmergentInc元胞会社/EmergentInc_UI.bat)：Windows 双击批处理启动入口，自动检查 Python 依赖并启动服务。
- [`EmergentInc_UI.ps1`](file:///D:/00_personalwork/EmergentInc元胞会社/EmergentInc_UI.ps1)：PowerShell 备用启动脚本。

### 后端模块 (`ui/`)
- [`ui/__init__.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/__init__.py)：UI 包初始化。
- [`ui/app.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/app.py)：FastAPI 应用实例化、静态文件托管、127.0.0.1 端口绑定与默认浏览器拉起。
- [`ui/api.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/api.py)：REST API 路由（`/api/world`, `/api/run/*`, `/api/loops/*`, `/api/pixels/*`, `/api/owner/*`, `/api/environment/*`）。
- [`ui/world_reader.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/world_reader.py)：只读聚合世界状态为专用 UI DTO，提供元胞文档白名单读取与路径穿越防御。
- [`ui/run_controller.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/run_controller.py)：单 Worker Thread 步进执行控制、线程锁、状态汇报与自动停机拦截。
- [`ui/loop_store.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/loop_store.py)：Loop 历史元数据管理、分支与 Checkout 快照恢复、叶子节点删除。
- [`ui/snapshot.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/snapshot.py)：世界运行状态（元胞、任务、外部请求与账本）的创建与还原，严格排除密钥与代码。
- [`ui/owner_bridge.py`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/owner_bridge.py)：封装 `scripts.owner`，支持通过本地 Profile 路径审批现实能力，不在前端传输 Secret。

### 前端静态文件 (`ui/static/`)
- [`ui/static/index.html`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/static/index.html)：双栏布局结构、控制台输入框、停机警报区与模态弹窗。
- [`ui/static/style.css`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/static/style.css)：现代化暗色极简主题样式表。
- [`ui/static/pixel_map.js`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/static/pixel_map.js)：基于 `<canvas>` 的 3D→2D 等距等轴投影引擎、层深遮挡排序、元胞状态图元与悬停交互。
- [`ui/static/loop_tree.js`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/static/loop_tree.js)：Git 风格 Loop 分支树视图渲染及回退/分叉操作绑定。
- [`ui/static/app.js`](file:///D:/00_personalwork/EmergentInc元胞会社/ui/static/app.js)：主循环轮询（500ms~1200ms）、控制台命令解析与弹窗处理。

### 自动化测试套件 (`tests_ui/`)
- [`tests_ui/test_snapshot_restore.py`](file:///D:/00_personalwork/EmergentInc元胞会社/tests_ui/test_snapshot_restore.py)：验证快照备份与还原的完整性及私密路径隔离。
- [`tests_ui/test_loop_branch.py`](file:///D:/00_personalwork/EmergentInc元胞会社/tests_ui/test_loop_branch.py)：验证 Loop 树分支创建与 Manifest 切换。
- [`tests_ui/test_delete_leaf.py`](file:///D:/00_personalwork/EmergentInc元胞会社/tests_ui/test_delete_leaf.py)：验证非叶子节点禁止删除及叶子节点安全删除。
- [`tests_ui/test_world_api_no_secret.py`](file:///D:/00_personalwork/EmergentInc元胞会社/tests_ui/test_world_api_no_secret.py)：验证 UI API 绝对不泄漏 `owner_private` 内容。
- [`tests_ui/test_pixel_doc_allowlist.py`](file:///D:/00_personalwork/EmergentInc元胞会社/tests_ui/test_pixel_doc_allowlist.py)：验证文档访问白名单与目录穿越拦截。
- [`tests_ui/test_run_controller_stop.py`](file:///D:/00_personalwork/EmergentInc元胞会社/tests_ui/test_run_controller_stop.py)：验证多轮推进中人工请求停止的优雅停机机制。
- [`tests_ui/test_owner_stop.py`](file:///D:/00_personalwork/EmergentInc元胞会社/tests_ui/test_owner_stop.py)：验证发生 OwnerActionRequired 异常时自动中断步进并上报。

---

## 3. 修改文件清单
**无**。本阶段所有功能均以独立 UI 控制模块方式实现，未对 `scripts/` 中的底层世界逻辑做破坏性变更。

---

## 4. 运行方式

### 方式一：Windows 双击启动（推荐）
在资源管理器中直接双击根目录下的：
```text
EmergentInc_UI.bat
```
系统将自动检查依赖、绑定 `http://127.0.0.1:8765` 并拉起默认浏览器。

### 方式二：命令行启动
```bash
python -m ui.app
```
可在终端按 `Ctrl+C` 停止服务器。

---

## 5. 测试结果

### UI 专用测试验证
执行：
```bash
pytest tests_ui/ -v
```
结果：
```text
tests_ui/test_delete_leaf.py::test_delete_leaf_loop PASSED               [ 14%]
tests_ui/test_loop_branch.py::test_loop_branching_and_checkout PASSED    [ 28%]
tests_ui/test_owner_stop.py::test_owner_stop PASSED                      [ 42%]
tests_ui/test_pixel_doc_allowlist.py::test_pixel_doc_allowlist PASSED    [ 57%]
tests_ui/test_run_controller_stop.py::test_run_controller_stop PASSED    [ 71%]
tests_ui/test_snapshot_restore.py::test_snapshot_and_restore PASSED      [ 85%]
tests_ui/test_world_api_no_secret.py::test_world_api_no_secret PASSED    [100%]
============================== 7 passed in 1.21s ==============================
```

### V5 世界核心公理与自检
执行：
```bash
python -m scripts.self_check
```
结果：
```text
[PASS] V5 config
[PASS] runtime api_sandbox
[PASS] agent runtime disabled
[PASS] no AgentResponseRequired runtime
[PASS] no random_action
[PASS] no evidence_progress
[PASS] sandbox blocks global key
[PASS] owner_private gitignored
[PASS] runtime invariants
RESULT: PASS
```

---

## 6. 已知限制
1. **单进程独占锁**：UI 控制台运行期间拥有世界运行锁，不应同时在另一个终端并行调用 `python -m scripts.runner`。
2. **凭证配置**：审批现实能力请求时，仅支持指定已存在的 Profile 本地绝对路径文件，前端界面不提供明文私钥或密码编辑表单。

---

## 7. 是否修改 V5 世界公理
**NO**。
- UI 层仅作为观察者与外部调度控制器，不直接构造或干预 Pixel 局部视野。
- `/api/world` 输出的全局视野与 `ContextSandbox` 严格隔离，数据绝不回灌给 Pixel。
- 所有 Pixel 行为与能力依然严格受制于沙盒校验与 Evidence Validator。
