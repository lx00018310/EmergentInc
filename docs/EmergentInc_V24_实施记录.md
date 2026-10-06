# V24 产品化收口实施记录

日期：2026-10-06。基线：`e80e233`（V23）；开发分支：`codex/v24-product`，独立 worktree，无 subagent。

## 已确认的业务口径

Owner 明确：官网由所有人物和 World 共享；人物可以合作和分工，共同推动对外业务与收入。

因此官网订单和收入归属 **INSTANCE**，不创建虚拟人物 / World，也不默认挂到某个人物。历史 World 发票、收入和私有经历保留原归属。实例实际链上收入形成全局经营经历，可由所有 World 读取；客户姓名、联系方式与需求只通过 Owner 订单接口展示，不进入这个全局经历。

## Phase 1：产品入口

- 英文 `README.md` 与结构对应的 `README_CN.md` 先介绍产品价值，再解释 World、人物、元胞、Body、Gene、Evolution、Payment 与受控自进化。
- React 保留一个工程。根 `/` 渲染 PublicApp；`/GENE`、`/QIAN`、`/YUAN` 使用 OwnerEntry。
- 统一 `en` / `zh-CN` 字典，默认英文，选择保存到 `emergentinc.language`；四个入口都有 `EN | 中文`。界面与状态标签随选择更新，原始业务记录、用户输入和对话保持原文。
- `/GENE` 定义为内部业务运营系统，新增 Public Site 页签，原有经营和生命管理能力保留。

## Phase 2：一个商品与商业闭环

官网展示 Hero、用途、Custom Service、使用步骤、开源、购买 / 联系及页脚。

网站配置、唯一商品和订单位于现有 `workspace/system/control/control.sqlite3`：

| 表 | 内容 |
| --- | --- |
| `public_site_config` | 网站名称、双语标题 / 介绍 / 联系信息、GitHub 链接、更新时间 |
| `public_products` | 唯一 `custom-service`，双语名称 / 介绍、USDT 报价、上下架 |
| `orders` | 产品名称与报价快照、客户信息、四种订单状态、Invoice 关联、时间和重试 / 访问凭证 |

旧 `products` 已用于归属人物的内部产品模型，因此不改表、不占用它。旧 CNY `business_orders` 和历史凭据也保留。

初始商品存在但**不上架，价格为空**。没有猜测正式售价或收款地址。Owner 必须设置大于零的 USDT 价格、启用现有 Rail 后才能上架。

公开接口只有：

```text
GET  /api/public/site
GET  /api/public/products
GET  /api/public/products/custom-service
GET  /api/public/payment-rails
POST /api/public/orders
GET  /api/public/orders/:order_id/payment
```

匿名许可按请求方法和准确路径判断；不是整个 public 前缀放行。`/api/public-site` 的 GET / PUT 仍是 Owner 接口。其他 Owner 接口、跨源拒绝、暂停后的变更阻止继续生效。

订单 ID 是随机 UUID，独立访问 token 为 32 个随机字节。创建订单只接受指定字段，价格取服务端商品快照；不接受客户提交金额或 World 归属。付款查询使用 Bearer token，不返回客户资料、内部账目或 RPC 配置。二维码直接返回 PNG data URL。

私有订单链接把 token 保存在 URL fragment 中，后续请求由 Authorization header 传递；token 不进入 URL query 或 Referer。浏览器刷新可恢复已创建的订单，商品下架也不影响查询原订单。待确认的 POST 保存原请求与幂等键，显式重试保持相同内容；明确拒绝的非法输入允许修正，不自动重发。

Order intent 先持久化为 PENDING，然后用稳定订单键创建 Invoice，再关联为 AWAITING_PAYMENT。两库之间意外中断时，启动恢复这个已保存 intent；已生成 Invoice 复用原值。数据库错误不会被一般兜底吞掉。

继续复用四链 USDT PaymentService / Monitor、终局验证、唯一尾数、收款回执、收入表与 outbox。官网 Invoice 的 `world_id` / `qianji_id` 为 NULL，`order_id` 明确关联。现有内部状态 FINALIZED 在公开付款响应中映射为 PAID。确认观察不算收入；迟到或取消后付款待 REVIEW_REQUIRED，不伪造到账。

付款事务先持久化回执和收入，随后更新订单。回执重复处理、outbox 重投与启动核对都是幂等的。Owner 取消或发票过期会同步订单取消状态；已确认付款不会被覆盖。

## Phase 3：数据连续、Release 与回退边界

Workspace 布局仍为 V23，不引入新 Gene / Agent 机制。Payment Schema 从 2 升至 3：事务重建 Invoice、Receipt、Revenue 三张表，只放开人物 / World 的非空约束，逐行保留旧 USDT 数据和外键图。旧 USDC 仍按既有机制归档，绝不改名成 USDT。

Supervisor 在静默并排空支付监听后，增加 control / payment 的在线 SQLite 快照；候选隔离 Workspace 也复制 payment。烟测核对公开接口、Owner 边界、订单及支付关联。根 README 的中英文两份都进入冻结 Release。

