# EmergentInc 前端可视化整改计划 (P0 + P1)

> 制定日期: 2026-09-20
> **执行状态: P0 + P1 已于 2026-09-20 全部落地并通过验证（typecheck ✓ / 47 项测试全绿 ✓ / 生产构建 ✓）**
> 范围: 仅 `frontend/` (React 18 + TS + Vite + Three.js)，不改任何后端 API。
> 依据: 全量通读 `frontend/src`（App.tsx、14 个组件、PixelMapRenderer、index.css、API 层、useWorldPolling）后的问题诊断。

---

## 0. 现状脉络（一页速览）

```
┌──────────────── Header (RunStatus) ────────────────┐
│ Logo+标题 | run徽章 | Round | 活跃元胞 | 总能量 | 支出¥ | 系统状态 │
├────────── 左栏 440px (纵向滚动) ──────────┬──────── 右侧 3D 画布 ────────┐
│ ① RunControls: 预算×2 + 命令输入 + 启停    │  工具栏: 标题+5项图例+缩放按钮   │
│   + 跑1/5/10轮 + 4个弹窗入口按钮           │  Three.js 晶格(球=元胞,管=消息流) │
│ ② 五层上下文说明 (<details>折叠)           │  ┌─ PixelDetails 悬浮卡 ─┐    │
│ ③ ConsolePanel: 恢复告警 + 日志(180px)     │  │ 8字段网格+Tips+心智摘要 │    │
│ ④ 创世提示词编辑器                          │  │ +7个操作按钮           │    │
│ ⑤ 临时提示词编辑器                          │  └─────────────────────┘    │
│                                          │  RecoveryOperations 审计弹窗   │
└──────────────────────────────────────────┴──────────────────────────────┘
弹窗层(7个): PixelOperations(3Tab) / Environment / ToolCatalog /
            PrivateFiles / ToolExecutions / Artifacts / FilePreview
```

**数据流**：`useWorldPolling` 每 0.6s（运行中）/1.5s（空闲）并行拉 `/world` + `/run/status`（空闲附加 `/workspace/audit`）。所有写操作后 `refreshImmediately()`。

---

## 1. 问题诊断摘要

### A. 信息噪音（不该显示的显示了）
| # | 位置 | 问题 |
|---|------|------|
| A1 | Header | `run: <run_id>` 徽章占标题旁黄金位，日常监控价值低 |
| A2 | PixelDetails | 8 字段平铺：物理坐标/诞生轮次/代际/六邻域/心智字数等低频调试信息与"能量"同权重 |
| A3 | 画布工具栏 | 5 项图例常驻，挤占"需审计决策"告警按钮空间 |
| A4 | 左栏 | "五层上下文说明"静态文档常驻主操作流 |
| A5 | 入口重复 | environment.md 在 RunControls(编辑) 与 PixelDetails(只读) 双入口，语义混淆 |

### B. 信息断层（该显示的要点击/完全没显示）
| # | 问题 | 关键事实 |
|---|------|----------|
| B1 | **元胞信息必须点击才可见** | `App.tsx` 中 `onHoverPixel = (_id) => {}` 是空函数；PixelDetails 仅选中后渲染且遮挡画布右上 |
| B2 | **`latest_activity` 被丢弃** | DTO 已含 round/action/intent/result——"元胞最近在干什么"是最高频问题，UI 完全未渲染；`capabilities`/`resource`/`last_active_round` 同样未展示 |
| B3 | **运行进度不可见** | runStatus 有 completed_rounds/requested_rounds/messages_processed/model_calls_completed，运行中只有 "RUNNING" 字样，无进度无计数 |
| B4 | 消息流只有 3D 曲线 | 谁跟谁通信只能盯绿色管道猜，无文字记录 |
| B5 | 成本感知薄弱 | 单步成本需 选中→点Step Cost→弹窗→切Tab 四步才可见 |

### C. 交互与样式缺陷
| # | 问题 |
|---|------|
| C1 | 弹窗套弹窗：ArtifactBrowser→FilePreview 两层叠加；全局 7 Modal + 1 画布内弹窗 |
| C2 | PixelDetails 不可关闭/折叠，只能被替换 |
| C3 | **样式 Bug**：RunControls 两个预算输入框内联写死深色 `#1a202c`+白字，与全站浅色主题冲突 |
| C4 | 硬编码颜色散落（#000000/#666666/#ff4500），未走 CSS 变量 |

