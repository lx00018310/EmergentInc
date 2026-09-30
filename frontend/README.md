# EmergentInc 前端

React / TypeScript / Vite 前端，后端为 Node.js / Fastify / SQLite。

## 页面

| 地址 | 内容 |
| --- | --- |
| `/QIAN` | 千机阁：人物、绑定、招募、会议 |
| `/YUAN` | 元胞界面：世界、消息、Run、协作、历史与交付 |
| `/GENE` | 完整经营工作台：方向、预算、方案、资料、连接、结果与生命管理 |

默认登录后进入千机阁；只有手动访问 `/GENE` 才进入经营工作台。页面按 URL 选择，不由 session.mode 决定。Body 日常导航不新增 Gene 管理入口。

默认 `business` 运行配置同时注册三页需要的后端接口。旧人物和 Run 继续读取原 Core 库；预算/生命接口使用已有 Lineage / Current。统一跨模块预算和完整进程隔离仍属后续工作。

## 本机启动

本机验证使用 Node.js 24.14.1。先按 [根 README](../README.md) 配置 Owner 口令和 workspace。根目录执行：

```powershell
npm.cmd run build
npm.cmd --prefix frontend run build
node apps/server/dist/main.js
```

也可使用根目录的 `EmergentInc_UI.bat`。服务已经运行时不要重复启动。访问 `http://127.0.0.1:8765/QIAN`、`/YUAN`、`/GENE`。

已有 workspace 遇到 Gene Hash 不匹配时，按 [受控升级说明](../docs/EmergentInc_V22_整改实施记录.md#本机受控升级与启动恢复) 处理，不能通过清库或覆盖 Hash 解决。

## 前端开发

Vite 在 5173 端口，通过 /api 代理连接 8765 后端。后端需明确允许开发 origin。以下从仓库根目录执行：

```powershell
# 终端一
$env:EMERGENT_DEV = '1'
$env:EMERGENT_ALLOWED_ORIGINS = 'http://127.0.0.1:5173'
node apps/server/dist/main.js

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
