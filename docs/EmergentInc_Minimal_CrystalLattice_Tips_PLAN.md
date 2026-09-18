# EmergentInc 最小改造 Plan
## Crystal Lattice 圆点可视化 + Pixel tips.md

> 目标：在满足当前需求的前提下，尽量复用现有架构，不做无必要重构。

---

# 0. Review 结论

上一版 Plan **不是最小更改**，主要过度设计在：

1. 为 3D 界面引入 `three / @react-three/fiber / drei`，并重写整个 Renderer。
2. 为 Tips 已读状态增加后端文件、GET/POST API 和服务端 Hash 管理。
3. 新增独立 `UPDATE_TIPS` Effect。
4. 自动把六邻域 Tips 注入所有 Pixel Prompt。
5. 增加 Tips 分类、长度限制等当前没有明确需要的机制。

本版全部收敛。

本次只完成两个最小闭环：

```text
A. 现有 Canvas 2D 等轴投影
   方块 → 圆点 Crystal Lattice
   + Z 高度辅助线
   + XYZ 方向提示

B. 每个 Pixel 增加 tips.md
   Pixel 可更新 Tips
   UI 直接显示 Tips
   未读 Tips → 黄色圆点
   用户标记已读 → 恢复正常颜色
   Tips 内容再次变化 → 再次黄色
```

不修改：

- Pixel 坐标规则
- 六邻域规则
- 消息机制
- 繁殖规则
- 能量规则
- 数据库架构
- World 核心规则
- 现有 React 页面总体结构

---

# Part 1：Crystal Lattice 最小视觉改造

## 1. 保留现有 PixelMapRenderer

继续使用：

```text
frontend/src/features/pixels/PixelMapRenderer.ts
frontend/src/features/pixels/PixelMapCanvas.tsx
```

继续使用现有 Canvas 2D 与等轴投影：

```ts
screenX = (x - y) * CELL_X + offsetX
screenY = (x + y) * CELL_Y - z * CELL_Z + offsetY
```

**不要引入：**

```text
three
@react-three/fiber
@react-three/drei
Plotly
ECharts GL
3d-force-graph
```

原因：

当前目标只是让空间关系更容易看懂，并把立方体改成 Crystal Lattice / Atomic Lattice 风格。

没有必要为此重写整个渲染层。

---

## 2. 方块改成圆点

将当前：

```text
drawPixelCube()
```

改为：

```text
drawPixelNode()
```

每个 Pixel 直接画圆：

```ts
ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
```

视觉规则：

```text
Active        蓝色圆点
Dead          灰色圆点
Unread Tips   黄色圆点
Selected      外圈高亮
Hover         轻微外圈
```

不要再画：

- 顶面
- 左面
- 右面
- 立方体阴影

目标视觉：

```text
        ●
        │
    ●───●───●
       /
      ●
```

即简单 Atomic / Crystal Lattice。

---

## 3. 解决 Z 轴难辨识的问题

这是本次 3D 视觉改造的重点。

对于所有：

```text
z != 0
```

的 Pixel，从其实际位置画一根淡色虚线到：

```text
(x, y, 0)
```

即：

```text
        ●  Pixel (x,y,z)
        │
        │
        ○  投影位置 (x,y,0)
────────┼──────── z=0 网格
```

实现方式：

```ts
const center = project(x, y, z)
const ground = project(x, y, 0)
```

然后画：

```text
center → ground
```

要求：

- 线细
- 低透明度
- 不抢视觉
- ground 可以画很小的空心圆，也可以只画线

这样不需要真正可旋转 3D，也能直接判断某个 Pixel 是否位于 Z 轴高度上。

---

## 4. 保留现有 XY 网格

继续使用当前：

```text
drawGrid()
```

不要重构。

只需要让网格明确代表：

```text
World Z = 0
```

即可。

可在角落增加简单文字：

```text
Z=0 Plane
```

---

## 5. 增加 XYZ 方向提示

不需要完整 Three.js 坐标轴。

在 Canvas 左下角或固定位置增加小型方向指示：

```text
      Z ↑
       /
Y ↙   •   ↘ X
```

或者根据当前等轴投影方向正确绘制三条短轴。

目的只是让用户知道：

```text
哪个方向是 X
哪个方向是 Y
哪个方向是 Z
```

不要增加复杂坐标刻度。

---

## 6. 六邻域连接

如果当前界面已有结构连线逻辑则保留。

如果没有，不要求本次新增完整六邻域晶格连线。

本次最小要求只有：

