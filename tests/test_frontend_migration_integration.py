"""前端 React + TypeScript 迁移与 FastAPI 静态托管集成测试."""

from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

from emergentinc.paths import get_paths
from emergentinc.ui.app import create_app


def test_frontend_dist_serving(tmp_path):
    paths = get_paths(tmp_path)
    app = create_app(paths)
    client = TestClient(app)

    # 1. 验证生产构建产物存在时，根路径正常服务单页应用
    r_root = client.get("/")
    assert r_root.status_code == 200
    assert '<div id="root"></div>' in r_root.text
    assert "/assets/" in r_root.text

    # 2. 验证 API 路由优先响应且未受客户端单页影响
    r_api = client.get("/api/run/status")
    assert r_api.status_code == 200
    assert "running" in r_api.json()

    # 3. 验证未知的 API 路径维持 JSON 404
    r_404 = client.get("/api/unknown_endpoint_xyz")
    assert r_404.status_code == 404
    assert r_404.json() == {"detail": "Not Found"}


def test_frontend_dist_missing_returns_503(tmp_path):
    paths = get_paths(tmp_path)

    # 模拟 frontend/dist 不存在的情况
    fake_empty_dir = tmp_path / "empty_frontend_dist"
    fake_empty_dir.mkdir(parents=True, exist_ok=True)

    with patch.object(type(paths), "frontend_dist", new=fake_empty_dir):
        app = create_app(paths)
        client = TestClient(app)

        r_root = client.get("/")
        assert r_root.status_code == 503
        assert "前端构建产物未就绪" in r_root.text
        assert "npm run build" in r_root.text

        # API 依然能独立服务
        r_api = client.get("/api/run/status")
        assert r_api.status_code == 200