---

## 2. 整改总原则

1. **状态靠看，详情靠点**：状态类信息（进度、最近动作、未读提醒、成本）零点击可见；配置类、调试类信息才进折叠/弹窗。
2. **最小改动优先**：不动 API，不改数据结构；优先用"面板内 Tab/折叠区"替代新 Modal。
3. **每个弹窗问一句"能否内嵌"**。
4. **所有颜色走 CSS 变量**，消灭内联硬编码。
5. 每项改动独立可交付、可回滚；保持现有测试（`frontend/tests`）通过。

---

## 3. P0 整改项（收益最大、改动最小、互不依赖）

### P0-1 悬停 Tooltip：零点击看元胞概要
- **目标**：鼠标悬停 3D 球体即见 `ID | 能量 | Active/Dead | 最近动作一句话`，点击才出完整 PixelDetails 卡。
- **改动点**：
  - `App.tsx`：实现 `handleHoverPixel`，新增 `hoveredPixelId` state 传给画布。
  - 新增 `features/pixels/PixelHoverTooltip.tsx`：跟随鼠标的轻量浮层（absolute 定位，pointer-events: none），数据源 `pixels.find(p => p.id === hoveredPixelId)`，最近动作取 `latest_activity.action + intent`（截断 ~40 字）。
  - `PixelMapCanvas.tsx`：渲染 Tooltip，坐标来自渲染器 pointermove 的 clientX/Y。
- **验证**：悬停即显、移出即隐、点击仍选中出完整卡；tooltip 不拦截 OrbitControls 拖拽。
- **文件**：App.tsx / PixelMapCanvas.tsx / 新建 PixelHoverTooltip.tsx / index.css（新增 tooltip 样式，用变量）。

### P0-2 PixelDetails 首屏展示 latest_activity + 调试属性折叠
- **目标**：卡片顶部（状态徽章下）新增"最近一轮"区块：`Round N · action · intent → result`；物理坐标/诞生轮次/代际/六邻域/心智字数 5 项收进 `<details> 调试属性` 折叠区（默认收起）。
- **保留不动**：能量、Tips 区块、心智概要、7 个操作按钮。
- **验证**：无 latest_activity 时显示"暂无活动记录"；折叠区默认收起可展开。
- **文件**：PixelDetails.tsx / index.css（复用 context-guide 的 details 样式模式）。

### P0-3 运行进度条 + 实时计数
- **目标**：运行中在 RunControls 顶部（或 Header 下沿细条）显示进度条 `completed_rounds / requested_rounds`，右侧小字 `消息 X · 模型调用 Y`；空闲时隐藏。
- **改动点**：`RunControls.tsx` 新增进度区块（数据全部来自 runStatus，纯展示）；样式走 CSS 变量，绿色填充。
- **验证**：启动"跑5轮"可观察到进度推进与计数增长；停止后消失。
- **文件**：RunControls.tsx / index.css。

### P0-4 PixelDetails 可关闭/可折叠
- **目标**：卡片右上角加 `×` 关闭按钮（置 `selectedPixelId = null`）；标题栏点击可折叠为单行（只留 ID+状态）。
- **改动点**：App.tsx 传 `onClose`；PixelDetails 内部加 `collapsed` state。
- **注意**：关闭后 3D 选中外环同步消失（selectedPixelId=null 已驱动渲染器）。
- **文件**：PixelDetails.tsx / App.tsx / index.css。

### P0-5 修复预算输入框深色内联样式
- **目标**：删除 RunControls 两处内联 `background:#1a202c;color:#fff;border:#4a5568`，改用与 `.operation-section input` 一致的浅色样式类。
- **验证**：浅色主题下输入框视觉统一；disabled 态可读。
- **文件**：RunControls.tsx / index.css。

### P0 完成标准（Definition of Done）
- [x] 悬停任意元胞可见概要 tooltip；点击出完整卡
- [x] PixelDetails 首屏含"最近一轮"，调试属性默认折叠
- [x] 运行中可见进度条与消息/调用计数
- [x] 详情卡可关闭、可折叠
- [x] 预算输入框浅色统一
- [x] 既有前端测试全绿；`tsc -b` 无新错误

---

## 4. P1 整改项（布局重组，建议在 P0 全部落地后启动）

