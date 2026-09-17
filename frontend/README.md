# EmergentInc 前端 (React + TypeScript + Vite)

这是 EmergentInc 商业元胞自动机的现代化独立前端控制台。

## 环境要求

- Node.js: >= 20 (开发推荐 v24.14.x)
- npm: >= 10 (推荐 11.x)

## 开发模式 (双进程)

开发时前端运行在 `127.0.0.1:5173`，通过 Vite proxy 反向代理 `/api` 请求至 FastAPI 后端 (`127.0.0.1:8765`)。

```powershell
# 终端 1：仓库根目录启动后端服务
python -m emergentinc.ui.app --workspace .\workspace --no-browser

# 终端 2：frontend 目录启动 Vite 热更新服务
cd frontend
npm install
npm run dev
```

在浏览器打开 `http://127.0.0.1:5173`。

## 日常生产模式 (单端口)

在日常使用或生产环境下，只需构建一次静态产物，由 FastAPI 后端统一在 `http://127.0.0.1:8765` 提供页面服务，无需运行 Node.js 进程。

```powershell
# 1. 静态打包构建 (产物输出至 frontend/dist)
cd frontend
npm run build

# 2. 启动服务
python -m emergentinc.ui.app --workspace .\workspace
```

在浏览器直接访问 `http://127.0.0.1:8765`。

## 命令脚本

- `npm run dev`: 启动本地 Vite 开发服务器 (127.0.0.1:5173)
- `npm run typecheck`: 执行 TypeScript strict 编译与类型检查
- `npm run test`: 执行 Vitest 自动化单元与组件测试
- `npm run build`: 执行生产打包 (`tsc -b && vite build`)
