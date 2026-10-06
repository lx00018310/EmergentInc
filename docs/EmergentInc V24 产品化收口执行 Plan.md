# EmergentInc V24 产品化收口执行 Plan

## 0. V24 目标

V24 不再扩展新的底层生命机制。

本阶段目标是把现有 V23 能力真正组成一个完整产品：

> **EmergentInc — AI that helps anyone start and run an online business.**

商业模式分为两层：

1. EmergentInc 官方部署可以通过销售 EmergentInc 定制服务获得收入。
2. 任何人都可以部署这个开源项目，用自己的 EmergentInc 建立自己的线上业务。

最终产品结构：

```text
PUBLIC
/
└── 对外官网 + 营销 + 商城 + 购买

OWNER
/GENE
/QIAN
/YUAN
└── 内部业务运营、AI World、Pixel、Gene、商品和网站管理
```

所有页面均支持：

```text
English / 中文
```

默认语言为 English。

---

# 1. 总体原则

## 1.1 代码与运行数据彻底分离

保持并强化现有 V23 结构：

```text
Code / Release
    ↓
独立于
    ↓
Persistent Workspace
```

代码允许：

- Owner 修改
- 本地 AI / Agent 修改
- Git 合并
- 新版本构建
- 停机升级
- 回退旧 Release

但以下数据不得因代码升级丢失：

- World
- Pixel
- Current
- Lineage
- Memory
- Gene
- Body 数据
- 商品
- 订单
- Invoice
- 收款记录
- 网站配置
- 客户提交信息

原则：

> **Code changes. Business data continues.**

运行中的正式实例只运行已经批准的 Release。

Agent 不直接修改正在运行的 Release。

Owner 与 Agent 开发时使用独立 Git branch / worktree，合并完成后再发布。

不得让多个 Agent / 人同时直接编辑同一 working tree。

---

# 2. README 重构

建立：

```text
README.md       # English，主 README
README_CN.md    # 中文 README
```

README.md 顶部：

```text
English | [中文](README_CN.md)
```

README_CN.md 顶部：

```text
[English](README.md) | 中文
```

## 2.1 README 定位

README 首屏不要首先解释 Gene / Pixel / 元胞自动机。

首先解释产品价值。

英文主定位：

```text
EmergentInc

AI that helps anyone start and run an online business.

You provide the idea, resources and final decisions.
EmergentInc provides AI-powered characters and Pixels that
explore opportunities, build products, market, sell,
serve customers and continuously evolve through real business activity.
```

随后说明：

```text
For users
Deploy EmergentInc and build your own AI-powered online business.

For customers
EmergentInc itself also operates as a business and provides customization services.

For developers
EmergentInc is open source.
```

之后再介绍：

- World
- Qianji
- Pixel
- Body
- Gene
- Evolution
- Payment
- Self-evolution

README_CN.md 保持相同内容结构的中文版本。

---

# 3. 页面结构调整

正式确定只有两种页面性质。

## 3.1 Public

```text
/
```

根地址不再进入 `/QIAN`。

根地址直接显示公开网站。

无需 Owner 登录。

第一阶段包含：

```text
/
├── Hero
├── EmergentInc 是什么
├── 能解决什么问题
├── Custom Service 商品
├── How it works
├── Open Source
├── Purchase / Contact
└── Footer
```

整体以英文营销为主。

右上角：

```text
EN | 中文
```

---

# 4. Owner 内部页面

继续保留：

```text
/GENE
/QIAN
/YUAN
```

三者全部定义为：

> Internal Business Operating System

不再把 `/GENE` 理解为单纯技术管理后台。

---

## 4.1 `/QIAN`

负责：

- AI 人物
- World
- 人物状态
- 人物收入
- 与人物对话
- World 入口

---

## 4.2 `/YUAN`

负责：

- Pixel
- Run
- Messages
- Artifacts
- Body
- 协作
- 当前 World 运行情况

---

## 4.3 `/GENE`

负责全局运营与治理：

