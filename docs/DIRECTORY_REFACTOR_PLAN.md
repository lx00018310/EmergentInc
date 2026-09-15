# EmergentInc 目录重构 Plan

## 1. 目标

把“稳定程序”和“运行时会变化的数据”彻底分开，并让一个 Loop 的当前状态、历史检查点、日志和私密运行数据都有唯一归属。

本次只重构目录和路径，不改变 Round、Pixel、Evidence、Capability、分支、快照或 UI 的业务语义。

## 2. 当前问题（基于仓库实查）

1. `scripts/` 实际是核心程序包，不是普通脚本目录。
2. Loop 的当前状态散落在根目录：`world_state.*`、`pixels/`、`problems/`、`rounds/`、`capabilities/`、`external_*`。
3. `loops/` 只保存 manifest、branch 和 checkpoint，不能代表完整的 Loop 工作区。
4. `runtime/`、`cache/`、`ui_state/`、`owner_private/` 同属运行数据，却分散在多个顶层目录。
5. `Storage`、UI、快照和模型适配器大量使用相对根目录的硬编码路径；直接移动文件会破坏运行、恢复和安全边界。
6. 根目录还混有提示文档、版本 overlay 清单和 UI 实现报告，入口与历史资料不易区分。
7. 当前存在空的 `loops/checkpoints/L000001`～`L000003` 目录；它们没有 `meta.json`，而 manifest 的 `current_loop` 和 main branch 的 `head` 均为 `null`。它们不是有效 checkpoint，迁移前必须单独确认来源，不得按有效 Loop 计数或擅自删除。

## 3. 决策

不采用“把所有名字含 loop 的文件塞进 `loops/`”的方案。原因是核心代码与运行数据生命周期不同，混放会继续制造边界不清。

采用四层结构：

```text
EmergentInc元胞会社/
├─ emergentinc/                 # 稳定 Python 程序
│  ├─ paths.py                  # 唯一路径定义
│  ├─ engine/                   # 原 scripts/ 中的运行引擎
│  ├─ ui/                       # 原 ui/
│  └─ cli/                      # 运维、检查、迁移入口
├─ resources/                   # 版本化的静态输入
│  ├─ config/
│  ├─ schemas/
│  ├─ prompts/
│  ├─ templates/
│  ├─ experiments/
│  └─ bootstrap/                # 新工作区的最小初始状态
├─ workspace/                   # 单一运行工作区；不放程序源码
│  ├─ live/                     # 当前可变世界
│  │  ├─ world_state.json
│  │  ├─ world_state.md
│  │  ├─ pixels/
│  │  ├─ problems/
│  │  ├─ rounds/
│  │  ├─ capabilities/
│  │  ├─ external_events/
│  │  ├─ external_requests/
│  │  ├─ external_transactions/
│  │  └─ reports/
│  ├─ loops/                    # Loop 元数据、分支与 before/after 检查点
│  │  ├─ manifest.json
│  │  ├─ branches/
│  │  └─ checkpoints/
│  ├─ runtime/                  # LLM 请求/响应及运行日志
│  ├─ cache/
│  ├─ ui_state/
│  ├─ scratch/
│  └─ private/                  # 原 owner_private；不得进入快照/API/Git
├─ tests/                       # 原 tests_ui，后续可按 engine/ui 分组
├─ docs/
│  ├─ guides/                   # Owner、Agent、Bootstrap 等指南
│  └─ history/                  # overlay manifest、历史实现报告
├─ EmergentInc_UI.bat           # Windows 双击入口，保留根目录
├─ EmergentInc_UI.ps1
├─ README.md
├─ requirements.txt
├─ .env.example
└─ .gitignore
```

`workspace/live/` 是当前真值；`workspace/loops/` 是该真值的版本历史。不得再维护第二套顶层状态目录。

## 4. 文件迁移映射

### 4.1 程序

- `scripts/actions.py` 等核心模块 → `emergentinc/engine/`
- `scripts/runner.py` → `emergentinc/engine/runner.py`
- `scripts/storage.py` → `emergentinc/engine/storage.py`
- `scripts/audit_report.py`、`metrics.py`、`owner.py`、`self_check.py`、`migrate_*.py` → `emergentinc/cli/`
- `ui/` → `emergentinc/ui/`，包括 `static/`
- `tests_ui/` → `tests/`