```text
圆点
+
Z 投影辅助线
+
XY 网格
+
XYZ 方向提示
```

消息流 `latest_message_flow` 按当前逻辑继续显示。

---

# Part 2：tips.md

## 7. 每个 Pixel 增加 tips.md

目录：

```text
live/pixels/<pixelId>/
├── state.json
├── pixel.md
├── tips.md
└── mandate.md
```

`t ips.md` 的语义：

```text
Pixel 当前希望外界注意的信息。
```

例如：

```markdown
当前任务缺少必要资料。

需要 Owner 检查 xxx 文件。
```

注意：

```text
pixel.md   = Pixel 的长期心智
message_md = 已有的一次性 Pixel 消息
tips.md    = Pixel 当前公开挂出的提醒
```

---

# Part 3：让模型能够更新 tips.md

## 8. AgentDecision 增加 tips_md

修改：

```text
packages/protocol/src/types/decision.ts
```

增加：

```ts
tips_md?: string | null;
```

模型输出允许：

```json
{
  "pixel_md": "...",
  "tips_md": "...",
  "send_to": "...",
  "message_md": "..."
}
```

---

## 9. PromptBuilder 增加最少说明

修改：

```text
packages/model/src/prompt/prompt_builder.ts
```

在模型输出协议中说明：

```text
tips_md 是你的公开提醒。

只有当存在值得外界注意的信息时才写入。
没有需要提醒的内容时返回空字符串。
普通思考、普通日志不要写入 tips_md。
```

不要增加复杂 Tips 分类或优先级。

---

## 10. Parser 支持 tips_md

修改：

```text
packages/model/src/parser/response_parser.ts
```

增加 `tips_md` 解析。

要求：

- 模型明确返回字符串：使用新内容。
- 模型明确返回 `""`：表示清空 Tips。
- 模型没有返回 `tips_md`：保留原有 Tips。

因此 `parseAndNormalizeResponse()` 增加一个参数：

```ts
fallbackTipsMd
```

最终：

```ts
tips_md = rawData 中存在 tips_md
  ? String(rawData.tips_md)
  : fallbackTipsMd
```

注意：

**空字符串不能被当作“缺失”。**

---

# Part 4：不要新增 UPDATE_TIPS Effect

## 11. 复用现有 UPDATE_MIND

这是相较上一版 Plan 最大的简化之一。

现有链路已经是：

```text
Model
↓
AgentDecision
↓
DecisionCompiler
↓
UPDATE_MIND
↓
EffectRuntime
↓
pixel.md
```

不要再增加：

```text
UPDATE_TIPS
```

而是扩展现有：

```text
UpdateMindEffect
```

增加：

```ts
tipsContent?: string;
```

---

## 12. DecisionCompiler

修改：

```text
packages/runtime/src/compiler/decision_compiler.ts
```

生成 `UPDATE_MIND` 时同时带上：

```ts
content: decision.pixel_md,
tipsContent: decision.tips_md
```

`payloadHash` 应包含：

```text
pixel_md
+
tips_md
```

保证 Exactly-Once 语义仍然覆盖本次完整心智更新。

---

## 13. EffectRuntime

修改：

```text
packages/runtime/src/effects/effect_runtime.ts
```

现有：

```text
applyUpdateMind()
```

继续写：

```text
pixel.md
```

同时：

如果：

```ts
tipsContent !== undefined
```

则检查当前：

```text
tips.md
```

只有当内容真的发生变化时才执行：

```text
writeFileSync(tips.md)
```

即：

```ts
if (oldTips !== newTips) {
    writeFileSync(...)
}
```

这样：

- Tips 没变时不会反复改文件
- Tips 修改时间可以真实反映内容变化
- 不新增 Effect 类型
- 不新增额外事务流程

---

# Part 5：AgentStepRunner

## 14. 在当前 Step 中读取自己的 tips.md

修改：

```text
packages/runtime/src/agent_step/agent_step_runner.ts
```

读取：

```text
live/pixels/<pixelId>/tips.md
```

得到：

```ts
currentTipsMd
```

然后调用：

```ts
parseAndNormalizeResponse(
    rawText,
    pixelMind,
    currentTipsMd
)
```

即可。

不要在本版本自动读取整个世界 Tips。

---

# Part 6：新 Pixel

## 15. 繁殖时创建空 tips.md

当前：

```text
applyReproduce()
```

创建：

```text
pixel.md
```

同时增加：

```text
tips.md
```

初始内容：

```text
""
```

即可。

不要增加额外数据库字段。

---

