# 方案授权经营入口（实施中）

当前落地路径：Owner 登录 → 授权拟定费用 → 上传资料 / 连接账号 → Pixel 拟定方案 → 批准具体版本 → 后台执行 → 记录实际结果 → 按已批时间复盘 → 再次审批或恢复策略。支持资料报告、反馈复盘和限定仓库的 GitHub 议题；订单与收款凭据由 Owner 手工确认。工程进度与未验收项见 [V21 实施记录](../EmergentInc_V21_实施记录.md)。协作、自修改及自动发布尚未实现。

## Windows 开发与体验

Node 24.14.1；先运行 `pnpm.cmd install --frozen-lockfile`（已有依赖可跳过），再运行：

```powershell
pnpm.cmd build
pnpm.cmd --filter emergentinc-frontend build
$env:EMERGENTINC_RUNTIME_MODE = 'business'
$env:EMERGENTINC_WORKSPACE_ROOT = 'D:\EmergentIncData'
# 用密码管理器生成随机口令；不要将实际值提交到 Git。
$env:EMERGENTINC_OWNER_SECRET = '<至少32字符的随机Owner口令>'
$env:EMERGENTINC_SECURE_COOKIES = '0' # 仅本机 HTTP；公共访问必须 HTTPS + Secure Cookie
pnpm.cmd --filter @emergentinc/server start
```

浏览器访问 `http://127.0.0.1:8765`。模型未配置时能登录、上传资料和查看记录，不能先欠费分析。新默认入口为 business；旧模式须明确设 `EMERGENTINC_RUNTIME_MODE=legacy`，仍须 Owner 登录。两模式通过 workspace 进程锁互斥，business 不注册旧模型、Run、工具和修改接口，也不打开旧数据库。

开发前端时使用 Vite 代理，并明确设置 `EMERGENT_DEV=1` 和 `EMERGENT_ALLOWED_ORIGINS=http://127.0.0.1:5173`。这只放行来源，不绕过登录。

## 模型连接和准确报价（实例管理员）

配置 `MCL_BASE_URL`、`MCL_API_KEY`、`MCL_DECISION_MODEL`。在数据目录 `private/business_model_pricing.json` 中填写**供应商实际报价**：

```json
{
  "models": {
    "供应商的准确模型ID": {
      "currency": "CNY",
      "input_cost_per_million": 1,
      "output_cost_per_million": 1,
      "cached_cost_per_million": 1,
      "effective_from": "供应商报价日期或版本"
    }
  }
}
```

上面的 1 仅展示结构，**不是报价建议，不可照抄用于实际账单**。价格最多六位小数；账本使用整数微元（1 元 = 1,000,000 微元）。不读取旧 `default_pricing`，也不把订阅分摊估价冒充真实单次成本。当前只支持 CNY；外币及换汇报价尚未接通。不知道价格时保持未配置。

Owner 在首页确认实例累计上限、其中的拟定额度、累计调用次数和有效期。改额度不清空已确认费用与待核实预留；模型用量缺失或请求超时，预留保留，Owner 根据供应商账单核实。已收到的响应在结算后复用，不重复计费。拟定/主动修订受拟定额度控制；已批准的自动复盘受方案与实例累计预算共同控制，不消耗拟定调用次数。旧聊天和画像服务不暴露在 business 模式。

## 资料与方案

上传 UTF-8 CSV（可从 Excel 导出）或 JSON 表格行数组，例如 `[{"客户":"示例","金额":12},{"客户":"","金额":3}]`，最大 500 KB、10,000 行、200 个字段。CSV 支持引号与跨行字段，编号、公式保留为文本；只有 JSON 中明确的数值参与数值汇总。资料按 ID 固定，修改时上传新资料并修订方案。Pixel 只得到资料名称/ID，不自动获得资料全文。通用数据清洗和任意文件处理尚未支持。

每份批准固定版本、哈希、资料 ID、能力版本、费用与期限。不同版本重新批准；新草案提交后停止旧版未执行任务。首版确定性报告不调用模型、不访问网络，包含行数、重复内容、字段缺失与数值统计。没有新任务时付费调用数为零。

资料缺失时出现待办，上传指定资料并确认后原任务继续；拒绝停止方案。对于未实现的外部能力，Owner 给思路不会把它变成可执行权限。暂停/撤销阻止新任务；已经发生的结果与费用仍保留。

## 时间安排、反馈和策略恢复

一次性方案在批准且资料齐备后执行。周期方案支持至少 5 分钟的间隔，或指定时区的每日时间，并有次数上限与截止日期。页面显示下次行动；关掉页面不影响后台执行。停机期间错过的执行合并为一次，不集中补跑；外部写入不支持周期发布。任务按批准的行动顺序执行，前一步未成功时不启动依赖步骤。

在方案页记录实际观察和证据不会调用模型，也不会创造收入。方案包含 `review_feedback@1` 时，后台只在约定执行时间复盘未处理的反馈，每次最多 20 条，先处理较早的反馈。没有新反馈不调用模型；有反馈时用一次有界调用判断保持现状或提出新版本。无效收费响应会暂停方案；费用未知会保留预留并阻止重复付费复盘。复盘当前尚未自动读取订单变化和渠道客户回复，需要 Owner 记录相应反馈。

“历史方案与策略恢复”允许选择旧版、填写新的累计预算与截止日期，将其恢复为待批草案，不调用模型。旧版授权不会复活；新草案仍须核对动作并批准。费用、订单、付款、已发议题不回滚；重新批准包含写入的旧策略可能产生一次新的对外动作。

## GitHub 连接与外部回执

