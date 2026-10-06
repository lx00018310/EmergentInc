# EmergentInc V23 实施记录

日期：2026-10-02。基线：`db73e0f31b675b578d7ffa566c94d4f772d340bc`，原运行代 G0005。

用户已明确授权连续执行 Stage 0–6，并授权短暂停止原实例做离线备份。此授权覆盖实现和副本验证；准确 Gene 候选及商户收款配置仍须按 Plan 的 Owner 门槛执行。

## 实际完成的工程内容

- Stage 0：完整原 workspace 物理清单、原始 DB/WAL/SHM 字节备份、独立重放/规范快照、逻辑和外键检查、迁移投影。首次在线清单因 SHM 变化拒绝出具证明；离线重做成功。
- Stage 1：人物注册与每 World 的 live、Core、Current、Run、工具、锁独立。新招募原子创建人物及 World；旧人物内容与命核保持，原绑定只作 legacy。旧 Core 全历史保留，历史费用不依今天的绑定重分配。明确归属的原 Pixel 文件及个人 artifact 保留原始字节。
- Stage 2：外部聊天解析千机→World→可替换入口，消息带入口 incarnation，真实 scheduler 产生只属于该 World 的 outbox；繁衍只创造元胞。QIAN 显示人物世界，YUAN 按 URL/选择器选 World，运行和下载地址具有 World 作用域。
- Stage 3：全局 Lineage + per-World Current。受控 JS AST 函数生成/测试/使用/回退。支持五类资产的快照、实际使用证据、隐私/许可/去个体化和谱系。World 共享资产仅原 World 可读。全局 Dream 的独立游标汇总 World 事实，按 World 保存私有记忆，可建议冻结提名；批准方向前必须补齐 Owner 政策审查。之后自动产生 GeneRequest，通用程序包含测试、接口、引擎及空外部权限。
- Stage 4：真正的 GenerationSupervisor 枚举 World，全部准备/迁移、候选既有 World + 空 World 烟测、唯一全局切换、失败整体回退。Root 审批只在受信任 CLI，app/Pixel 工具不能批准准确哈希。回退冻结各 World Current，保留 Lineage；新代后来出生的 World 无旧 Current 时保留并明确标记待恢复。GENE 显示各 World 的 Current 与迁移计数。
- Stage 5：Solana 经典 USDC、mainnet/devnet 分离、独立 Reference/QR、配置修订、严格 SPL wire/ATA/Mint/原子金额/memo/净入账验证，confirmed 观察、finalized 回执、重启补扫与去重。取消/迟到付款不会自动记收入。付款 outbox 固定原始 receipt generation，换代后的重投不改出处。无私钥、签名、消费能力。
- Stage 6 本地部分：真实编译进程、真实 Supervisor 与独立空 World，完整技能生成/使用/提名/Dream 建议/政策审核/方向批准/生成 Patch/固定校验/准确哈希批准/换代/空 Body 调用 Gene/退代。模型是明确的零价测试替身。支付归属、分页、取消/迟到和跨代重投使用模拟 RPC。

## 本地验收结果

最新完整候选内回归：79 个测试文件、542 个测试通过，递归进程测试单独执行并通过（约 107 秒），总计 80 文件 / 543 测试。类型检查、前端构建通过，实际 Edge 浏览器检查 QIAN / 两个不同 World 的 YUAN / GENE 收款页面：无 pageerror 或失败 API 请求，3 位原人物可见，元胞请求全部带选中 World 路径。

证据：`cache/v23-process-verified.log`、`cache/v23-browser-final/report.json`。过程中修复了候选内测试对固定代号的假设、重型多 World 测试的 5 秒超时，以及本机切版控制使用旧 HTTP 连接的问题。控制请求使用关闭连接和完整读取响应，未增加不明写入重试。

## 原数据与副本证据

离线备份：`cache/v23-stage0-20261002-offline/report.json`。

