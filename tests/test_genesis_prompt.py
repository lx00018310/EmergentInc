import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from emergentinc.paths import get_paths
from emergentinc.engine.genesis import GenesisPromptManager, MAX_GENESIS_PROMPT_CHARS, INITIAL_GENESIS_PROMPT
from emergentinc.engine.llm import V9LLMClient
from emergentinc.ui.app import create_app
from emergentinc.ui.loop_store import LoopStore


def test_genesis_prompt_manager_initialization_and_normalization(tmp_path):
    runtime_dir = tmp_path / "runtime"
    mgr = GenesisPromptManager(runtime_dir)

    # 1. 首次初始化
    prompt_data = mgr.get_prompt()
    assert prompt_data["revision"] == 1
    assert prompt_data["active"] is True
    assert "\r" not in prompt_data["content"]
    assert prompt_data["content"] == INITIAL_GENESIS_PROMPT.replace("\r\n", "\n")

    # 2. 内容未变时 update，不增加 revision
    same_update = mgr.update_prompt(INITIAL_GENESIS_PROMPT)
    assert same_update["revision"] == 1

    # 3. 内容修改，递增 revision 并归一化换行
    custom_content = "Line1\r\nLine2\r\nLine3"
    updated = mgr.update_prompt(custom_content)
    assert updated["revision"] == 2
    assert updated["content"] == "Line1\nLine2\nLine3"
    assert "\r" not in updated["content"]
    assert updated["active"] is True

    # 4. 超长字符上限拦截 (12,000 字)
    with pytest.raises(ValueError) as exc:
        mgr.update_prompt("A" * (MAX_GENESIS_PROMPT_CHARS + 1))
    assert "exceeds maximum allowed" in str(exc.value)


def test_genesis_prompt_clearing_and_restart_persistence(tmp_path):
    runtime_dir = tmp_path / "runtime"
    mgr1 = GenesisPromptManager(runtime_dir)

    # 清空创世提示词
    cleared = mgr1.update_prompt("   \n\r\n   ")
    assert cleared["content"] == ""
    assert cleared["active"] is False
    assert cleared["revision"] == 2

    # 模拟应用重启，实例化新 Manager
    mgr2 = GenesisPromptManager(runtime_dir)
    reloaded = mgr2.get_prompt()
    # 必须保持为空，严禁覆盖或自动恢复默认提示词
    assert reloaded["content"] == ""
    assert reloaded["active"] is False
    assert reloaded["revision"] == 2


def test_genesis_prompt_api_update_and_conflict(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)

    app = create_app(paths)
    client = TestClient(app)

    # 1. GET 初始提示词
    get_res = client.get("/api/genesis-prompt")
    assert get_res.status_code == 200
    assert get_res.json()["revision"] == 1

    # 2. 空闲状态下 PUT 更新
    put_res = client.put("/api/genesis-prompt", json={"content": "New Genesis Rule\nBe emergent."})
    assert put_res.status_code == 200
    assert put_res.json()["revision"] == 2
    assert put_res.json()["active"] is True
    assert "New Genesis Rule" in put_res.json()["content"]

    # 验证清空接口：
    clear_res = client.put("/api/genesis-prompt", json={"content": ""})
    assert clear_res.status_code == 200
    assert clear_res.json()["active"] is False


def test_genesis_prompt_survives_checkout_and_branching(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)

    gen_mgr = GenesisPromptManager(paths.runtime_root)
    gen_mgr.update_prompt("Custom Persistent Rule Across Branches")
    rev_before = gen_mgr.get_prompt()["revision"]

    store = LoopStore(paths)
    loop_meta = store.start_loop(command_text="test", start_round=1)
    store.finish_loop(loop_meta["id"], end_round=1, status="COMPLETED")
    store.checkout_loop(loop_meta["id"], new_branch_name="feature_test")

    # 验证创世提示词不受分支切换影响
    current_prompt = gen_mgr.get_prompt()
    assert current_prompt["content"] == "Custom Persistent Rule Across Branches"
    assert current_prompt["revision"] == rev_before


def test_llm_genesis_injection_and_strict_three_input_isolation(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)

    captured_payload = {}

    def mock_step_handler(payload):
        nonlocal captured_payload
        captured_payload = payload
        return {
            "pixel_md": payload["pixel_md"] + "\nlearned something",
            "message_md": "hello",
            "send_to": ["SELF"],
        }

    client = V9LLMClient(base_dir=tmp_path, mock_handler=mock_step_handler)

    # 锁定创世提示词
    client.lock_genesis_prompt(prompt_text="Explore the unknown world.", revision=3)

    resp, audit = client.step(
        state_dict={"id": "0_0_0", "position": [0, 0, 0], "active": True, "energy": 5000},
        pixel_md="# Mind",
        message_md="Hello neighbor",
    )

    # 1. 严格三输入隔离检查
    assert set(captured_payload.keys()) == {"state", "pixel_md", "message_md"}
    # 创世提示词绝未混入 message_md 或 pixel_md
    assert "Explore the unknown world." not in captured_payload["message_md"]
    assert "Explore the unknown world." not in captured_payload["pixel_md"]

    # 2. 审计与版本追踪
    assert audit["genesis_revision"] == 3
    assert "effective_prompt_hash" in audit

    # 3. 清空创世提示词
    client.lock_genesis_prompt(prompt_text="", revision=4)
    resp2, audit2 = client.step(
        state_dict={"id": "0_0_0", "position": [0, 0, 0], "active": True, "energy": 5000},
        pixel_md="# Mind",
        message_md="Hello neighbor",
    )
    assert audit2["genesis_revision"] == 4
    # 未启用创世提示词时的 prompt hash 与有创世词时不同
    assert audit2["effective_prompt_hash"] != audit["effective_prompt_hash"]