# Part 7：World API

## 16. WorldService 直接读取 Tips

修改：

```text
apps/server/src/services/world_service.ts
```

当前扫描：

```text
pixel.md
state.json
artifacts
```

同时读取：

```text
tips.md
```

返回到 `PixelSummaryDto`：

```ts
tips_md: string;
tips_version: string;
```

其中：

```text
tips_version
```

不需要 Hash。

直接使用文件的：

```text
mtimeMs
```

转字符串即可。

例如：

```ts
tips_version = String(fs.statSync(tipsFile).mtimeMs)
```

如果：

```text
tips.md 不存在
```

则：

```ts
tips_md = ""
tips_version = ""
```

这样服务端只负责告诉前端：

```text
当前 Tips 内容是什么
当前 Tips 版本是什么
```

服务端完全不管理“已读”。

---

# Part 8：前端已读状态——只用 localStorage

## 17. 不新增后端已读 API

删除上一版设计中的：

```text
live/operator/tips_read.json

GET /pixels/:id/tips

POST /pixels/:id/tips/read
```

全部不需要。

因为“已读”只是当前 Owner UI 的显示状态，不属于 Pixel 世界真值。

直接由浏览器：

```text
localStorage
```

保存即可。

---

## 18. localStorage 规则

Key：

```text
emergentinc.tips.read.<pixelId>
```

Value：

```text
tips_version
```

判断：

```ts
const unread =
    pixel.tips_md.trim() !== '' &&
    localStorage.getItem(key) !== pixel.tips_version
```

因此：

### 新 Tips

```text
Tips Version = 100
Local Read Version = 90

→ unread
```

### 点击已读

```text
Local Read Version = 100

→ read
```

### Pixel 修改 Tips

```text
Tips Version = 110
Local Read Version = 100

→ unread again
```

完全不需要后端 Hash 文件。

---

# Part 9：Frontend DTO

## 19. PixelSummaryDto

修改：

```text
frontend/src/api/types.ts
```

增加：

```ts
tips_md: string;
tips_version: string;
```

不需要：

```text
tips_has_content
tips_unread
```

这些都属于前端可以直接计算出来的派生状态。

避免 DTO 冗余。

---

# Part 10：PixelDetails

## 20. 右侧框直接显示 Tips

修改：

```text
frontend/src/features/pixels/PixelDetails.tsx
```

在 `pixel.md` 概要附近增加：

```text
Tips
────────────────────
当前 Tips 内容……

[标记已读]
```

要求：

### Tips 为空

显示：

```text
暂无提醒
```

### Tips 非空且未读

显示：

```text
● 新提醒

Tips 内容……

[标记已读]
```

### Tips 已读

显示：

```text
Tips 内容……

已读
```

内容直接显示，不需要再打开 Modal。

区域过长可以滚动。

---

# Part 11：App 管理已读状态

## 21. 在 App.tsx 中维护最少状态

`App.tsx` 已经负责：

```text
world
selectedPixel
PixelMapCanvas
PixelDetails
```

因此已读逻辑直接放在这里即可。

增加一个简单的：

```ts
tipsReadRevision
```

或者：

```ts
readTipsVersions
```

状态，用于在点击“标记已读”后触发 React 重渲染。

提供：

```ts
isTipsUnread(pixel)
markTipsRead(pixel)
```

然后分别传给：

```text
PixelMapCanvas
PixelDetails
```

不要创建新的全局 Store。

---

# Part 12：3D 图中的黄色提醒

## 22. PixelMapRenderer 接收 unread 状态

最小方式：

在传入 Renderer 的 Pixel 数据上计算：

```text
tips_unread
```

或者额外传：

```ts
unreadTipsPixelIds: Set<string>
```

推荐第二种，避免修改服务端 DTO。

渲染逻辑：

```ts
if (unreadTipsPixelIds.has(pixel.id)) {
    color = yellow
} else if (pixel.active) {
    color = blue
} else {
    color = gray
}
```

Selected / Hover 用描边表示。

不要让 Selected 覆盖黄色主体。

这样黄色始终代表：

```text
有尚未阅读的 Tips
```

---

# Part 13：关于“提醒其他 Pixel”

## 23. 本版本不要自动广播 Tips

为保持最小修改，本版本：

```text
tips.md
```

作为 Pixel 的公开公告内容存在。

但**不要**自动：

- 注入所有邻居 Prompt
- 广播全世界
- 创建消息
- 创建 Tips 消息总线

Pixel-to-Pixel 的主动通知仍然使用现有：

