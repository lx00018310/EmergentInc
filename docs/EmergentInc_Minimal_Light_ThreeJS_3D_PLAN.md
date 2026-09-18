# EmergentInc 最小修改 Plan
## Light Theme + Three.js 真 3D Crystal Lattice

> 基于当前 `main` 分支最新前端实现整理。  
> 本次目标只有两个：**暗色主题改为亮色主题**；**把当前 Canvas 2D Isometric 2.5D 地图替换为真正可旋转的 Three.js 3D Crystal Lattice**。  
> 其余功能和架构全部保持不动。

---

# 0. 修改边界

本次只允许修改前端。

**不修改：**

- Pixel 数据结构
- Tips 后端逻辑
- tips.md
- Tips 已读机制
- Agent
- Prompt
- Runtime
- Server API
- 数据库
- 能量机制
- 消息机制
- 六邻域规则
- App 页面结构
- PixelDetails 业务逻辑

现有：

```text
world
  ↓
App.tsx
  ↓
PixelMapCanvas
  ↓
PixelMapRenderer
```

继续保持。

唯一变化：

```text
PixelMapRenderer

CanvasRenderingContext2D
        ↓
Three.js WebGLRenderer
```

---

# 1. 本次修改文件

主要只改 4 个文件：

```text
frontend/package.json

frontend/src/features/pixels/
├── PixelMapRenderer.ts
└── PixelMapCanvas.tsx

frontend/src/styles/index.css
```

原则上：

```text
App.tsx
PixelDetails.tsx
frontend/src/api/*
```

全部不动。

如果 TypeScript 类型需要极小调整，可以修改，但不要扩散改造范围。

---

# 2. 依赖：只增加 three

修改：

```text
frontend/package.json
```

只新增：

```json
"three": "^0.x"
```

使用当前可安装稳定版本即可。

不要增加：

```text
@react-three/fiber
@react-three/drei
Plotly
ECharts
3d-force-graph
新的状态管理库
```

`OrbitControls` 直接从 Three.js 自带 examples 模块引入：

```ts
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
```

---

# 3. PixelMapCanvas.tsx：保持现有接口

当前 Props：

```ts
pixels
messageFlow
selectedPixelId
unreadTipsPixelIds
onSelectPixel
onHoverPixel
```

全部保留。

现有：

```tsx
<canvas ref={canvasRef} id="pixel-canvas" />
```

继续保留。

Three.js 直接使用这个 Canvas：

```ts
new THREE.WebGLRenderer({
  canvas,
  antialias: true
})
```

因此不需要改 React 页面结构。

---

# 4. PixelMapRenderer 保持 public API 不变

重写：

```text
frontend/src/features/pixels/PixelMapRenderer.ts
```

但保留当前公开方法：

```ts
constructor(...)
setData(...)
setSelectedPixel(...)
resize()
resetView()
zoomIn()
zoomOut()
dispose()
```

这样：

```text
PixelMapCanvas.tsx
```

基本不需要改业务调用。

---

# 5. 删除旧的 2.5D 绘制逻辑

删除或废弃：

```text
CanvasRenderingContext2D

project()

drawGrid()
drawZDropLine()
drawAxisHint()
drawPixelNode()
drawMessageFlow() 的 Canvas 版本
```

尤其删除：

```ts
screenX = (x - y) * CELL_X
screenY = (x + y) * CELL_Y - z * CELL_Z
```

因为本次不再做二维投影。

---

# 6. Three.js Scene 最小结构

`PixelMapRenderer` 内部只建立以下对象：

```text
WebGLRenderer
Scene
PerspectiveCamera
OrbitControls

pixelGroup
edgeGroup
messageGroup

GridHelper
AxesHelper
Raycaster
```

不要增加额外 Scene 框架。

初始化：

```ts
renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

背景：

```ts
scene.background = new THREE.Color(0xf7f8fa);
```

Camera：

```ts
PerspectiveCamera
```

建议：

```ts
fov = 45
near = 0.1
far = 1000
```

---

# 7. 世界坐标映射

EmergentInc 世界坐标：

```text
(x, y, z)
```

Three.js 默认 Y 是竖直方向。

统一映射：

```ts
function worldToScene(
  [x, y, z]: [number, number, number]
) {
  return new THREE.Vector3(
    x * SPACING,
    z * SPACING,
    y * SPACING
  );
}
```

即：

```text
World X → Three X
World Y → Three Z
World Z → Three Y
```

固定：

```ts
SPACING = 2.5
```

不要修改 Pixel 原始 position。

---

# 8. Pixel：真正的球

每一个 Pixel 使用：

```ts
THREE.SphereGeometry
THREE.MeshStandardMaterial
```

建议：

```ts
SphereGeometry(0.32, 24, 16)
```

所有 Pixel 共用一份 Geometry。

颜色：

```text
Active Pixel      蓝色
Dead Pixel        浅灰色
Unread Tips       黄色
```

建议：

```ts
ACTIVE_COLOR = 0x3b82f6
DEAD_COLOR   = 0xb8bec7
TIPS_COLOR   = 0xf2b01e
```

规则：

```ts
if (unreadTipsPixelIds.has(pixel.id))
    yellow
