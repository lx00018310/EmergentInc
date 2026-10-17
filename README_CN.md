<div align="center">

# BOSS:/AFK · 甩手掌柜

### 老板不在，生意还在。

**The boss is away. The business is alive.**

告诉公司目标，只处理真正重要的决定。

[English](README.md) · [老板指南](docs/guides/OWNER_GUIDE.md) · [V34 清零指南](docs/guides/V34_RESET.md) · [EmergentInc](https://github.com/lx00018310/EmergentInc)

</div>

## 老板只有一个页面

打开 **`http://127.0.0.1:8765/BOSS`**，使用 Owner 口令登录。

- 启动或暂停公司，人工暂停跨重启保留。
- 查看恰好三个来自持久化事实的动态指标。
- 查看最多三条重要消息，按确定性事实评分（阻塞、风险、时效、影响、等待）稳定排序；每张卡片可在原处完成决定——批准、核验费用、停止或安全重试单项工作，不影响其他无关工作。
- 通过唯一对话输入框下达目标、作出决定。
- **视察公司**可查看目标、验收规则、任务汇报、交付物、执行者、商品和订单，并进入预算、收款和恢复设置。

`/` 继续作为公开商城。旧老板地址统一转到 `/BOSS`；旧工作台和相关接口已删除。

## 页面背后的真实闭环

```text
老板 → 目标 → 任务 → 执行者 → 工具 / Skills → 交付物
                ↓                              ↓
             公司预算              商城 → 订单 → 收款
                └──────────── 已核验事实 ────────────┘
                                    ↓
                                老板关注事项
```

V34 保留实际执行和安全核：有界任务、工具作用域、持久化证据、绑定 hash/revision 的审批、幂等，以及未知结果的显式恢复。执行者为获准工作创建，不再抽卡或生成角色画像。

公司费用统一使用 **CNY 金额预算**，收入只来自核验完成的 **USDT 回执**，两种货币分开显示。模型报告、发起转账或上架商品都不会被当作已核验收入。

## 本地启动

需要支持内置 `node:sqlite` 的 Node.js（22.13 或以上）、pnpm，以及 OpenAI 兼容模型接口。

```powershell
pnpm.cmd install --frozen-lockfile --ignore-scripts
Copy-Item .env.example .env
```

在 `.env` 设置至少 32 字符的随机 `EMERGENTINC_OWNER_SECRET`，填写 `MCL_API_KEY`、`MCL_BASE_URL`、`MCL_MODEL`。授权金额前核对 `resources/config/model_pricing.json` 中对应模型的 **CNY 定价**。不要公开 `.env`。

Windows 运行 `EmergentInc_UI.bat` 或 `EmergentInc_UI.ps1`。启动器会为全新安装构建，再运行已批准的冻结版本。也可以构建后从终端启动：

```powershell
pnpm.cmd build
pnpm.cmd --dir frontend build
node scripts/launch-approved.mjs --open-browser
```

全新 V34 初始为 **OFF**，**预算未授权，没有执行者、目标、任务、订单、回执或对话历史**。通过首页预算消息授权金额，然后启动公司。需要收款时配置只收款通道；不要在对话中提交钱包私钥。

没有 V34 标记的非空旧工作区会报 `V34_DESTRUCTIVE_RESET_REQUIRED`。正常启动、安装、拉取和升级均不会销毁数据。清零须按[独立且不可逆的重置流程](docs/guides/V34_RESET.md)执行。

## 当前能力边界

已实现：认证与中英双语老板页面、真实目标/任务执行、确定性执行者创建、产物证据、共享金额授权和结算、精确审批、恢复、公开商品/订单、只收款 USDT 核验，以及 **8766** 受控软件发布与回滚。可用收款通道取决于配置和链上最终性。

项目处于实验阶段。自主调研、交付质量、外部发布、获客及收入取决于模型、工具、权限和独立证据，是需要核验的结果，不是保证。公司视察展示现有经营记录；系统不提供钱包自动支出，也不承诺利润。

V34 之后的软件回滚保留新经营数据，不能恢复本次清零销毁的旧实例。[删减与验证清单](docs/V34_REMOVAL_INVENTORY.md)记录实际改造范围。

## 开发验证

```powershell
pnpm.cmd typecheck
pnpm.cmd --dir frontend test
pnpm.cmd --dir frontend build
pnpm.cmd test --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
git diff --check
```

真实进程集成测试在隔离工作区使用合成模型响应和链上证据；测试付款不是真实收入。

## 开源

基于 [EmergentInc](https://github.com/lx00018310/EmergentInc)。许可见 [LICENSE](LICENSE)。

**告诉它要做什么，决定真正重要的事。**
