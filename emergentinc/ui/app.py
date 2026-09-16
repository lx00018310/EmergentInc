import argparse
import socket
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Optional, Union

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from emergentinc.paths import ProjectPaths, get_paths
from .api import init_api


def create_app(base_dir: Optional[Union[str, Path, ProjectPaths]] = None) -> FastAPI:
    if isinstance(base_dir, ProjectPaths):
        paths = base_dir
    else:
        paths = get_paths(base_dir)

    static_dir = Path(__file__).parent / "static"
    static_dir.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="EmergentInc V5 Visual Control Deck")

    # Include API router
    app.include_router(init_api(paths))

    # Mount static files
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    def index():
        return FileResponse(str(static_dir / "index.html"))

    return app


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) == 0


def run_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    open_browser: bool = True,
    workspace: Optional[Union[str, Path, ProjectPaths]] = None,
):
    from .workspace_lock import WorkspaceLock
    paths = workspace if isinstance(workspace, ProjectPaths) else get_paths(workspace)
    # Acquire before recovery, browser opening, or any workspace mutation.
    with WorkspaceLock(paths.workspace_root):
        return _run_server_locked(host, port, open_browser, paths)


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
    run_server(port=args.port, open_browser=not args.no_browser, workspace=args.workspace)