7 个数据库、36 个数据文件；3 位千机、3 个 Pixel；无 orphan、无迁移归属冲突。整个 workspace 前后物理清单一致，`sourceUnchanged: true`。

原 G0005 在备份后恢复运行。开发、迁移、Generation 和浏览器验收在独立副本进行，不把测试模型、测试付款或测试审批写入真实 workspace。

## 本机复现

```powershell
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd --dir frontend build
```

专项测试：`world_runtime_isolation`、`world_product_routes`、`gene_promotion_snapshot`、`multi_world_generation`、`world_process_generation`、`payment_world_attribution`、`v23_migration_dry_run`、`v23_upgrade_approval` 和 tools 的 `pure_skill`。

`world_process_generation` 运行真实 Node 服务和候选 release。测试模型只监听测试端口，零费率；准确哈希决定仅是 fixture 决定。候选内完整回归会跳过递归的进程测试，父测试实际执行它。Windows 副本放同一 D 盘，使离线安装使用已缓存依赖；C 盘离线仓库缺少新 Solana tarball 时必须拒绝，未改为联网安装。

## 首次迁移和后续发布

首次升级工具：`scripts/v23-upgrade.mjs` 的 prepare / approve / apply；prepared workspace 与冻结 release 都在原 workspace 外，在候选目录内固定执行离线依赖安装、typecheck、全量 test、build、前端 build 与烟测，再生成准确候选 hash。apply 只接受匹配批准、源码完整性、原数据/Pixel 文件不变的候选；新增加的文件也会阻止应用旧演练。切换期间用待恢复标记阻止普通启动，保留原 workspace 备份，并通过实际服务健康检查。失败停止自身启动的进程，恢复旧目录及 `.env`，旧代 Lineage 留下失败事件与记忆；未确认进程停止时拒绝移动目录。

正常启动 `scripts/launch-approved.mjs`。已迁移实例配置 `EMERGENTINC_LOCAL_EVOLUTION_CONFIG` 为 Owner 外部配置；启动核验初次凭据或 Supervisor 的 BORN/准确 approval hash、release 全文件哈希、Global/World Current 和指针。后续 Gene 使用 `scripts/v23-generation.mjs`；Linux 继续使用独立 root Supervisor，配置 `workspaceVersion:23`。

## 不能据此宣布完成的部分

1. 真实模型生命周期仍待正式实例验收；首次 V23 切换已于 2026-10-06 经 Owner 准确候选批准完成，实际运行 G0006，见本文末发布记录。
2. 真实扫码付款：四链 USDT 商户地址尚未配置，也未记录实际 finalized 付款。地址由 Owner 在 `/GENE` 设置；不伪造实收。
3. Linux 实机、权限隔离、systemd 换代和紧急恢复验收仍未进行，之前暂停要求保持。
4. 完整 GENE 工作台与 Body 尚未物理分进程；独立 Recovery Host 仍是只读诊断原型。明确的 World DB 故障使 ready 失败，并可在仍工作的 Root 页面诊断；不创建假 Current。
5. 当前 JS 纯函数契约不等同任意前端组件、后端工程及新依赖的自主修改。V22 跨人物会议暂不启用，历史归档保留；旧全局经营流程与 World 任务目标仍需在后续范围中统一。
6. 前端大 chunk、Node SQLite experimental 提示、SPL bigint 原生插件缺失而使用纯 JS，均如实保留。

Plan 的每阶段停止规则已被本次“把整个 plan 执行完”明确覆盖；Owner 准确哈希与钱包配置门槛未被测试替身替代。

## 2026-10-06 继续执行

原实例已停止；先完成新的离线证明，再恢复准确凭据对应的 G0005。新的 `cache/v23-stage0-20261006-offline/report.json`：7 个数据库、36 个数据文件，仍是 3 位千机和 3 个元胞，无 orphan、无归属冲突，完整 workspace 前后物理清单一致。

