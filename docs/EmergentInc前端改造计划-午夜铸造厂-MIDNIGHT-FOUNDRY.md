
# EmergentInc 前端改造计划：「午夜铸造厂 · MIDNIGHT FOUNDRY」

## 0. 关键事实校正（执行前必读）

1. **像素地图不是 2D canvas**，而是 `frontend/src/features/pixels/PixelMapRenderer.ts` 里的 **Three.js 3D 晶格**（球体节点 + 六邻域连线 + 贝塞尔曲线传递动画，OrbitControls 可旋转缩放）。这反而更适合"午夜城市"意象：每个球体是悬浮在暗色空间里的一盏灯/一个生命体。
2. **当前 `frontend/src/styles/index.css`（约 998 行）是浅色 GitHub 风主题**，不是深色。配色走 `:root` CSS 变量，但有**大量硬编码浅色值**（`#ffffff`、`#f6f8fa`、`rgba(255,255,255,0.97)` 等）散布在 tooltip、modal、输入框、表格等处。
3. `frontend/index.html` 的 `<title>` 当前是乱码（`V11 鈥?鍟嗕笟...`），需顺手修复。
4. 布局结构（`App.tsx`）：顶部 `RunStatus` 头部条 → 左侧栏（`RunControls` + `ConsolePanel`）→ 右侧 `PixelMapCanvas`（含 `.canvas-toolbar` 工具条 + canvas + 悬浮 `PixelDetails` 详情卡）+ 一堆 Modal。

## 1. 设计目标与成功标准

**氛围定义**：整个界面是一座深夜俯瞰的"智慧数字城市"。每个元胞是一粒有呼吸、有心跳的发光生命；消息传递是城市上空飞过的光之信使；周围 UI 全部降级为天文台式的深色仪器读数。

**验收 checklist（录屏视角）**：
- [ ] 首屏即沉浸：深近黑的蓝夜色背景（`#050914` 基调），带星云渐变 + 微星点，非纯色
- [ ] 3D 场景中球体**自发光**：低能量冷青色 → 高能量琥珀金，有光晕（halo），死亡元胞是暗淡的石青色"熄灭的楼"
- [ ] **细胞心跳**：某元胞能量变化时，从该球体荡开一圈扩散光波（录屏的核心记忆点）
- [ ] 所有球体带**微呼吸**缩放（每球随机相位），运行时城市是"活的"
- [ ] 消息传递管道改冷青色、飞行光点改暖金色
- [ ] 空场景也有氛围：星空粒子 + 暗色网格地面 + 缓慢自动环绕镜头
- [ ] UI 面板为深色玻璃仪表风（半透明、细描边、金色衬线标题 + 宽字距英文小标签 + 等宽数字青色发光）
- [ ] 无任何逻辑/接口改动；`npm run build`（或 `tsc -b` + `vite build`）通过

## 2. 全局设计 Token（写入 `:root`，替换现有浅色变量值）

```css
--bg-main:      #050914;   /* 午夜基底 */
--bg-card:      rgba(11, 19, 34, 0.78);  /* 仪器玻璃 */
--bg-card-hover: rgba(20, 32, 54, 0.9);
--border-color: rgba(122, 178, 214, 0.16); /* 冷青发丝线 */
--text-main:    #c9d6e8;
--text-dim:     #5d7186;
--text-bright:  #eef4fb;
--accent-blue:  #38e1ff;   /* 数据青光（原语义"主色/运行中"） */
--accent-green: #57e6a9;
--accent-yellow:#e8b04b;   /* 琥珀金 = 权威/警告 */
--accent-red:   #ff5a6e;
--accent-purple:#9d8cff;
--gold:         #f5c56b;   /* 新增：标题金 */
--font-display: "Noto Serif SC", "Songti SC", Georgia, serif;
--font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
```

## 3. 文件改动清单

### 文件 ① `frontend/src/styles/index.css`（最大工作量，纯样式）