- Root of Trust
- Gene
- Evolution
- Memory
- Business
- Payment
- Revenue
- Promotion
- Public Site Settings
- Product Settings

V24 在 `/GENE` 中增加一个最小：

```text
Public Site
```

管理区域。

---

# 5. Public Site Settings

不要建立复杂 CMS。

第一版只保存必要配置。

建议：

```text
site_name
headline_en
headline_zh
description_en
description_zh

github_url

contact_text_en
contact_text_zh

product_enabled
product_name_en
product_name_zh
product_description_en
product_description_zh
product_price
product_currency

updated_at
```

其中：

```text
product_currency
```

暂时只对应现有 USDT 收款体系。

不要做：

- 页面编辑器
- Block CMS
- 多模板系统
- SEO 管理平台
- 复杂主题系统

V24 只解决真正需要的内容。

---

# 6. 第一个商品：Custom Service

系统内只建立一个初始商品：

```text
Custom Service
定制服务
```

它代表：

> 根据客户实际需求，帮助客户部署、配置、定制或使用 EmergentInc 建立自己的 AI 在线业务。

商品由 `/GENE` 设置。

包括：

```text
名称
介绍
价格
是否上架
```

支持 EN / 中文两套文案。

---

# 7. 第一条真实商业闭环

V24 最核心验收链：

```text
用户访问 /
        ↓
阅读 EmergentInc
        ↓
看到 Custom Service
        ↓
点击购买
        ↓
填写必要的信息
        ↓
创建 Order
        ↓
创建 USDT Invoice
        ↓
显示支付信息 / QR
        ↓
用户支付
        ↓
现有链上 Payment Monitor 检测
        ↓
Invoice PAID
        ↓
Order PAID
        ↓
收入写入经营事实
        ↓
/GENE 可以看到
```

这条链必须真正跑通。

---

# 8. Order 最小模型

不要建立完整电商系统。

第一版 Order 只需要：

```text
order_id
product_id
product_name_snapshot
customer_name
customer_contact
customer_requirement
amount
currency
status
invoice_id
created_at
paid_at
```

状态只需要：

```text
PENDING
AWAITING_PAYMENT
PAID
CANCELLED
```

不要增加：

- Shopping Cart
- Coupon
- Inventory
- Logistics
- Refund system
- Membership
- Customer account
- Complex CRM

---

# 9. Public API

当前 Owner API 继续保持保护。

明确分开：

```text
/api/*
```

默认：

```text
OWNER ONLY
```

新增非常少量的：

```text
/api/public/*
```

允许匿名访问。

例如：

```text
GET  /api/public/site
GET  /api/public/products
GET  /api/public/products/:id

POST /api/public/orders
GET  /api/public/orders/:order_id/payment
```

如果支付状态查询需要防止别人遍历订单：

创建 Order 时生成不可预测的：

```text
public_order_token
```

后续使用 token 查询。

不要公开自增 ID。

---

# 10. Public API 严格禁止访问

公开 API 不允许访问：

```text
World control
Pixel control
Run control
Prompt
Memory
Gene
Evolution
Body
Owner settings
Private files
Model API
RPC credential
Wallet secret
Internal business records
```

Public 与 Owner 必须形成明确安全边界。

---

# 11. 前端实现方式

坚持最小更改。

不要创建第二套完全独立的前端工程。

继续使用现有 React 前端。

在入口处根据 pathname 分流：

```text
/
        → PublicApp

/GENE
/QIAN
/YUAN
        → OwnerEntry
```

概念：

```tsx
if (pathname === "/") {
    return <PublicApp />;
}

return <OwnerEntry />;
```

现有 Owner UI 尽量不重构。

新增：

```text
frontend/src/features/public/
```

即可。

---

# 12. 中英文 i18n

所有页面：

```text
/
GENE
QIAN
YUAN
```

均增加统一：

```text
EN | 中文
```

第一阶段不要引入复杂国际化平台。

使用一个简单统一 dictionary 即可：

```text
en
zh-CN
```

例如：

```text
frontend/src/i18n/
  en.ts
  zh-CN.ts
```