首次切换新增实际进程测试：准确批准后成功切换、恢复运行失败后回退、演练后新增文件拒绝切换。测试 HTTP 服务只用于验证控制器的实际进程和目录行为，不是模型或链上验收。证据：`cache/v23-cutover-tests-20261006.log`。连同原完整回归，新增 2 个案例；完整生命周期需在本次冻结候选中再次验证。

首次冻结检查 `cache/v23-owner-upgrade-20261006` 因原连续两次本机升级测试的默认 5 秒限制失败，没有生成可批准凭据。仅该重型测试改为 20 秒，不放宽生产检查。随后 reviewed 候选内 544 个测试通过，完整进程生命周期独立通过（约 165 秒）；总计 80 文件 / 545 测试。最终原数据比对发现 `business_worker` 的 owner / lease_until 因原实例启动而变化；其余表未变。校验调整为只排除此表的租约行，仍绑定表结构，并要求 quiesce 后租约为零；回归涵盖换代前租约变化及演练后新增资料拒绝。

最终准备目录为 `cache/v23-owner-upgrade-20261006-final`。最终审批以该目录内 `initial-v23.json` 的 `candidateHash` 为准；reviewed 凭据已作废，不能使用测试中的批准或以前的候选 Hash。当前真实实例仍为 G0005，未发布 G0006、未配置商户 Rail、未记录链上实收，代码尚未提交或推送。

最终冻结候选的固定完整检查通过：79 个测试文件 / 544 个测试，类型检查、服务构建、前端构建与真实候选启动烟测通过；加上独立进程生命周期测试，总计 80 文件 / 545 测试。最终核对 `review-report.json` 确认原 7 个数据库的业务事实、3 位人物完整资料、12 份原元胞/个人资料文件保留，冻结 release 完整性成立，正在运行的仍是原 G0005。租约例外仅针对 `business_worker` 行，不排除任何账本、订单或工作事实。

准确候选 Hash：`6003ce0f3a22fd737d46dbfc70f85f7e5d03ce4015f4374189794d7850113ab3`，状态 `PREPARED`，`ownerAuthorization: null`。等待明确批准后才能执行 G0005 → G0006 首次切换；真实模型生命周期和实际 finalized 付款仍须在正式实例验收。

## 2026-10-06 Owner 收款范围修订

Owner 已批准上述旧候选，批准记录已写入；随后明确改为只收 USDT，四链为 Solana、BSC/BEP-20、Polygon PoS、TRON/TRC-20，地址在 `/GENE` 输入即可，并选择唯一金额尾数自动匹配。旧候选因此标记 SUPERSEDED，原批准保留但不能用于发布新代码；原 G0005 未切换。

新收款实现固定规范合约，Solana/Polygon/TRON 为 6 位精度，BSC 为 18 位；页面标明 Binance-Peg USDT 与 Polygon USDT0。Solana 保留独立 Reference，其余三链按链/钱包/合约永久占用应付金额，尾数增量最多 0.009999 USDT。报价和实际应付值分别显示；取消、过期及更改配置不释放历史金额。通过正确链、真实 receipt/区块/规范 Transfer 和 finality 验证才记收入，跨链 signature/log index 去重，迟到付款待审核，未知到账不猜 World。

Payment schema v2 将 v1 USDC 完整 FK 图归档，原金额、币种、状态保留；不转换为新 USDT 收入。World 新增只读 `LIST_PAYMENT_RAILS`，只返回公开启用配置，不给模型 RPC 地址或凭据。TRON QR 只包含收款地址，页面明确要求钱包选择 TRC-20 USDT 并输入完整金额。

新增多链、精度、金额占用、RPC 中断补扫、错误/自转账、归档和页面专项检查。`cache/v23-usdt-final-focused.log`：4 文件 / 52 测试通过。实际 Edge 检查 `cache/v23-browser-usdt-20261006/report.json`：QIAN 原 3 人、两个 World 的 YUAN 请求范围正常，GENE 有 4 个地址输入，无 USDC 收款入口、无失败请求或 pageerror。