适用场景是你管理的仓库中的反馈、交付或项目事项；它不是通用营销渠道，也不支持向任意仓库批量发帖。在“连接与资料”填写 `owner/repo` 和限定仓库的 fine-grained PAT，授予 Issues 写权限。服务端验证账号与仓库管理权限后保存连接；凭据仅在独立数据目录 `private/business-connections` 中，不进入方案、数据库或模型。

方案逐字展示将使用的账号、仓库、标题、正文；批准固定这些值。版本 1 仅能创建一条议题，不改权限、不删内容。响应正常时保存平台回执；超时或回执不明时保持“结果待核实”，不自动重发。首页“核实渠道回执”只读查询最近 100 条；未找到不等于未发送，仍保留未知状态。

“禁止新动作”立即阻止该连接的新派发。为核实已经发生的请求，保留凭据，Owner 仍可主动发起只读回执核实；这不是撤销 GitHub 令牌。彻底撤销令牌须在 GitHub 操作，此后核验会失败，应保留待决记录。当前版本没有自动刷新凭据或扩充账号权限。

接口依据：[GitHub Issues REST](https://docs.github.com/en/rest/issues/issues)、[fine-grained 权限](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)。本地工程测试使用替身 HTTP；真实账号与发帖尚未验收。

## 经营结果与收款证据

首页可记录归属于已批准方案的订单、客户参考标识、来源证据及金额；销售确认和交付状态分别维护。记录付款 / 退款时填写渠道、账号、渠道流水号和核验依据。同一渠道/账号/流水号不会重复入账；同号内容不同会拒绝。退款必须关联原付款，累计不能超过原付款。

区分外部客户、Owner 自付款和测试款。汇总仅计外部客户，并明确标为“人工确认”；当前没有支付平台验证。来源证据无法证明时保持未知，不从文案、GitHub 发布次数、旧 Energy 奖励或表格金额推导收入、获客归因或利润。记录按钮不会实际收款或退款。

## 异常处理

| 页面状态 | 可操作的处理 |
| --- | --- |
| 等待资料 | 上传指定资料，再确认资源已提供；拒绝会停止方案 |
| 资料处理失败 | 解决原因并填写说明，显式重试该纯计算任务 |
| 账号授权失效 | 方案暂停，核对连接并修订范围；不复用失效权限 |
| 模型费用待核实 | 根据供应商账单填写金额和证据；已有响应会复用 |
| 外部写入待核实 | 只读查询回执；没有证据时不重发 |
| 已收费复盘无效 | 保留费用并暂停，检查反馈后修订方案 |
| 重启前尚未派发 | 保留失败待办，由 Owner 修订并再次批准 |
| 后台调度已停止 | 管理员检查服务与数据库；修复前不要重复发起任务 |

已发生但未核实的动作即使方案撤销也要保留核验入口。网络错误后重试同一次拟定/修订会复用请求标识；更改方向属于新请求，仍受费用上限约束。

## 备份、恢复与模式回退

```powershell
node scripts/business-maintenance.mjs inspect 'D:\EmergentIncData\ledger\business.sqlite3'
node scripts/business-maintenance.mjs backup 'D:\EmergentIncData\ledger\business.sqlite3' 'D:\EmergentIncBackup\business-20260929.sqlite3'
```

使用 SQLite online backup API，备份包含已提交 WAL。目标必须不存在；生成文件的完整性校验、表计数和 SHA-256 清单一起保存。私有配置与凭据另行用受控渠道备份，不能发进聊天或 Git。

恢复演练：将备份再用上述 backup 命令恢复到**全新的演练目录**，比较完整性、表数和关键任务/费用记录，再用独立端口启动。不要覆盖运行中的数据库，不复制 WAL 中的主文件冒充一致性备份。正常程序回退保留最新业务库；产生新事实后不能用旧备份抹去交易。未知业务 schema 版本会拒绝启动。

模式回退：停止服务 → 确认模型请求结束或已标为待核实 → 保留 business 数据 → 显式改为 legacy → 重启。business 任务不会导入旧 Run，也不会升级旧授权。新的运行目录未迁移旧人物和资料，不隐式复制旧凭据。旧模式仅供此前运行恢复/检查；在正式业务上线后还需实现其只读历史投影，再关闭兼容写入口。

## Linux 安装边界

仓库提供 `deploy/linux/emergentinc.service` 与 environment 模板；尚未进行 Linux 实机验收。运维安装 Node 24、创建非 root 用户 `emergentinc`，确保 `/srv/emergentinc/releases/<version>` 代码由运维账户拥有、应用不可写，`current` 指向已验证版本；数据目录由服务用户拥有。`/etc/emergentinc/environment` 由 root 保存、权限 0600，systemd 读取环境文件。设置 HTTPS 反向代理，保留 Origin/Host 一致；服务端只监听 loopback。

启动前完成构建，安装 unit 后执行 `systemctl daemon-reload` 和 `systemctl enable --now emergentinc`。检查 `/health/live` 与 `/health/ready`；ready 仅表示本进程/调度器能运行，不表示模型已连接或已获经营权限。重启后需重新登录；任务和费用持久化。进程锁碰到仍存活的 PID 会拒绝第二个实例。旧版本不认识进程锁，切换前必须人工停止旧服务。

经营入口仍不允许运行生成代码或自动切换应用 release。P5 已提供独立的受限执行器、可信候选验证和自动化程序版本管理 CLI，尚未接入本入口，且没有 Linux 实机验收；见 [隔离与版本管理说明](../../deploy/linux/SANDBOX.md)。不能将 systemd 自动拉起进程当作代码升级回退验收。