**策略（重要，改动最小化）**：不要逐行重写 998 行。分两步：
1. 只改 `:root` 变量值（上方 token 表）。
2. 在**文件末尾追加一个 `/* ===== MIDNIGHT FOUNDRY OVERRIDE ===== */` 覆盖区**（约 250–350 行），利用层叠覆盖所有硬编码浅色，并新增氛围层。需覆盖的已知硬编码点（逐一处理）：
   - `body`：多层背景——`radial-gradient` 星云（顶部偏 `#0a1630`、底部沉到 `#03060d`）+ `::before` 伪元素星点（`background-image` 用多个 1px 径向白点随机平铺 + `animation: twinkle` 明灭）+ `::after` 四角暗角 vignette。
   - `.app-header`：深色玻璃 + 底部 1px 金色渐变发丝线（`linear-gradient(90deg, transparent, rgba(245,197,107,.5), transparent)`）。
   - `.app-header h1`：衬线金色（`--font-display` + `--gold` + 轻微 `text-shadow` 金光）；`.badge`：改黑底金边等宽字体。
   - `.metric-item .m-val`：等宽字体 + `--accent-blue` + `text-shadow: 0 0 8px rgba(56,225,255,.45)`（仪表发光数字）；`.m-label` 缩小、宽字距、大写、dim 色。
   - `.panel-card`：`--bg-card` + `backdrop-filter: blur(8px)` + 1px 发丝边 + 内阴影；`.panel-header h2` 加宽字距小写英文感（`letter-spacing: .12em`）。
   - `.btn` 系列：默认幽灵款（透明底 + `--border-color` 描边 + 浅色字）；`.btn-primary` 改**黄铜金**渐变（`linear-gradient(180deg,#e8b04b,#a97a2a)` + 深色文字）；`.btn-danger` 保留红但去白底实色感；hover 加青色微光 `box-shadow`。
   - 所有输入框：`.command-input-group input`、`.text-input`、`.modal-textarea`、`.operation-section input` → 深底 `#0a1220` + 浅字 + focus 时青色描边 + 外发光。
   - `.console-box`：深近黑 `#04070f`，`.system-line/.info-line/...` 五色改用 token（形成"电报带"荧光感），可选加极淡 scanline 背景纹理。
   - `.run-progress-bar/.run-progress-fill`：轨道深色，填充改青色渐变发光条。
   - `.canvas-toolbar`：深色玻璃；`.canvas-container` 加**内圈暗角** `box-shadow: inset 0 0 120px rgba(0,0,0,.55)` 和四角取景器括弧（用 `.canvas-container::before/::after` 或给容器加两组线性渐变角标）——这是"观测仪器"感的关键。
   - `.canvas-legend .dot`：`.active-dot` 改青色发光点、`.inactive-dot` 改暗石灰、`.flow-line-legend` 改金色。
   - 悬浮/弹层类全部暗化：`.pixel-hover-card`、`.pixel-tooltip`、`.pixel-list-panel`（含 `.pixel-list-row:hover/.selected`）、`.pixel-md-preview`、`.doc-view-box`、`.data-table th`、`.modal-content/.modal-header`、`.owner-chat-message(.user/.assistant)`、`.alert-box`、`.context-guide` 链接色等——统一深玻璃底 + 浅字 + 发丝边。
   - `.run-status-indicator.running/.stopped/.error`：改深色底 + 对应色描边 + 对应色发光文字。
   - 滚动条：`::-webkit-scrollbar` 深色细条。

### 文件 ② `frontend/src/features/pixels/PixelMapRenderer.ts`（氛围核心，仅表现层）

现有结构：`constructor`（场景/灯光/GridHelper/AxesHelper/选择环）、`setData()` → `rebuildSceneObjects()`（重建球体+边）、`processMessageFlows()`（传递动画）、`startAnimationLoop()`（每帧）。改动点：

1. **场景氛围**（constructor 内）：
   - `scene.background = new THREE.Color(0x050914)`；加 `scene.fog = new THREE.FogExp2(0x050914, 0.028)`。
   - 灯光重调：环境光改暗冷（`AmbientLight(0x33445e, 0.7)`），主方向光改月光蓝（`0x8fb8ff, 1.2`），新增一盏低角度暖色 `PointLight(0xf5c56b, 0.6)` 制造冷暖对比。
   - `GridHelper` 颜色改 `(0x1c3a52, 0x0d1c2e)`；**删除 AxesHelper**（出戏）。
   - 新增**星空**：`THREE.Points`（约 400 点，大半径球壳分布，`PointsMaterial({ color:0x8fb8ff, size:0.06, transparent, opacity:.7, depthWrite:false })`），随场景静止即可。
   - 开启 `controls.autoRotate = true; autoRotateSpeed = 0.4`；监听 `controls.addEventListener('start', ...)` 暂停自动旋转，空闲 6 秒后恢复（录屏时城市缓慢自转）。
2. **配色常量**替换：`ACTIVE_COLOR→0x38e1ff`、`DEAD_COLOR→0x3a4656`、`TIPS_COLOR→0xf5c56b`、`EDGE_COLOR→0x16324a`（opacity 0.35）、`FLOW_COLOR→0x2fd4ff`、`PACKET_COLOR→0xffcf6b`、`SELECTION_RING_COLOR→0xffc861`。
3. **能量发光球**（`rebuildSceneObjects` 内球体材质段，现 547–554 行附近）：
   - 活跃元胞颜色改为**按能量归一化在青色 `0x38e1ff` → 金色 `0xffb545` 间 lerp**（用 `THREE.Color.lerpColors`）；`emissive` 设为同色、`emissiveIntensity = 0.5 + 1.3 * energyNorm`；`roughness 0.25, metalness 0.1`。
   - 死亡元胞：`0x3a4656`、无 emissive、opacity 0.35。
   - 每个活跃球体旁挂一个 **halo sprite**：`THREE.Sprite` + 程序生成的径向渐变 `CanvasTexture`（中心白→透明），`AdditiveBlending`、`depthWrite:false`，颜色同球体，`scale` 随 energyNorm（约 `0.9 + 1.6*energyNorm`）——这是"每粒像素是发光生命"的核心。
   - 在 `mesh.userData` 存 `baseScale`（当前 nodeScale 值）与 `phase`（用 pixelId hash 出的 0–2π 随机相位），供呼吸动画用。