移动时必须同步 Python 相对导入和测试导入；不要保留兼容转发模块。

### 4.2 静态资源

- `config/` → `resources/config/`
- `schemas/` → `resources/schemas/`
- `prompts/` → `resources/prompts/`
- `templates/` → `resources/templates/`
- `experiments/` → `resources/experiments/`

### 4.3 当前运行数据

- `world_state.json`、`world_state.md` → `workspace/live/`
- `pixels/`、`problems/`、`rounds/`、`reports/` → `workspace/live/`
- `capabilities/`、`external_events/`、`external_requests/`、`external_transactions/` → `workspace/live/`
- `loops/` → `workspace/loops/`
- `runtime/`、`cache/`、`ui_state/`、`scratch/` → `workspace/` 下同名目录
- `owner_private/` → `workspace/private/`

迁移必须保留已有文件内容、mtime 非必需、Loop ID 和 branch head 必须保持不变。

### 4.4 文档

- `AGENT_RUNNER_PROMPT.md`、`BOOTSTRAP_PROMPT.md`、`DEV_AGENT_GUIDE.md`、`MASTER_PROMPT.md`、`OWNER_GUIDE.md` → `docs/guides/`
- `UI_IMPLEMENTATION_REPORT.md`、`V4_OVERLAY_MANIFEST.md`、`V5_OVERLAY_MANIFEST.md` → `docs/history/`
- 现有 `docs/*.md` 暂不按主题深拆，避免无收益的大范围链接修改。

## 5. 实现顺序

### 阶段 0：建立基线，禁止边跑边迁移

1. 确认 UI 和 runner 均未运行，避免迁移时继续写入状态。
2. 记录 `git status --short`；不得覆盖用户已有改动。
3. 运行并记录现有基线：`python -m pytest -q tests_ui`、`python -m scripts.self_check`。
4. 记录关键状态：当前 round、Pixel ID、Problem ID、Loop manifest、branch head、有效 checkpoint 数量，以及缺少 `meta.json` 的孤立目录清单。

任何基线失败都先记录并停止，不得把旧故障混入目录重构。

### 阶段 1：先建立统一路径契约

新增 `emergentinc/paths.py`，使用一个不可变的 `ProjectPaths`（或等价结构）集中给出：

- `project_root`
- `resources_root`
- `workspace_root`
- `live_root`
- `loops_root`
- `runtime_root`
- `private_root`

规则：

1. 项目根从模块文件位置解析，不依赖进程当前目录。
2. 默认工作区固定为 `<project_root>/workspace`。
3. CLI 仅保留一个显式覆盖参数 `--workspace PATH`。
4. 不允许各模块自行拼接 `Path('.')` 或再次定义目录常量。
5. 不添加“新路径不存在就偷偷读取旧路径”的兼容兜底。

### 阶段 2：改代码引用，再移动文件

1. 让 `Storage` 明确接收 `ProjectPaths`，读取静态资源时走 `resources_root`，读写世界状态时走 `live_root`。
2. 修改 runner、environment、model adapter、render、owner、audit、metrics、self-check 的路径引用。
3. 修改 UI 的 app、API、world reader、owner bridge、run controller、loop store。
4. `LoopStore` 的根改为 `workspace/loops/`；创建/恢复快照时，源或目标固定为 `workspace/live/`。
5. 快照白名单继续只包含当前业务状态：world、pixels、problems、capabilities、external 数据；`private/`、`runtime/`、`cache/`、`ui_state/` 和 `loops/` 永远不得进入快照。
6. 用 `git mv` 移动版本化文件；忽略文件用 PowerShell 的 `Move-Item -LiteralPath`，每个目标在操作前解析并确认位于本仓库内。
7. 更新 README、文档链接、Windows 启动器及测试导入。

### 阶段 3：提供一次性工作区初始化/迁移

提供一个明确 CLI，例如：

```powershell
python -m emergentinc.cli.init_workspace --workspace .\workspace
```

要求：