语言选择：

```text
localStorage
```

保存。

规则：

```text
首次访问 → English
用户切换 → 保存
后续访问 → 沿用
```

不要根据 IP、浏览器地区自动强制切换。

---

# 13. Public 网站与内部系统关系

明确关系：

```text
                  ┌───────────────┐
                  │      /        │
                  │ Public Store  │
                  └───────┬───────┘
                          │
                   Public API
                          │
                ┌─────────▼────────┐
                │ EmergentInc Core │
                │ Orders / Payment │
                └─────────┬────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
       /QIAN            /YUAN            /GENE
       People           Pixels           Business
       Worlds           Runs             Gene
                                         Payment
                                         Public Site
```

Public 网站不是另一套业务系统。

它只是 EmergentInc 对外经营的一张脸。

---

# 14. 数据持久化

Public Site / Product / Order 必须属于 Workspace。

不得存进：

```text
frontend source
JSON in Git repo
release directory
```

建议复用现有：

```text
workspace/system/control/control.sqlite3
```

或者已有最接近的 business persistence 层。

不要为了 V24 再创建很多数据库。

原则：

> 能在现有数据库中增加少量表，就不要增加新的 DB。

建议最小增加：

```text
public_site_config
products
orders
```

Payment 继续使用：

```text
payment.sqlite3
```

通过：

```text
order_id ↔ invoice_id
```

关联。

---

# 15. Product 与 World 的关系

V24 暂时不要实现复杂的：

```text
每个 World 一个独立商城
```

第一阶段商品属于整个 EmergentInc 实例。

即：

```text
EmergentInc Instance
        ↓
Public Site
        ↓
Custom Service
```

后续如果业务真实产生需求，再扩展：

```text
World → Products
```

V24 不提前实现。

---

# 16. 部署结构

Linux 保持：

```text
/srv/emergentinc/releases/<release_id>
/srv/emergentinc/current -> 当前 Release

/var/lib/emergentinc/workspace
```

其中：

```text
代码 → /srv/emergentinc/
数据 → /var/lib/emergentinc/workspace
```

任何升级禁止覆盖 Workspace。

标准发布：

```text
开发代码
↓
typecheck
↓
test
↓
frontend build
↓
生成 Release
↓
停止正式实例
↓
Workspace backup
↓
必要 migration
↓
切换 current
↓
启动
↓
health check
↓
失败则 rollback release
```

Rollback：

```text
回退代码
≠
回退商业事实
```

已发生的：

- Order
- Payment
- Revenue
- Memory
- Lineage

不能因为代码 rollback 被删除。

---

# 17. Owner + Agent 并行修改代码

为了满足：

> 项目运行时，我和 Agent 都可能继续改项目。

制定简单规则：

```text
Production Release
        │
        └── 永远冻结

main
├── Owner 修改
└── Agent worktree / branch
```

Agent 修改完成：

```text
测试
↓
提交 commit
↓
合并
↓
形成候选 Release
↓
批准
↓
发布
```

禁止：

```text
Agent 直接修改 /srv/emergentinc/current
```

禁止：

```text
Git pull 直接覆盖正在运行的 production directory
```

这样无需解决复杂的“运行中的源码多人实时冲突”。

---

# 18. 首页营销结构

第一阶段首页保持非常简单。

## Hero

```text
EmergentInc

AI that helps anyone start and run an online business.

Start with an idea.
Let AI help turn it into a real business.
```

按钮：

```text
Get Custom Service
View on GitHub
```

---

## What EmergentInc Does

简单表达：

```text
Think
Build
Market
Sell
Learn
Evolve
```

不要首先宣传底层技术架构。

---

## Custom Service

展示唯一商品。

```text
Custom Service

Need help turning your idea into an AI-powered online business?

We can help you deploy, customize and build your own EmergentInc.
```

然后：

```text
Buy / Start
```

---

## Open Source

明确表达：

```text
EmergentInc is open source.

You can deploy it yourself,
modify it,
and use it to build your own business.
```