### P1-1 左栏瘦身
- Console 默认折叠至 ~60px（标题栏+最新 1 条，点击展开至 180px）；恢复告警不受影响照常显示。
- "五层上下文说明"从主栏移除，改为 Header `?` 帮助按钮触发 Modal。
- 创世/临时两个 PromptEditor 合并为单卡片内 Tab（"创世提示词"/"临时提示词"），复用现有 PromptEditor 组件不改其内部逻辑。
- **目标**：左栏一屏内见"控制 + 告警 + 提示词"。
- **文件**：App.tsx / ConsolePanel.tsx / RunStatus.tsx（帮助按钮）/ 复用 Modal。

### P1-2 画布工具栏瘦身
- 5 项图例收进 `图例` 按钮（hover 弹出或点击展开小浮层）；标题精简为 "3D 晶格"。
- "需审计决策 (N)" 告警按钮保持常驻不动。
- **文件**：PixelMapCanvas.tsx / index.css。

### P1-3 文档入口合并（消除双入口与弹窗数）
- PixelDetails 的 4 个文档按钮（pixel.md / tips / state.json / environment.md）合并为 1 个"查看文档"按钮 → FilePreview 弹窗内加 Tab 切换文档；ArtifactBrowser 的"查看"改为弹窗内切换预览视图（参考 ToolCatalog 已实现的"列表/详情"内嵌模式），杜绝双层 Modal。
- RunControls 的"外部环境"保留（编辑语义），PixelDetails 侧 environment.md 预览并入文档 Tab。
- **文件**：PixelDetails.tsx / FilePreview.tsx / ArtifactBrowser.tsx / App.tsx。

### P1-4 元胞列表侧栏（可 toggle）+ 3D 能量编码
- 右侧面板顶部加 toggle：3D 视图 / 列表视图（或并排窄列表）。列表按能量排序、可按 ID 搜索；点击列表项 = 选中 + 相机聚焦该元胞（renderer 新增 `focusPixel(id)`：controls.target 平滑移向球心）。
- 3D 球体视觉编码增强：半径/亮度随 `energy` 映射（有界 clamp），死亡元胞缩小+降透明，让 3D 图本身承载信息量。
- **文件**：新建 PixelListPanel.tsx / PixelMapCanvas.tsx / PixelMapRenderer.ts / index.css。

### P1-5 颜色变量收口
- 盘点各组件内联硬编码色值（#000000/#666666/#e3b341/#ff4500 等），迁移至 `:root` CSS 变量并全局替换；Three.js 侧色值集中到 PixelMapRenderer 顶部常量并加注释对应 CSS 变量。
- **文件**：index.css / 各组件（仅替换色值，不动逻辑）。

### P1 完成标准
- [x] 左栏默认一屏可见控制/告警/提示词；Console 可折叠
- [x] 工具栏仅保留标题+告警+缩放，图例收折
- [x] 文档查看单一入口、无双层 Modal
- [x] 列表可搜索定位并相机聚焦；球体大小反映能量
- [x] 无组件级硬编码色值
- [x] 测试全绿

---

## 5. 实施顺序与依赖

```
P0-5(样式Bug) ─┐
P0-1(tooltip) ─┤  全部互不依赖，可并行；建议顺序:
P0-2(activity)─┤  P0-5 → P0-3 → P0-4 → P0-2 → P0-1
P0-3(进度条) ──┤  (先修Bug再增功能, tooltip 最后做因涉及渲染器联动)
P0-4(可关闭) ──┘
        ↓ P0 验收后
P1-1(左栏) → P1-2(工具栏) → P1-3(文档入口) → P1-4(列表侧栏) → P1-5(颜色收口)
        （P1-5 可穿插任意阶段）
```

**明确不做（本期范围外）**：
- 消息流文字时间线、成本趋势卡（列入 P2，待 P0/P1 验收后另立计划）
- 后端 API 任何改动
- 引入 UI 组件库 / 主题切换 / 路由拆分

---

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| Tooltip 与 OrbitControls 拖拽冲突 | tooltip `pointer-events:none`，仅在静止 hover 时显示，拖拽中隐藏 |
| latest_activity 为空的老数据 | 渲染兜底"暂无活动记录" |
| 进度条在 requested_rounds=0 时除零 | 显示不确定态（动画条纹） |
| 每项独立 commit | 任一可 `git revert` 单独回滚 |