```text
send_to
message_md
```

即：

```text
tips.md    → 对世界公开挂出的状态/提醒
message_md → 主动发给指定 Pixel
```

这避免改变现有消息系统。

如果后续确认 Pixel 需要主动读取邻居 Tips，再单独增加“Neighbor Tips Local View”，不要在本版本提前实现。

---

# Part 14：API Document Allowlist

## 24. 可选的小改动

现有：

```text
GET /pixels/:pixel_id/document/:doc_name
```

已经支持：

```text
pixel.md
state.json
environment.md
mandate.md
```

可以顺手加入：

```text
tips
tips.md
```

这样未来需要打开完整 Tips 文档时可以复用现有文件预览机制。

这属于很小的兼容性改动。

但右侧框展示 Tips **不依赖此 API**，因为 `/world` 已经返回 `tips_md`。

---

# Part 15：实际修改文件范围

本次预计只需要修改以下文件。

## Runtime / Model

```text
packages/protocol/src/types/decision.ts
packages/protocol/src/types/effect.ts

packages/model/src/parser/response_parser.ts
packages/model/src/prompt/prompt_builder.ts

packages/runtime/src/agent_step/agent_step_runner.ts
packages/runtime/src/compiler/decision_compiler.ts
packages/runtime/src/effects/effect_runtime.ts
```

## Server

```text
apps/server/src/services/world_service.ts
apps/server/src/routes/api_routes.ts   # 仅增加 document/tips allowlist，可选
```

## Frontend

```text
frontend/src/api/types.ts

frontend/src/App.tsx

frontend/src/features/pixels/
├── PixelMapCanvas.tsx
├── PixelMapRenderer.ts
└── PixelDetails.tsx
```

不新增 3D 框架。

不新增数据库表。

不新增后端 Tips Service。

不新增 Tips Controller。

不新增全局状态库。

---

# Part 16：必须测试的最小场景

## A. Crystal Lattice

准备：

```text
0_0_0
1_0_0
0_1_0
0_0_1
0_0_2
```

验收：

```text
所有 Pixel 都是圆点。

0_0_1、0_0_2 有明显 Z 高度辅助线。

能够直接区别：
0_0_2
与
x/y 平面上的其他 Pixel。
```

---

## B. Tips 写入

Pixel 输出：

```json
{
  "tips_md": "需要 Owner 检查数据源。"
}
```

结果：

```text
live/pixels/<id>/tips.md
```

内容正确。

---

## C. 未读

Tips 新增后：

```text
Pixel → 黄色
```

点击 Pixel：

右侧：

```text
需要 Owner 检查数据源。
```

点击：

```text
标记已读
```

结果：

```text
黄色 → 正常颜色
```

---

## D. 再次修改

Pixel 将 Tips 改为：

```text
数据源问题已确认，还需要检查 API。
```

因为：

```text
tips_version
```

发生变化：

```text
Pixel 再次变黄色
```

---

## E. 清空

Pixel 输出：

```json
{
  "tips_md": ""
}
```

结果：

```text
tips.md 清空
Pixel 不再黄色
右侧显示“暂无提醒”
```

---

# Part 17：最终验收标准

最终只需要达到下面这个闭环：

```text
Pixel 运行
   │
   ├── 更新 pixel.md
   │
   └── 有重要提醒时更新 tips.md
                │
                ↓
          /world 读取 Tips
                │
                ↓
        UI Crystal Lattice
                │
         未读 → 黄色 ●
                │
            点击 Pixel
                │
                ↓
        右侧直接看到 Tips
                │
          [标记为已读]
                │
                ↓
          恢复普通颜色
```

视觉：

```text
              ●
              │
          ●───●───●
             /
            ●

蓝色 ● = Active
灰色 ● = Dead
黄色 ● = Unread Tips
```

---

# 18. 本版本明确不做

本次不要顺手增加：

```text
Three.js
真正自由旋转 3D
Tips 后端已读数据库
Tips read API
Tips 分类
Tips 优先级
Tips 历史记录
Tips 时间线
Tips 通知中心
Tips 全世界广播
Tips 自动注入邻居 Prompt
复杂动画
新的状态管理库
```

如果未来现有 Canvas 方案在 Pixel 数量增加后仍无法满足空间观察，再独立做真正 Three.js 3D。

当前版本先以最小成本解决：

```text
1. 方块难看
2. Z 高度难判断
3. Pixel 缺少公开提醒出口
4. Owner 无法快速识别哪些 Pixel 有新提醒
```

到此为止。