`cache/v23-usdt-rpc-probe.json`：四链只读网络身份与规范代币精度查询通过，未配置任何商户钱包、未创建发票、未发起付款。BSC 原公共节点的 finalized state 查询报 missing trie node、Polygon 旧公共入口返回 401；开发时选择已实测的 PublicNode 固定默认端点，运行时不加入自动回退。Owner 可通过环境变量配置私有 RPC。

USDT 新候选将在 `cache/v23-owner-upgrade-usdt-20261006` 生成并重新申请准确 Hash 批准。真实链上付款仍未验收；地址由 Owner 在发布后的页面设置，无需现在提供。

完整真实进程 / Supervisor 生命周期复验通过（`cache/v23-usdt-lifecycle.log`，约 153 秒；模型和批准仍是明确测试替身）。收款 quiesce 新增手工 HTTP 补扫的排空等待，并在 Final Dream 前投递已确认回执的 Memory；中断不推进未完成页的扫描游标。此边界在 `usdt_multi_chain` 专项中验证，避免发布切换时遗留读请求或遗漏已知收款事实。

首次 USDT 冻结检查因两条测试的 5 秒限制失败，没有生成可批准凭据。多链专项精简到实际依赖的 Control/Lineage/Payment 库，不重复初始化无关调度运行库；真实 World 集成与浏览器验收保留。连续失败升级后修复的旧重型测试改为 20 秒。最终候选目录改为 `cache/v23-owner-upgrade-usdt-20261006-final`，包括停机后拒绝新补扫的完整检查。

最终 USDT 候选检查通过：81 个测试文件 / 580 个测试，独立生命周期进程测试 1 文件 / 1 测试通过，合计 82 文件 / 581 测试；类型检查、服务构建、前端构建、候选启动烟测通过。最终核对发现 G0005 原进程已停止、锁 PID 不存在，已从其准确已批准冻结发布恢复为 PID 22264；7 个原数据库业务事实、3 位人物和 12 份原元胞资料文件保留，发布完整性和源码 Gene 身份一致。没有把测试数据、钱包或付款写入真实 workspace。

新准确候选 Hash：`2b5057e230064a4ed3699de67f4d74e91d506322459cdd42c955876b77329f92`，状态 PREPARED，Owner 批准为空。报告在该 Owner 目录的 `review-report.json`。原批准的 6003… 对应 USDC 旧代码，已保留批准记录并标记 SUPERSEDED；不能用于这个 USDT 候选。真实付款与正式切换仍待完成；当前未提交或推送。

## 2026-10-06 G0006 正式发布验收

Owner 明确“批准 G0006”后，对上述准确 USDT 候选执行 approve / apply，凭据状态现为 COMMITTED。G0005 退休，G0006 实际启动并恢复运行；`launch-approved.mjs --check` 返回 `APPROVED_RELEASE G0006 local-v23-a388699d722376a4`。当前 Gene Hash 为 `211bb4e89b628fd208612124ff381b4a4365748f9e4ca722a33d3c1cecf8f81c`，真实 `/health/ready` 为 ready，切换阻止标记已清除。

原 workspace 完整保留在 `workspace.v22-before-local-v23-a388699d722376a4`，只作为回退备份，不在备份目录直接运行。发布后核对原 7 个数据库在备份及只读归档中的业务指纹，均与批准基线一致；原 3 位人物完整资料和 12 份原元胞/个人资料文件保留，3 个独立 World 的 Current 均为准确 G0006 / Gene / release。冻结 release 全文件哈希仍匹配。报告：`cache/v23-owner-upgrade-usdt-20261006-final/published-review-report.json`。

对正式实例执行 Edge 页面检查：`/QIAN` 显示原 3 位千机，`/YUAN` 能依次选择全部 3 个 World，`/GENE` 显示四链 USDT 的 4 个地址输入框，无旧 USDC 收款入口、无失败 API 或页面异常。未配置钱包、未发起模型任务或付款；真实模型生命周期、实际 finalized 收款及 Linux 实机验收仍待完成。代码当前未提交或推送。
