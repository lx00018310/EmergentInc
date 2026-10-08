# 发布页面回退、删除与 Pixel 接口 · 2026-10-08

## 中文

Owner 已明确授权 Pixel 直接执行回退与删除代码版本，无需逐次批准。新版本发布仍使用原有准确候选哈希审批。本次不执行真实实例的回退或版本删除。

8766 的返回链接进入 `/OWNER`。历史版本按发布代次展示，可回退到当前发布链上的历史版本；多代回退逐代复用既有停机、快照、付款兼容性检查与恢复链路。执行前校验整条路径；不能跨越 V22/V23 Workspace 迁移边界，也不能丢失实例付款事实。不兼容目标显示具体原因。

成功回退后，允许删除比当前代次更新的代码 Release，包括尚未发布的较新候选。删除只针对受控 releases 目录下的准确子目录，不删除 Workspace、订单、付款、账本、Current、冻结快照或谱系。版本及审批记录保留，代码状态标记为 `DELETED`。中断删除保留 `DELETING` 意图，可通过既有恢复入口完成。

Owner 按钮调用已有 `POST /api/upgrades`，新增操作：

- `rollback`：`targetGeneration`、`expectedActive`、`reason`；可选 `deleteNewer=true`，成功回退后清理全部较新代码。
- `delete`：`releaseId`、`expectedActive`、`identity`、`reason`。

Pixel 通过受限工具操作：`LIST_RELEASE_VERSIONS`、`ROLLBACK_RELEASE`、`DELETE_RELEASE`。对应接口为 `GET /pixel/releases`、`POST /pixel/releases/rollback`、`POST /pixel/releases/delete`。工具绑定实际 World、Pixel 和操作标识；独立维护服务验证专用派生凭据。它不接受 Owner 登录、发布、任意命令或路径。列表只返回操作所需的版本元数据与维护任务状态，不返回口令、凭据、私有路径或日志。

接口返回“已接受”后维护任务异步执行，结果应查看 8766 或列表中的 `job.state`。回退会重启 8765。历史代码可能尚未包含新增 Pixel 工具；需要同时清理时，可以在回退调用中明确指定 `deleteNewer=true`，由独立的 8766 服务完成后续清理。8766 页面不随 8765 回退。

验证使用隔离 Workspace，覆盖多代回退、完整路径预检、过期代号、删除范围、删除中断恢复、中英文页面按钮以及 Pixel 凭据不能发布版本。

## English

The Owner explicitly authorized Pixels to roll back and delete code versions directly, without approval for each operation. Publishing new versions retains the existing exact-candidate-hash approval. This change does not perform a rollback or delete versions in the actual instance.

The 8766 return link opens `/OWNER`. History follows publication generations. Rollback targets must belong to the active release ancestry; multi-generation rollback reuses the existing stop, snapshot, payment compatibility and restore sequence. The full path is checked before execution. Rollback cannot cross the V22/V23 Workspace migration boundary or discard instance payment facts. Incompatible targets show the reason.

After a successful rollback, code Releases newer than the active generation can be deleted, including newer unpublished candidates. Only the exact child directory within managed releases is removed. Workspace data, orders, payments, ledgers, Currents, frozen snapshots and lineage remain. Release and approval records are retained with code state `DELETED`. Interrupted deletion retains a `DELETING` intent and can be completed through the existing recovery entry.

Owner buttons use the existing `POST /api/upgrades` with two new actions:

- `rollback`: `targetGeneration`, `expectedActive`, `reason`; optional `deleteNewer=true` deletes all newer code after successful rollback.
- `delete`: `releaseId`, `expectedActive`, `identity`, `reason`.

Pixel tools are `LIST_RELEASE_VERSIONS`, `ROLLBACK_RELEASE` and `DELETE_RELEASE`. Their endpoints are `GET /pixel/releases`, `POST /pixel/releases/rollback` and `POST /pixel/releases/delete`. The tools bind the actual World, Pixel and operation key. The independent maintenance service validates a dedicated derived credential. It grants no Owner login, publication, arbitrary commands or paths. Listings contain only required release metadata and job state, without secrets, private paths or logs.

Accepted requests run asynchronously; check 8766 or `job.state` for completion. Rollback restarts 8765. Historical code may predate these Pixel tools. A Pixel can explicitly include `deleteNewer=true` in the rollback call so the independent 8766 service completes cleanup after the restart. The 8766 page is not rolled back with 8765.

Verification uses isolated Workspaces and covers multi-generation rollback, full-path preflight, stale generations, deletion scope and recovery, both UI languages, and the inability to publish with Pixel credentials.
