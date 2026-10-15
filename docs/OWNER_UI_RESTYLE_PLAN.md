# Owner 页面（/OWNER）UI 改造执行计划

> 目标：把 `frontend/src/features/owner/` 页面改为与 TASK-013 武汉自动上车显示屏项目（`src_test/src/pages`）一致的黑白高对比工业风，重要信息一眼可见、重要按钮大而明确。
> 创建时间：2026-10-15 ｜ 状态：✅ 已完成（构建通过，2026-10-15）

---

## 0. 范围与约束

**做**：只改前端 `frontend/src/features/owner/`（组件 + owner.css + owner-markdown.css 微调）及必要的 i18n 词典条目。

**不做**：
- 不碰后端（`apps/server/src/routes/owner_routes.ts` 等）
- 不碰数据接口 `frontend/src/api/owner.ts`
- 不改其他页面（PublicApp / GENE / QIAN / YUAN）
- 不引入任何 UI 框架，沿用"全局 CSS + BEM 类名 + CSS 变量"方案

**约束（AGENTS.md）**：中英文同步——所有新增/修改文案走 `t()`，且 `en.ts` 与 `zh-CN.ts` 词典同步补齐（t() 缺词条时原样返回 key，禁止漏配）。

## 1. 风格基准（取自 TASK-013 theme.css，桌面端缩放）

| 项 | 值 |
|---|---|
| 面板背景 | `#ffffff` |
| 页面背景 | `#ffffff`（工作区）/ `#fafafa`（可选分区） |
| 主文字 | `#000000` |
| 弱化文字 | `#6b7280` |
| 边框 | `1px solid #d1d5db` |
| 圆角 | 卡片 8px / 按钮与徽章 6px |
| 主按钮 | 黑底 `#000` 白字，加粗 |
| 状态色（仅语义用） | 绿 `#16a34a`（正常/Approve）· 红 `#dc2626`（危险/Reject/待办警示）· 橙 `#d97706`（警告/预留） |
| 字号三档 | 12-14px 辅助 / 16-20px 标题按钮 / 28-32px 大数字与页标题 |
| 字体 | Microsoft YaHei, sans-serif |
| 禁用 | 无阴影、无渐变、无紫色、无 `!important` 覆盖战争 |

## 2. 逐步执行清单

### Step 1 — 重写 `owner.css`（主题底座）
- [x] 文件：`frontend/src/features/owner/owner.css`（整文件重写，旧三套风格全部废弃）
- 在 `.owner-entry, .owner-console` 作用域定义全部变量（`--owner-*` 前缀），替代向全局变量（`--bg-main` 等）写值的做法，杜绝与 3572 行 index.css 的互相渗透
- 通用件样式：`owner-card`（白卡灰框 8px）、`owner-badge`（neutral黑/ok绿/warning橙/danger红 实底白字）、`owner-btn`（primary黑 / approve绿 / reject红 / ghost白底黑字，min-height 40px，加粗）、`owner-metric`（指标卡：12px 大写标签 + 30px 粗体数值）
- 保留 `.owner-entry .business-shell`（登录页）覆盖，改为同款白卡黑按钮
- 保留 hash tab 的 `[hidden]` 隐藏规则与滚动容器规则
- 删除：所有 `!important`、紫色变量、`.owner-goals/.owner-automation` 旧青绿块、`.company-dashboard` 压缩行（以新类重写）

### Step 2 — 重构 `OwnerConsole.tsx`（骨架）
- [x] 去掉 192px 紫色侧边栏，改为**顶部标题栏**：左 = 品牌 "EmergentInc"；中 = 两个大号分段 tab 按钮（Boss chat / AI company dashboard，激活项黑底白字）；右 = 公司运行状态徽章（`owner-badge`，按 observedState 映射 tone）
- 错误条改为红框警示卡（`role=alert`，红字）
- hash 路由与 5 秒轮询逻辑**保持不变**

### Step 3 — 重构 `OwnerDashboard.tsx`（信息层级）
- [x] **"Needs your approval" 置顶并强化**：整段用红框浅红底警示卡样式（1px `#dc2626` + `#fff7f7`），计数用红色徽章
- [x] **预算区改 4 列大数字指标卡**（授权总额黑 / 已结算黑 / 预留橙 / 可用绿），money-bar 重绘（已结算黑 + 预留橙，浅灰底）
- [x] 其余板块统一 `owner-card` 白卡：任务进度、人员负载、已验证收入、OwnerWork、历史时间线；次要内容（World 扩展、决策历史）保持 `<details>` 折叠
- 状态分布、每日成本保留 `<meter>`，统一配色

### Step 4 — 统一按钮体系（卡片组件）
- [x] `CompanyProposalCard.tsx`：reject 按钮的 `className="secondary"`（无定义、落到全局样式的 bug）改为 `owner-btn owner-btn--reject`；approve 用 `owner-btn owner-btn--approve`
- [x] `OwnerActionCard.tsx`：主按钮"Approve and execute"→ 绿色 approve 样式；"Reject"→ 红色 reject 样式
- [x] `OwnerInbox.tsx`：`owner-decision-approve/reject` 保留类名但接入新按钮体系；"View details" 改幽灵按钮样式
- [x] `OwnerChat.tsx`：发送 = 黑色主按钮（加大）；清空对话 = 幽灵按钮；输入框白底灰框
- [x] `OwnerWork.tsx` / `OwnerActivity.tsx` / `OwnerExtensions.tsx`：仅换肤（白卡、统一链接色为黑下划线），结构不动

### Step 5 — i18n 中英文同步核查
- [x] 原则：尽量复用现有词条，不新增文案；若必须新增，同步补 `frontend/src/i18n/en.ts` 与 `zh-CN.ts`
- 构建后人工过一遍 zh-CN / en 两种语言下无裸露英文 key

### Step 6 — 构建验证 + 存档
- [x] `npm --prefix frontend run build` 通过（tsc + vite）
- [x] 记录变更清单，写记忆日志

## 3. 验收标准

1. 构建零错误；
2. `/OWNER` 页面无任何紫色/阴影/暗色残留，全部为白底黑字灰框卡片；
3. 首屏第一眼能看到：公司状态徽章 + 红色待审批区 + 4 个大数字预算卡；
4. Approve 一律绿色、Reject 一律红色、主 CTA 黑色、次要操作白底幽灵钮，全站按钮高度 ≥40px；
5. 中英文切换显示均正常。