else if (pixel.active)
    blue
else
    gray
```

保持现有 Tips 行为完全不变。

---

# 9. 球体必须有光照

这是提升三维感的关键。

只加两种光：

```ts
AmbientLight
DirectionalLight
```

例如：

```ts
AmbientLight(0xffffff, 1.5)

DirectionalLight(0xffffff, 2.0)
position = (8, 12, 10)
```

目的：

让球产生明显：

```text
亮面
暗面
高光
```

不要增加复杂灯光系统。

---

# 10. 六邻域晶格连线

为了形成真正 Crystal Lattice 的空间感，使用现有：

```ts
pixel.neighbors
```

连接实际存在的邻居。

每条邻居边只画一次。

例如：

```ts
if (pixel.id < neighborId)
```

才创建 Line。

视觉：

```text
浅灰色
细线
低存在感
```

建议：

```ts
LineBasicMaterial({
  color: 0xcbd1d8,
  transparent: true,
  opacity: 0.6
})
```

形成：

```text
●────●
│   /
●──●
```

这是本次比 Z Drop Line 更重要的三维空间提示。

---

# 11. XY 地面

使用 Three.js：

```ts
GridHelper
```

世界：

```text
z = 0
```

对应 Three.js：

```text
Y = 0
```

所以 GridHelper 直接放：

```ts
position.y = 0
```

建议：

```text
浅灰色细网格
范围不用太大
```

根据当前 Pixel 世界范围动态设置，或者先固定：

```text
size = 30
divisions = 20
```

不要使用深色网格。

---

# 12. XYZ 坐标轴

直接使用：

```ts
AxesHelper
```

例如：

```ts
new THREE.AxesHelper(3)
```

不要再手动画二维方向图。

注意对用户的世界坐标语义：

```text
Three X = World X
Three Y = World Z
Three Z = World Y
```

如果界面需要文字说明，可以在 toolbar 简单写：

```text
Vertical = World Z
```

不要新增复杂标签系统。

---

# 13. 相机控制

使用：

```ts
OrbitControls
```

开启：

```ts
controls.enableDamping = true
controls.dampingFactor = 0.08

controls.enableRotate = true
controls.enableZoom = true
controls.enablePan = true
```

操作：

```text
左键拖动 → 旋转
滚轮     → 缩放
右键拖动 → 平移
```

真正解决当前：

```text
Z 轴和 XY 位置难以区分
```

的问题。

---

# 14. 默认视角

`resetView()` 不再重置 2D offset。

改为：

```text
斜上方三维视角
```

原则：

```text
同时能看到 X / Y / Z 三个方向
```

建议：

```ts
camera.position.set(8, 8, 8)
controls.target.set(0, 0, 0)
```

更好一点：

根据 Pixel 当前空间范围计算：

```text
bounding box
→ center
→ max dimension
→ 自动决定 camera distance
```

但不要做复杂 Camera Manager。

只需要一个简单 helper：

```ts
fitCameraToPixels()
```

---

# 15. zoomIn / zoomOut

保留现有 toolbar：

```text
+
-
重置视角
```

因此保留：

```ts
zoomIn()
zoomOut()
resetView()
```

实现方式：

以：

```ts
controls.target
```

为中心，缩短或放大 Camera 与 target 的距离。

不要调用未公开的 OrbitControls 私有 API。

---

# 16. Selection / Hover

当前：

```text
点击 Pixel
→ selectedPixelId
→ PixelDetails
```

必须保持。

使用：

```ts
THREE.Raycaster
```

在：

```text
pointermove
click
```

检测球体。

每个 Mesh：

```ts
mesh.userData.pixelId = pixel.id
```

点击：

```ts
onSelectPixel(pixelId)
```

Hover：

```ts
onHoverPixel(pixelId)
```

保持现有 React 逻辑不变。

---

# 17. 防止旋转后误点击

OrbitControls 拖动旋转时，不应该误触 Pixel 选择。

增加最简单的拖动阈值：

```text
pointerdown 记录位置
pointerup 比较距离