**回退限制必须保留：**V23 的 PaymentService 只支持 Schema 2。迁移到 Schema 3 后，不能直接回退到未兼容的 V23 Release；它会拒绝启动。已验收的是支持 Schema 3 的 V24 Release 之间回退，且不还原订单 / 支付数据库。不能用恢复旧数据库的方式删除新发生的商业事实。首次 V24 发布前必须准备兼容回退版本；该首次生产切换尚未执行。

代码仍在 Release，业务数据仍在 Workspace。Linux 路径继续为 `/srv/emergentinc/releases/<release_id>`、`current` 与 `/var/lib/emergentinc/workspace`。正式实例只运行批准的冻结版本，不从开发 worktree 启动，不在运行目录 Git pull。Owner 与 Agent 分开 worktree；测试、提交、合并后形成候选，准确候选审批之后才发布。

## 验证证据

本地执行：

```powershell
pnpm.cmd typecheck
pnpm.cmd test --maxWorkers=4 --minWorkers=1
pnpm.cmd --dir frontend build
```

全量结果：**85 个测试文件、596 项测试通过，0 失败、0 跳过**。最终界面调整后另外通过 14 项针对性检查；类型检查和前端构建通过。构建保留既有大 bundle 提示，本次不扩展为前端拆包重构。

新增 / 扩展的关键测试：

- `public_store.test.ts`：匿名许可、Owner 隔离、跨源拒绝、随机 token、服务端价格、防改归属、快照、上下架、监控到实例收入、全局经历、两库中断恢复、取消后付款审核，以及旧 V2 USDT 图逐行保留。
- `public_entry.test.tsx`：默认英文、根地址不请求 Owner session、四入口切换、刷新保持、模块状态标签和原始客户文本保留。
- `public_checkout.test.tsx`：无客户端价格、原请求重试、确定拒绝后修正、商品下架后的原订单链接、QR、双语付款信息与 Owner 设置提交。
- `world_process_generation.test.ts`：实际编译服务器进程、实际 Supervisor、实际 SQLite。创建订单 → 停进程 → 重启仍待付款；通过本地 HTTPS RPC 的模拟 Transfer 由现有 Monitor 确认 → PAID / 收入；再建立待付款订单；批准换至 G0002 与兼容回退 G0001 后，两张订单、发票和收入均保留，不重复记账。同时保留既有 World 迁移和新 World 遗传验证。

实际进程测试中的模型是明确的零价格替身；RPC 使用隔离 HTTPS 测试证书，生产 HTTPS 校验没有放宽。没有实际钱包付款。

浏览器在独立预览 Workspace 检查英文 / 中文首页、匿名表单、订单链接 / 应付金额 / QR，以及 Owner Public Site 中的真实持久化订单。预览资料为虚构测试输入，不连接生产模型或链上监听。

测试汇总及冻结候选验证结果由同目录的本地 `cache/v24-*` 记录保存；正式验收以对应输出为准。

## 验收结论

| 项目 | 状态 |
| --- | --- |
| A 产品定位 | 已实现英文 / 中文 README |
| B 四个路由 | 本地验证通过 |
| C 双语 | 字典、四入口、持久化与浏览器验证通过 |
| D 商品 | 唯一商品、双语编辑、价格、上下架已实现；正式配置待 Owner 提供 |
| E 商业闭环 | 模拟 RPC 与实际进程本地验证通过；真实客户付款尚未验收 |
| F 数据连续 | V2 数据迁移、重启、批准升级与兼容回退本地验证通过；Linux 实机及首次生产切换未执行 |

**这是完成开发和本地验证的候选，不是 V24 全部正式验收完成。**缺少正式定价 / 联系方式 / 收款配置、首次兼容回退准备、准确 Release 发布批准，以及真实客户支付证据。

## 本机软件升级入口补充

新增 `EmergentInc_Upgrade.bat` / `scripts/version-upgrade.mjs`，面向已采用 V23 Workspace 布局的本机 Owner 软件升级。prepare 冻结已提交源码并执行固定校验；approve 绑定准确候选哈希；apply 复用既有 GenerationSupervisor 的快照、全 World 迁移、隔离烟测、切换与恢复，不直接修改批准数据库或运行 Release。

Owner 的完整软件 Release 通过独立的 `submitOwnerRelease` 提交，来源提交、原因与冻结哈希纳入准确候选。普通 Gene submit 仍拒绝 Root 修改及 Owner Release 元数据，不增加 HTTP 发布入口。

软件维护保留未整理 Current 事实和快照，明确记录 `OWNER_MAINTENANCE_DREAM_DEFERRED`，不调用模型、不伪造完成的 Dream。普通 Gene 出生的 Final Dream 门槛保持。

V23 回退在暂停及停服前检查实例归属；任何实例发票 / 收据 / 收入都阻止直接回退。没有实例财务事实时，只逆迁移三张归属表为 schema 2，保留历史行和引用图；不会覆盖数据库备份。入口命令与各版本对应关系见 [版本升级入口](版本升级入口.md)。
