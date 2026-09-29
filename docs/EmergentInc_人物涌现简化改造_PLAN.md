# EmergentInc 人物涌现简化改造 Plan

> 目标：把现有“系统先设计完整人物”的模式，改成“只给人物一个不可变的出生差异，后续身份全部由经历形成”。
>
> 原则：**最小改动，不重写 Runtime / Pixel / SQLite / Chat 主链，不提前建设复杂子 Agent 平台。**

---

## 0. 最终产品形态

前台只保留四类显性对象：

```text
人物
├─ 对话
├─ 会议
├─ 经历 / 文件
└─ 需要用户批准的请求
```

后台继续保留现有复杂能力：

```text
Pixel / Runtime / Scheduler / Effects / Tools / Model / SQLite / Token / GitHub / Web ...
```

这些后台机制不再作为人物“设定”展示给用户。

核心原则：

> 先天只决定“初始差异”，后天全部靠真实对话、任务、文件和经历沉淀。

---

# 阶段 1：把“人设”收缩成不可变命核

## 1.1 新人物出生流程

替换当前随机八维属性、稀有度、职业模板等人物生成逻辑。

新流程：

```text
创建人物
  ↓
生成 birthSeed
  ↓
由 birthSeed 生成卦象
  ↓
生成一段受严格限制的 birthText
  ↓
保存为不可修改的命核
  ↓
人物进入可对话状态
```

### 随机源

TypeScript 使用：

```text
birthSeed = 高精度时间值 XOR crypto.randomBytes()
```

建议实现：

- `process.hrtime.bigint()`
- `crypto.randomBytes(8)`
- 使用 `BigInt` 运算
- 数据库存为字符串，避免 JS Number 精度问题
- 保存 `birthAlgorithmVersion`

### 卦象映射

从同一个 `birthSeed` 稳定推导：

```text
上卦：0~7
下卦：0~7
动爻：1~6
```

形成：

```text
本卦
动爻
变卦
```

必须保证：

> 同一个 birthSeed 永远得到同一个卦象。

不要引入更多命理参数、年月日解释、五行评分等新系统。

---

## 1.2 birthText 约束

`birthText` 是人物唯一的初始文字。

要求：

- 中文 50～100 字
- 只根据本卦、动爻、变卦生成
- 描述“倾向、张力、取舍方式”
- 不定义职业
- 不定义技能
- 不写履历
- 不写成功/失败结论
- 不生成 MBTI、人格标签、八维属性
- 不把人物锁定成固定性格
- 不出现“你必须……”“此人天生……”等强设定表达

示例：

```text
水山蹇 · 六二 · 水地比

前路常先见阻力，遇事更倾向观察路径而非直接硬进。
关系与协作可能成为破局入口，但真正的方向仍需在经历中形成。
```

模型生成失败时允许使用本地简短模板兜底，不得因此导致人物创建失败。

---

## 1.3 新人物最小数据结构

目标结构：

```ts
interface QianjiIdentity {
  qianjiId: string;
  displayName: string;

  birthSeed: string;
  birthAlgorithmVersion: 1;

  primaryHexagram: string;
  movingLine: number;
  changedHexagram: string;
  birthText: string;

  createdAt: number;
}
```

人物出生后，以上字段除 `displayName` 外全部不可修改。

### 后天内容不进入 Identity

以下内容全部通过现有历史系统自然沉淀：

- 对话
- 文件
- Artifact
- 任务
- 模型调用
- 工具使用
- 成本
- 工作结果
- 经历
- 后续形成的能力与偏好

---

# 阶段 2：移除前台“强人设”，改为 Chat First

## 2.1 当前需要退出主流程的内容

逐步停止使用：

```text
GACHA_ATTRIBUTE_KEYS
谋 / 察 / 决 / 行 / 言 / 创 / 韧 / 学
N / R / SR / SSR
pity / guaranteed
traitTags
skillTags
behaviorProfile
flaw
roleLabel 强绑定
appointed 人设扩写
GitHub 人设生成
复杂 shortBio
```

### 注意

第一版**不要立即删除所有数据库旧字段和旧表**。

采用：

> 新逻辑不再读写 → UI 不再展示 → 测试确认稳定 → 后续单独清理。

避免一次性迁移造成大面积破坏。

---

## 2.2 现有代码重点修改

### `packages/protocol/src/types/qianji.ts`

- 增加命核字段
- 减少新流程对 `QianjiNarrativeSpec` 的依赖
- 旧字段先兼容保留，标记 legacy
- 新 API 默认只返回必要人物信息

### `apps/server/src/services/gacha_service.ts`

当前职责过重，应收缩。

保留“招募/生成人物”入口，但内部改成：

```text
create seed
→ derive hexagram
→ generate birthText
→ create Qianji
```

停止新建：

- rarity
- attributes
- traitTags
- skillTags
- GitHub 人设
- appointed 完整人设

**暂时不要为了命名好看重构整个 gacha 模块。**
先允许内部文件仍叫 `gacha_service.ts`，等逻辑稳定后再决定是否改名为 `recruit_service.ts`。

### `apps/server/src/services/qianji_service.ts`

保持 Pixel Binding 机制。

人物与 Pixel 的关系继续存在：

```text
Qianji = 人
Pixel = 当前运行载体
```

不要重写这一层。

### Persistence

新增命核字段即可。

优先使用现有 Qianji 表 / Repository。

不要新建一整套人格数据库。

---

# 阶段 3：前端只让用户看到“人”

## 3.1 人物卡

`QianjiCard` 收缩到：

```text
头像
姓名
本卦 → 变卦
最近状态 / 最近活动
```

