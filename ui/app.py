import sys
import socket
import webbrowser
import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn

from .api import init_api

def create_app(base_dir: str | Path = '.') -> FastAPI:
    base = Path(base_dir).resolve()
    static_dir = Path(__file__).parent / 'static'
    static_dir.mkdir(parents=True, exist_ok=True)

    app = FastAPI(title="EmergentInc V5 Visual Control Deck")

    # Include API router
    app.include_router(init_api(base))

    # Mount static files
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    def index():
        return FileResponse(str(static_dir / 'index.html'))

    return app

def is_port_in_use(port: int, host: str = '127.0.0.1') -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex((host, port)) == 0

def run_server(host: str = "127.0.0.1", port: int = 8765, open_browser: bool = True):
    if host != "127.0.0.1":
        print("[SECURITY WARNING] Overriding host to 127.0.0.1 for local sandbox isolation.")
        host = "127.0.0.1"

    if is_port_in_use(port, host):
        print(f"[PORT CONFLICT] Port {port} on {host} is already in use.")
        # Try finding next available port
        for fallback_port in range(port + 1, port + 20):
            if not is_port_in_use(fallback_port, host):
                port = fallback_port
                print(f"[FALLBACK] Using port {port} instead.")
                break

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

    app = create_app('.')
    uvicorn.run(app, host=host, port=port, log_level="warning")

if __name__ == '__main__':
    run_server()