1. `resources/bootstrap/` 只保存可公开、可复现的最小初始世界，不含真实 `.env`、Owner 凭据或历史运行日志。
2. 初始化目标非空时直接失败，不覆盖。
3. 对本仓库现有数据采用一次性迁移，不做运行时旧路径回退。
4. 迁移前校验源清单，迁移后校验目标清单与 JSON 可解析性。
5. 只有验收通过后才删除空的旧目录；不删除任何无法分类的文件。

### 阶段 4：Git 边界

建议版本控制：

- 跟踪 `emergentinc/`、`resources/`、`tests/`、`docs/` 和根入口文件。
- 忽略 `workspace/` 的实际运行内容。
- 如需保留目录说明，使用仓库外说明或对特定 README 作 `.gitignore` 例外；不要提交真实状态快照。
- 继续忽略 `.env`、密钥、私钥及 Python 缓存。

必须显式确认现有被 Git 跟踪的世界状态是否要归档为 bootstrap fixture；不得默认把当前运行态当成干净初始态。

## 6. 必须补充或调整的测试

1. 从仓库根目录之外启动 runner，仍能正确定位 resources 和 workspace。
2. `--workspace` 指向临时目录时，不读写默认工作区。
3. 一个 Round 的所有输出只出现在 `workspace/live/` 或 `workspace/runtime/`。
4. start/finish Loop 在 `workspace/loops/checkpoints/<Loop ID>/before|after` 生成完整快照。
5. checkout/branch 恢复 `workspace/live/`，且不修改 `workspace/private/`。
6. API 的 Pixel 文档 allow-list 仍不能路径穿越。
7. API 和快照均不暴露 `workspace/private/` 或 `.env`。
8. 非叶 Loop 仍不可删除；branch head、parent 关系保持不变。
9. 初始化非空工作区必须失败，不能覆盖已有实验。
10. 扫描仓库代码，除 `paths.py`、测试 fixture 和迁移工具外，不应再出现旧顶层运行路径的硬编码。

## 7. 验收命令（Windows PowerShell）

```powershell
python -m pytest -q
python -m emergentinc.cli.self_check --workspace .\workspace
python -m emergentinc.engine.runner --workspace .\workspace --rounds 1
git status --short
rg -n "Path\(['\"]?(pixels|problems|rounds|loops|runtime|owner_private)|base.*/'(pixels|problems|rounds|loops)'" emergentinc
```

最后一条扫描允许命中 `paths.py` 中的集中定义；其他命中必须逐项解释。

人工核对：

- 根目录只剩程序目录、资源目录、工作区目录、测试、文档和启动入口。
- Round 增加 1，UI 显示与 JSON 一致。
- 当前 Pixel/Problem/Loop 数量与迁移前一致。
- checkout 后世界状态可恢复，私密目录内容未变化。
- `git status` 不因运行一轮产生新的运行数据改动。

## 8. 禁止事项

- 不改业务规则、Schema 字段或 API 响应结构。
- 不重写 Loop 存储格式，不顺带引入数据库、对象存储或内容寻址。
- 不把 `private/` 放进 Loop checkpoint。
- 不同时保留两套可写的 live state。
- 不做旧路径自动探测或静默 fallback。
- 不清理、压缩或删除已有历史数据，除非有单独明确授权。
- 不顺带更换依赖管理、Web 框架或前端技术栈。

## 9. 完成定义

只有同时满足以下条件才算完成：

1. 所有版本化文件已按目标结构归位，旧顶层数据目录不存在。
2. 所有读写路径通过统一路径对象进入，运行不依赖 cwd。
3. 现有测试与新增路径/快照/安全测试全部通过。
4. 现有世界和 Loop 关系迁移前后计数一致。
5. UI、单轮 runner、自检均可在 Windows 上运行。
6. 一轮运行不会污染 Git 工作区。
7. README 已给出新建工作区、启动、运行、自检和数据备份方式。

## 10. 给执行模型的停机条件

遇到以下任一情况，停止并报告，不要猜测或兜底：

- 迁移前工作区存在无法归类或正在变化的文件。
- 当前运行态与 checkpoint 的 branch/head 关系不一致。
- 发现缺少 `meta.json` 的 checkpoint 目录且尚未确认保留、隔离或删除策略。
- 现有测试在未改代码前失败。
- 移动后文件数、关键 ID 或 JSON 校验不一致。
- 需要删除历史数据、凭据或用户未提交改动才能继续。