不要显示：

- 稀有度
- 八维雷达
- 职业模板
- trait
- skill tag
- 成长数值

---

## 3.2 人物详情

当前：

```text
对话
经历与交付物
人设与图片
```

改为：

```text
对话
经历
出生
```

### 对话

保留当前 `QianjiChatPanel` 作为第一核心入口。

后续人物的大部分“成长”都通过真实对话和任务发生。

### 经历

继续复用现有：

- 模型调用
- Artifact
- 成本
- 完成任务
- 历史载体

但 UI 要从“系统审计表”逐步变成人类可读的履历。

第一版不用重做数据，只简化展示。

### 出生

替代 `QianjiNarrativeEditor`。

只读显示：

```text
出生时间
本卦
动爻
变卦
birthText
```

除姓名、头像外，不允许编辑命核。

---

# 阶段 4：增加最小“多人会议”

这是本轮唯一值得新增的明显功能。

## 4.1 用户体验

```text
+ 发起会议
```

选择人物：

```text
☑ 林默
☑ 阿策
☑ 小满
```

输入：

```text
讨论 EmergentInc 下一步应该优先验证什么。
```

会议中：

```text
阁主：……
林默：……
阿策：……
小满：……
```

---

## 4.2 最小实现

不要建设复杂 Group Agent Framework。

只增加：

```ts
Meeting
MeetingParticipant
MeetingMessage
```

执行策略第一版采用简单顺序轮询：

```text
用户输入
↓
人物 A 回复
↓
人物 B 读取当前会议上下文后回复
↓
人物 C 回复
↓
本轮结束
```

暂时不做：

- 自动主持人
- 动态抢话
- 多 Agent 辩论树
- 投票机制
- DAG
- 并行推理
- 无限自治会议

先让“几个人可以一起聊”成立。

---

# 阶段 5：把复杂能力全部藏到后台

人物可以继续调用现有工具、文件和 Runtime。

前端不主动暴露这些机制。

角色遇到能力不足时，只需要能够向用户提出：

```text
我需要：
- GitHub 写权限
- Web 搜索
- 一个新的工具
- 修改某段代码
```

用户看到：

```text
[批准] [拒绝]
```

第一版只做通用 Approval Request 数据结构即可。

不要立即实现：

- 权限信誉体系
- 子 Agent 市场
- Agent 树管理器
- 动态组织图
- 自动代码改造流水线

---

# 关于“一个人物控制多个 Agent”

本阶段只确立原则：

```text
用户
 ↓
人物
 ↓
隐藏的内部执行
 ├─ Model Call
 ├─ Tool
 ├─ Task
 └─ Future Sub-Agent
```

**不要现在设计 Sub-Agent UI。**

未来人物需要拆任务时，可在后台增加：

```text
spawn_agent
delegate_task
collect_result
```

但无论人物内部用了多少 Agent：

> 用户永远只和“人物”交互。

这是系统边界。

---

# 代码改造优先级

## P0 — 必做

1. 新增 `birthSeed + 卦象 + birthText`
2. 新人物创建改为命核生成
3. 新流程停止生成八维 / rarity / trait / flaw / role 人设
4. `QianjiChatPanel` 保持核心
5. 人物详情改成「对话 / 经历 / 出生」
6. 命核不可修改

## P1 — 下一步

7. 多人会议
8. 通用 Approval Request
9. 人物经历页面简化

## P2 — 暂不实现

10. 人物自主创建子 Agent
11. Agent 组织结构
12. 自动权限演化
13. 复杂声望系统
14. 自动人格总结
15. 大规模数据库清理

---

# 迁移策略

现有老人物不要强行重新生成。

建议：

```text
旧人物：
继续可使用
标记 legacyIdentity = true

新人物：
全部使用 Hexagram Identity
```

如确实需要给旧人物补命核：

- 必须由用户手动触发
- 生成后不可重抽
- 不覆盖历史内容

不要因为这次重构破坏现有历史数据。

---

# 验收标准

完成本轮后，应满足：

### 1. 新人物出生

点击一次招募：

```text
姓名
卦象
birthText
```

即可完成。

不再需要填写职业、人设、概念、GitHub 来源等。

### 2. 两个新人物有明确初始差异

差异只来自：

```text
birthSeed
→ 卦象
→ birthText
```

而不是大量预设属性。

### 3. 人物不能修改命核

出生后：

```text
birthSeed
本卦
动爻
变卦
birthText
```

不可编辑。

### 4. 人物主要通过经历形成差异

连续使用后，不同人物的区别应主要体现在：

- 对话历史
- 文件
- 工作结果
- 工具使用
- 任务经历

而不是出生属性。

### 5. 前端明显变简单

用户进入人物页首先看到的是：

```text
这个人是谁
↓
和他说话
↓
他做过什么
```

而不是一堆系统参数。

### 6. 现有核心运行链不被破坏

必须继续通过：

```bash
pnpm test
pnpm typecheck
```

并保证：

- Pixel Binding 正常
- Chat 正常
- Run 正常
- Artifact 正常
- Token / Cost 记账正常
- 旧人物仍可打开

---

# 本轮禁止事项

本次改造中不要顺手：

- 重写 Runtime
- 重写 Scheduler
- 改数据库技术栈
- 改 Pixel 生命周期
- 引入 MCP
- 引入 Event Bus
- 重做 Tool Runtime
- 新建复杂 Agent Framework
- 大规模重命名目录
- 清空 legacy 数据
- 为未来需求提前抽象十几层接口

先完成：

> **“出生极简 + 经历涌现 + Chat First + 多人会议”**

其余能力以后由真实使用需求推动。