移动 > 4~5 px
→ 认为是旋转
→ 不触发 Pixel click
```

不要引入复杂 gesture 库。

---

# 18. Selected / Hover 视觉

不要改变 Pixel 本体颜色语义。

尤其：

```text
Unread Tips = 黄色
```

必须始终保留。

Selection：

```text
球放大约 1.25 倍
+
轻微 emissive
```

Hover：

```text
球放大约 1.1 倍
```

不要为了 selected 把黄色改成蓝色。

---

# 19. Pixel ID 标签：最小处理

当前 2D 地图每个 Pixel 都显示 ID。

真 3D 后如果给所有球一直挂文字，会明显增加视觉杂乱。

本版本改为：

```text
默认：不显示全部 ID

Hover：
显示当前 Pixel ID

Selected：
显示当前 Pixel ID
```

可以使用最简单的 DOM tooltip，定位在 Canvas 上方。

如果实现 tooltip 会明显扩大修改量，则本版本可以暂时只依赖：

```text
右侧 PixelDetails
```

显示 ID。

**不要为了标签引入 CSS2DRenderer。**

这是最小修改原则的一部分。

---

# 20. Message Flow

必须保留现有：

```text
latest_message_flow
```

但本版本先做最简单的 Three.js 表现：

```text
source ● ───── ● target
```

使用绿色 Line。

颜色：

```ts
0x22a447
```

不要立即恢复 Canvas 里的：

```text
弧线
dash animation
复杂流动粒子
```

这些属于视觉增强，不是本次必要目标。

以后需要再加。

---

# 21. Render Loop

Three.js 需要 animation loop，因为 OrbitControls damping 需要更新。

统一：

```ts
requestAnimationFrame
```

每帧：

```ts
controls.update()
renderer.render(scene, camera)
```

不要因为没有 Message Flow 就停止渲染。

---

# 22. setData() 最小策略

现有：

```ts
setData(
  pixels,
  messageFlow,
  selectedId,
  unreadTipsPixelIds
)
```

接口保持。

最简单实现：

每次 world polling 更新时：

```text
clear pixelGroup
clear edgeGroup
clear messageGroup
重新生成 Scene Objects
```

当前 Pixel 数量不大时完全足够。

不要现在就做：

```text
InstancedMesh
对象池
diff renderer
复杂缓存
```

只有未来出现几千个 Pixel 再优化。

---

# 23. dispose()

必须正确释放：

```text
OrbitControls
event listeners
requestAnimationFrame
Geometry
Material
Texture（如果有）
WebGLRenderer
```

尤其 React 组件卸载时不能留下：

```text
animation loop
pointer listener
WebGL context
```

---

# Part 2：亮色主题

# 24. 不做主题切换功能

本版本直接：

```text
Dark → Light
```

不要增加：

```text
Light / Dark toggle
系统主题检测
localStorage theme preference
```

这些都不是当前需求。

---

# 25. CSS 根变量直接改亮色

修改：

```text
frontend/src/styles/index.css
```

建议：

```css
:root {
  --bg-main: #f6f8fa;
  --bg-card: #ffffff;
  --bg-card-hover: #f3f4f6;

  --border-color: #d0d7de;

  --text-main: #24292f;
  --text-dim: #57606a;
  --text-bright: #1f2328;

  --accent-blue: #0969da;
  --accent-green: #1a7f37;
  --accent-yellow: #9a6700;
  --accent-red: #cf222e;
  --accent-purple: #8250df;
}
```

---

# 26. 修复当前硬编码暗色背景

当前 `index.css` 里仍有多个硬编码深色值，例如：

```text
#0d1117
#090d13
#0a0d12
#11151c
#21262d
```

全部检查。

优先替换成变量。

例如：

```text
#0d1117 → var(--bg-main) 或 #ffffff
#090d13 → #f6f8fa
#0a0d12 → #ffffff
#11151c → #f6f8fa
#21262d → #f3f4f6
```

目标：

不要出现：

```text
外部亮色
内部输入框/控制台仍是黑色
```

这种混搭。

---

# 27. Right Panel / Canvas 背景

当前：

```css
.right-panel {
  background-color: #0a0d12;
}
```

改成：

```css
background-color: #f7f8fa;
```

Canvas 的真实背景由：

```ts
scene.background
```

控制。

保持一致：

```text
#f7f8fa
```

---

# 28. PixelDetails 改为白色卡片

现有：

```css
.pixel-hover-card {
  background-color: rgba(22, 27, 34, 0.95);
  ...
}
```

改成：

```text
白色 / 接近白色
浅灰边框
轻阴影
```

例如：

```css
background: rgba(255,255,255,0.96);
border: 1px solid #d0d7de;
box-shadow: 0 8px 24px rgba(31,35,40,0.12);
```

Tips 黄色提醒逻辑不变。

---

# 29. pixel.md / tips.md 预览框

当前：

```text
黑底 + 绿色字
```

改为：

```text
浅灰背景
深色正文
```

例如：

```css
.pixel-md-preview {
  color: #24292f;
  background: #f6f8fa;
  border: 1px solid #d8dee4;
}
```

Tips 未读继续：

```text
黄色左边框
黄色提示文字
```

---

# 30. Console 保留“终端感”，但也改亮

不要因为叫 Console 就继续纯黑。

建议：

```text
背景 #f6f8fa
字体 #24292f
边框 #d0d7de
```

日志颜色继续使用：

```text
blue
green
yellow
red
```

这样全页面视觉统一。

---

# 31. Toolbar 标题修改

当前：

```text
3D 六邻域空间投影地图 (Isometric 2.5D)
```

改成：

```text
3D Crystal Lattice / 六邻域空间
```

因为已经不再是 Isometric 2.5D。

Legend 保留：

```text
Active
Dead
Unread Tips
Message Flow
```

---

# Part 3：明确不改

# 32. Tips 功能完全保持现状

现有：

```text
tips_md
tips_version
localStorage 已读
unreadTipsPixelIds
PixelDetails Tips
```

全部保留。

本次只把：

```text
unreadTipsPixelIds
```

用于 Three.js 球体材质：

```text
Unread → 黄色 Sphere
```

不要重新设计 Tips。

---

# 33. 不再保留 Z Drop Line

旧的：

```text
drawZDropLine()
```

删除。

因为真正 3D 中：

```text
球的位置
+
晶格连线
+
Grid
+
相机旋转
```

已经可以说明 Z 高度。

大量垂线反而会污染空间。

---

# 34. 不增加复杂视觉效果

本版本明确不要：

```text
Bloom
Post Processing
粒子特效
HDR
环境贴图
阴影系统
物理引擎
透明玻璃材质
复杂 Shader
动态呼吸光
动画摄像机
自动旋转
```

只需要：

```text
白底
球
线
网格
坐标轴
基础光照
自由旋转
```

---

# Part 4：验收

# 35. 必测坐标

准备：

```text
0_0_0
1_0_0
0_1_0
0_0_1
0_0_2
```

要求：

### 初始视角

能够明显看出：

```text
0_0_1
0_0_2
```

向上排列。

### 旋转视角

拖动鼠标后能明显看到：

```text
X
Y
Z
```

是三个真正不同的空间方向。

不能再出现：

```text
Z 轴 Pixel 和 XY 平面 Pixel 难以区分
```

---

# 36. Crystal Lattice 验收

画面应接近：

```text
                ●
               /│
          ●───● │
          │  /│ ●
          ●───●