链接 GitHub。

---

# 19. 测试

V24 至少增加以下测试。

### Public

```text
GET /
无需登录

GET /api/public/site
无需登录

GET /api/public/products
无需登录
```

### Security

匿名访问：

```text
/api/evolution/*
/api/worlds/*
/api/business/*
```

必须：

```text
401
```

### Order

验证：

```text
创建 Order
→ 创建 Invoice
→ Payment confirmed
→ Order PAID
→ Revenue recorded
```

### Restart

重点验证：

```text
创建订单
↓
停止进程
↓
重新启动
↓
订单仍然存在
↓
Invoice 仍然存在
↓
Payment Monitor 继续工作
```

### Upgrade

验证：

```text
旧 Release 创建业务数据
↓
切换新 Release
↓
原数据全部存在
```

### i18n

验证：

```text
/
GENE
QIAN
YUAN
```

均能：

```text
EN ↔ 中文
```

刷新后语言保持。

---

# 20. V24 验收标准

V24 只有满足下面条件才算完成。

## A. 产品定位

README.md：

```text
English
AI helps anyone start and run an online business
```

README_CN.md：

```text
中文
```

---

## B. 路由

```text
/
```

打开：

```text
Public Marketing + Store
```

而不是 Owner 页面。

```text
/GENE
/QIAN
/YUAN
```

进入内部系统。

---

## C. 双语

四个入口：

```text
/
/GENE
/QIAN
/YUAN
```

全部支持：

```text
English / 中文
```

默认 English。

---

## D. 商品

首页存在真实：

```text
Custom Service
```

商品。

可以在 `/GENE`：

```text
修改文案
修改价格
上下架
```

---

## E. 商业闭环

真实完成：

```text
Public Website
→ Order
→ USDT Invoice
→ Payment
→ PAID
→ Revenue
→ /GENE 可见
```

---

## F. 数据连续

至少完成：

```text
Restart test
Release upgrade test
Rollback test
```

并证明：

```text
业务数据不随代码更新而丢失。
```

---

# 21. V24 明确不做

为避免再次膨胀，本阶段禁止主动扩展：

- 多商品商城架构
- 购物车
- 用户账户
- CRM
- 优惠券
- 会员
- 多租户 SaaS
- 每 World 独立域名
- 每 World 独立商城
- CMS
- Theme Builder
- 自动 SEO 系统
- 新支付体系
- 新区块链
- 新 Agent 架构
- 新 Gene 机制

除非完成 V24 核心闭环后出现真实业务需求。

---

# 22. 执行顺序

严格按照下面顺序执行。

### Phase 1 — 产品入口

完成：

```text
README.md
README_CN.md
/
Owner routes
i18n
```

目标：

> 产品第一次看上去是一套可以公开使用的产品。

---

### Phase 2 — 商城闭环

完成：

```text
Public Site Settings
Product
Order
Invoice
Payment
Revenue
```

目标：

> 一个真人可以真正完成购买。

---

### Phase 3 — 运行与升级

完成：

```text
workspace persistence
restart
migration
release
rollback
Owner + Agent development rules
```

目标：

> 系统可以长期运行和持续修改，而业务事实不断档。

---

# 最终产品定义

V24 完成后，EmergentInc 应形成这个最小完整形态：

```text
                     INTERNET

                        │
                        ▼
               ┌────────────────┐
               │       /        │
               │ Marketing      │
               │ Store          │
               │ Custom Service │
               └───────┬────────┘
                       │
                 Order / Payment
                       │
                       ▼
               ┌────────────────┐
               │ EmergentInc    │
               │ Business Core  │
               └───────┬────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       /QIAN         /YUAN        /GENE
       People        Pixels       Business
       Worlds        Body         Gene
       Revenue       Runs         Evolution
                                  Payment
                                  Public Site
```

一句话定义：

> **EmergentInc is an open-source AI system that helps anyone start and run an online business.**

中文：

> **EmergentInc 元胞会社，是一个帮助每个人利用 AI 开启并运营线上生意的开源系统。**