4. **呼吸动画**（`startAnimationLoop` 内新增第 3 步）：遍历 `pixelGroup.children`，`mesh.scale.setScalar(baseScale * (1 + 0.05 * sin(time*0.002 + phase)))`；halo sprite 的 `material.opacity` 同步轻微起伏。**注意**：球体在每次 `setData` 时整体重建，`userData.baseScale/phase` 必须在重建时写入，动画循环只读取、缺失则跳过。
5. **细胞心跳脉冲**（核心记忆点）：
   - 类里新增 `private prevEnergies = new Map<string, number>()` 与 `private pulses: Array<{mesh: THREE.Mesh, startTime: number}>`。
   - `setData()` 里对比新旧 energy：变化的元胞在其位置生成一个脉冲环——`RingGeometry(0.3, 0.36, 48)` + `MeshBasicMaterial({ color: 能量升高用0x7df0ff / 降低用0xff9a5a, transparent, side:DoubleSide, depthWrite:false })`，billboard 朝向相机，推入 `pulses`。首次 `setData`（`isFirstDataCall`）不触发。
   - 动画循环第 4 步：每个 pulse 生命周期约 900ms，`scale` 从 1→4、`opacity` 从 0.8→0，结束即 dispose 并移除；并发上限 ~12 个，超出丢弃最旧。
   - `dispose()` 中记得清理 pulses 的几何体与材质。
6. **传递管道观感**：现有 `flowMaterial`/`PACKET_COLOR` 换色即可；飞行光点可加大到 0.06 并配 halo sprite（可选增强）。
7. **相机初始角度**：`fitCameraToPixels` 的 direction 改略低角度（如 `(1, 0.55, 1)`），营造"俯瞰夜景天际线"感而非正俯视。

**红线**：不改 `setData` 签名、不改选中/hover/拾取逻辑、不改传递曲线算法，只动颜色、材质、灯光与新增的装饰性对象。

### 文件 ③ `frontend/src/features/run/RunStatus.tsx` + `App.tsx` + `index.html`（轻量 JSX）

- `index.html`：修复乱码 title → `EmergentInc 元胞会社 · MIDNIGHT FOUNDRY`；`<head>` 加 Google Fonts 链接（`Noto Serif SC` + `JetBrains Mono`，可附 `display=swap`；离线环境有 fallback 字体栈，不影响运行）。
- `RunStatus.tsx` 的 header 改为标题组：
  ```jsx
  <div className="logo-title">
    <span className="logo-icon">◈</span>
    <h1>EmergentInc <span className="logo-cn">元胞会社</span></h1>
    <span className="logo-sub">MIDNIGHT FOUNDRY // CELLULAR SOCIETY OBSERVATORY</span>
    <span className="badge" id="run-badge">run: {runId}</span>
  </div>
  ```
  （`.logo-cn` 金色衬线、`.logo-sub` 宽字距 10px 大写 dim 色，样式写入 CSS 覆盖区。）
- `App.tsx`：**结构不动**。仅右侧 map section 的内联 `style={{ flex:1, ... }}` 改为 `className="map-hero"` 并在 CSS 定义；可选在 `.canvas-toolbar` 的 `.toolbar-title` 文案 `3D 晶格` → `活体晶格 · LIVING LATTICE`（在 `PixelMapCanvas.tsx` 115 行）。
- 其余组件（ConsolePanel、PixelDetails、Modal 群）**零 JSX 改动**，全靠 CSS 覆盖区换装。

## 4. 明确不做的事

- 不引入新依赖（three 已在用；不装 postprocessing/bloom 库——halo sprite + emissive 已足够，避免构建风险）。
- 不动任何 API、状态、轮询、交互逻辑；不改组件 props。
- 不删除现有 CSS 规则，只改 `:root` 变量 + 末尾追加覆盖区（可回滚）。

## 5. 实施顺序与验证

1. `index.html` + `RunStatus.tsx`（5 分钟，先立住标题气质）
2. `index.css` `:root` + 覆盖区（刷新即见整体暗化）
3. `PixelMapRenderer.ts` 场景/灯光/星空/配色（城市夜景成型）
4. 渲染器 halo + 呼吸 + 心跳脉冲（注入"生命"）
5. 验证：`cd frontend && npm run build` 通过；`npm run dev` 目检——暗色无白块闪烁、球体发光、能量变化时有扩散环、拖拽旋转/点击选中/hover tooltip/列表切换/弹窗均正常、Console 无新报错。
6. 录屏 checklist 对照第 1 节逐项打勾。

**已知风险与对策**：①球体每次 `setData` 全量重建，呼吸相位若用 `Math.random()` 会每帧跳变——必须由 pixelId 字符串 hash 生成确定性相位；②halo sprite 过多时注意 `depthWrite:false` 避免排序闪烁；③`backdrop-filter` 在低配机器可降级，不影响功能。
