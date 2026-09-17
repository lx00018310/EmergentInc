import argparse
import json
import socket
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path
from typing import Optional, Union

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from emergentinc.paths import ProjectPaths, get_paths
from .api import init_api
from .workspace_lock import WorkspaceInUseError, WorkspaceLock


def create_app(base_dir: Optional[Union[str, Path, ProjectPaths]] = None) -> FastAPI:
    if isinstance(base_dir, ProjectPaths):
        paths = base_dir
    else:
        paths = get_paths(base_dir)

    app = FastAPI(title="EmergentInc V9 Visual Control Deck")

    # 1. 优先注册 API 路由，确保 /api/* 优先响应且 404 不被前端单页拦截
    app.include_router(init_api(paths))

    # 2. 挂载 React 生产构建资源 (frontend/dist/assets)
    dist_dir = paths.frontend_dist
    assets_dir = dist_dir / "assets"
    if assets_dir.exists() and assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    # 3. 根路径与页面入口
    @app.get("/")
    def index():
        index_file = dist_dir / "index.html"
        if index_file.exists() and index_file.is_file():
            return FileResponse(str(index_file))
        return HTMLResponse(
            status_code=503,
            content=(
                "<html><body style='background:#0e1117;color:#f0f6fc;font-family:sans-serif;padding:40px;'>"
                "<h2>前端构建产物未就绪 (503 Service Unavailable)</h2>"
                "<p>未在 <code>frontend/dist</code> 找到构建文件。请在终端执行构建命令：</p>"
                "<pre style='background:#161b22;padding:12px;border:1px solid #30363d;border-radius:4px;'>"
                "cd frontend\nnpm run build"
                "</pre>"
                "</body></html>"
            ),
        )

    return app


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) == 0


def is_emergentinc_server(url: str) -> bool:
    """Only reuse a port after verifying that it is this application."""
    try:
        with urllib.request.urlopen(f"{url}/api/run/status", timeout=1.5) as response:
            if response.status != 200:
                return False
            data = json.loads(response.read().decode("utf-8"))
            return isinstance(data, dict) and "running" in data and "current_round" in data
    except Exception:
        return False


def run_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    open_browser: bool = True,
    workspace: Optional[Union[str, Path, ProjectPaths]] = None,
):
    paths = workspace if isinstance(workspace, ProjectPaths) else get_paths(workspace)
    # Acquire before recovery, browser opening, or any workspace mutation.
    try:
        with WorkspaceLock(paths.workspace_root):
            return _run_server_locked(host, port, open_browser, paths)
    except WorkspaceInUseError:
        url = f"http://127.0.0.1:{port}"
        if not is_emergentinc_server(url):
            raise
        print(f"[ALREADY RUNNING] 正在复用已有服务：{url}")
        if open_browser:
            webbrowser.open(url)
        return "REUSED_EXISTING_SERVER"


def _run_server_locked(
    host: str = "127.0.0.1",
    port: int = 8765,
    open_browser: bool = True,
    workspace: Optional[Union[str, Path, ProjectPaths]] = None,
):
    if host != "127.0.0.1":
        print("[SECURITY WARNING] Overriding host to 127.0.0.1 for local sandbox isolation.")
        host = "127.0.0.1"

    if is_port_in_use(port, host):
        print(f"[PORT CONFLICT] Port {port} on {host} is already in use.")
        raise RuntimeError(f"PORT_IN_USE: 请使用已有页面 http://{host}:{port}，不要重复启动。")

    url = f"http://{host}:{port}"
    print("=" * 60)
    print(" EmergentInc V5 Visual Control Deck")
    print(f" URL: {url}")
    print(" UI owns world execution lock.")
    print(" Press Ctrl+C in terminal to stop.")
    print("=" * 60)

    if open_browser:
        def _open():
            try:
                webbrowser.open(url)
            except Exception:
                pass

        timer = threading.Timer(1.2, _open)
        timer.daemon = True
        timer.start()

    app = create_app(workspace)
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", default=None, help="工作区路径")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    try:
        run_server(port=args.port, open_browser=not args.no_browser, workspace=args.workspace)
    except (WorkspaceInUseError, RuntimeError) as exc:
        print(f"[START FAILED] {exc}", file=sys.stderr)
        sys.exit(1)
