# EmergentInc 前端

React / TypeScript / Vite 前端，后端为 Node.js / Fastify / SQLite。

## 页面

| 地址 | 内容 |
| --- | --- |
| `/QIAN` | 千机阁：人物、所属 World、招募、对话、入口更换与收入 |
| `/YUAN` | 元胞界面：选择 World 后查看其元胞、消息、Run、协作、历史与交付 |
| `/GENE` | 全局经营/生命工作台、Gene 资产审查、来源谱系、四链 USDT 地址设置、实际应付金额与发票 |

默认登录后进入千机阁；只有手动访问 `/GENE` 才进入经营工作台。页面按 URL 选择，不由 session.mode 决定。Body 日常导航不新增 Gene 管理入口。

V23 `workspace-layout.json` 显式选择 World 运行模式；`session.worldsEnabled` 告知前端使用带 World 路径的运行 API。`/YUAN?world=<id>` 不同选择会卸载原 Engine，文件下载也保留 World 作用域。旧绑定和历史仍可只读查看；跨人物会议入口在 V23 暂不启用。当前真实实例仍为已批准的 G0005，迁移和完整进程隔离需分别验收。

## 本机启动

本机验证使用 Node.js 24.14.1。先按 [根 README](../README.md) 配置 Owner 口令和 workspace。根目录执行：

```powershell
node scripts/launch-approved.mjs
```

日常启动运行 Owner 批准的冻结版本；源码构建须经过受控升级才对正式 workspace 生效。也可使用根目录的 `EmergentInc_UI.bat`。服务已经运行时不要重复启动。访问 `http://127.0.0.1:8765/QIAN`、`/YUAN`、`/GENE`。

已有 workspace 遇到 Gene Hash 不匹配时，按 [V23 受控升级说明](../README.md#本机启动和升级) 处理，不能通过清库或覆盖 Hash 解决。

## 前端开发

Vite 在 5173 端口，通过 /api 代理连接 8765 后端。后端需明确允许开发 origin。Vite 只预览前端源码；开发后端源码应使用明确指定的独立 workspace，不能复用正式数据。以下从仓库根目录执行：

```powershell
# 终端一
$env:EMERGENT_DEV = '1'
$env:EMERGENT_ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
node scripts/launch-approved.mjs

# 终端二
npm.cmd --prefix frontend run dev
```

## 验证

```powershell
npm.cmd run typecheck
npm.cmd test -- --reporter=dot --maxWorkers=2
npm.cmd --prefix frontend run build
```

目前 8765 上的三页仍共用应用进程。独立 Recovery Host 原型可单独提供诊断；完整工作台在 Body 后端失效后的独立运行仍待完成，不能把 URL 分开当作进程隔离。