```

而不是：

```text
二维斜投影圆点图
```

必须能够：

```text
旋转
缩放
平移
```

---

# 37. Tips 验收

现有 Tips 行为不得回归。

### 未读 Tips

```text
黄色球
```

### 点击标记已读

```text
黄色球 → Active 蓝色 / Dead 灰色
```

### Pixel 更新 Tips

```text
再次变黄色
```

不修改任何 Tips 后端逻辑。

---

# 38. Selection 验收

点击任意球：

```text
selectedPixelId 正确变化
PixelDetails 显示对应 Pixel
```

旋转世界：

```text
不会误触 Pixel 点击
```

---

# 39. Message Flow 验收

如果存在：

```text
latest_message_flow
```

则对应 Pixel 之间显示绿色连接。

本版本：

```text
静态绿色 Line
```

即可通过验收。

---

# 40. Light Theme 验收

页面中不应再出现大块：

```text
纯黑
深灰
GitHub Dark
```

整体：

```text
白 / 浅灰背景
深色文字
蓝色主状态
黄色提醒
绿色 Message Flow
```

Canvas 和页面其余区域风格一致。

---

# 41. 工程验收命令

执行：

```bash
cd frontend

npm install
npm run typecheck
npm run build
npm test
```

必须通过。

---

# 42. 最终目标

本次修改完成后，系统架构仍然是：

```text
React UI
   │
   ├── PixelDetails
   │
   └── PixelMapCanvas
            │
            ▼
      PixelMapRenderer
            │
            ▼
        Three.js
```

没有新的前端框架层。

最终视觉：

```text
亮色 UI

        Z
        ↑
        ●
       /│
  ●───● │
  │  /│ ●
  ●───●
     ↙   ↘
    Y     X
```

其中：

```text
蓝色球 = Active
灰色球 = Dead
黄色球 = Unread Tips
浅灰线 = 六邻域连接
绿色线 = Message Flow
```

这是本次需要达到的终态。

---

# 43. 本版本不要继续扩展

完成上述内容后停止。

不要顺手增加：

```text
R3F
主题切换
高级动画
粒子系统
3D 标签系统
Bloom
Shader
InstancedMesh
复杂 Camera Manager
新的后端接口
新的数据结构
新的 Tips 机制
```

当前任务只有：

```text
Dark → Light

2.5D Canvas
    ↓
True 3D Three.js Crystal Lattice
```

到此为止。
