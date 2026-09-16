"""针对 V9.5 规范的 Genesis 提示词 API 强类型校验测试.

验收规则:
1. content 传入 null、数组、对象等非法类型直接返回 422;
2. 严禁自动转为 "None";
3. 空字符串 "" 合法并表示关闭.
"""

import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from emergentinc.paths import get_paths
from emergentinc.engine.storage import Storage
from emergentinc.ui.app import create_app


@pytest.fixture
def api_client(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)

    app = create_app(paths)
    return TestClient(app)


def test_genesis_prompt_update_rejects_non_string_types(api_client):
    # 1. 传入 null
    res = api_client.put("/api/genesis-prompt", json={"content": None})
    assert res.status_code == 422

    # 2. 传入列表
    res = api_client.put("/api/genesis-prompt", json={"content": ["some", "prompt"]})
    assert res.status_code == 422

    # 3. 传入字典对象
    res = api_client.put("/api/genesis-prompt", json={"content": {"key": "val"}})
    assert res.status_code == 422

    # 4. 传入布尔值
    res = api_client.put("/api/genesis-prompt", json={"content": True})
    assert res.status_code == 422

    # 5. 传入合法空字符串 (关闭)
    res = api_client.put("/api/genesis-prompt", json={"content": ""})
    assert res.status_code == 200
    data = res.json()
    assert data["active"] is False

    # 6. 传入合法提示词文本
    res = api_client.put("/api/genesis-prompt", json={"content": "You are cell #001."})
    assert res.status_code == 200
    data = res.json()
    assert data["active"] is True
    assert data["content"] == "You are cell #001."
