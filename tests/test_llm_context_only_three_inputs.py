import pytest
from pathlib import Path
from types import SimpleNamespace
from emergentinc.engine.llm import V9LLMClient, CognitiveIsolationViolation, LLMResponseError


def test_cognitive_isolation_strict_three_inputs(tmp_path):
    received_payload = {}

    def mock_decide(payload):
        nonlocal received_payload
        received_payload = payload
        return {
            "pixel_md": "my mind",
            "message_md": "my reply",
            "send_to": ["STOP"],
            "environment_read": False,
            "reproduce": None,
            "energy_transfer": [],
            "owner_request": None,
            "operations": [],
        }

    client = V9LLMClient(mock_handler=mock_decide)

    state = {
        "id": "0_0_0",
        "position": [0, 0, 0],
        "active": True,
        "energy": 100000000,
        "neighbors": [{"id": "1_0_0", "active": True}],
    }
    pixel_md = "# Mind\nI am exploring."
    message_md = "Incoming task"

    data, audit = client.step(state, pixel_md, message_md)

    # 验证且仅有 3 个输入键
    assert set(received_payload.keys()) == {"state", "pixel_md", "message_md"}
    assert "world_state" not in received_payload
    assert "market" not in received_payload
    assert "global_ranking" not in received_payload
    assert "history" not in received_payload
    assert audit["kind"] == "V9_STEP"


def test_system_prompt_no_role_predefinitions():
    client = V9LLMClient()
    prompt = client.system_prompt
    forbidden_terms = ["CEO", "Manager", "Role", "Department", "Contract", "Marketplace", "招聘", "部门"]
    for term in forbidden_terms:
        assert term not in prompt, f"System prompt should not predefine '{term}'"


def test_normalize_pixel_response_robustness():
    from emergentinc.engine.llm import normalize_pixel_response

    # 模拟真实大模型可能返回的各种异构字段格式
    raw_imperfect = {
        "read_environment": True,
        "pixel_md": "# Test Mind",
        "messages": [{"target": "SELF", "content": "Hello Self"}],
        "reproductions": [],
        "energy_transfers": None,
        "extra_field_unwanted": 123,
    }
    normalized = normalize_pixel_response(raw_imperfect, fallback_pixel_md="# Fallback")

    assert normalized["environment_read"] is True
    assert normalized["pixel_md"] == "# Test Mind"
    assert normalized["message_md"] == "Hello Self"
    assert normalized["send_to"] == ["SELF"]
    assert normalized["reproduce"] is None
    assert normalized["energy_transfer"] == []
    assert normalized["owner_request"] is None
    assert normalized["operations"] == []
    assert "read_environment" not in normalized
    assert "messages" not in normalized
    assert "extra_field_unwanted" not in normalized


def test_invalid_json_response_preserves_usage_for_settlement():
    project_root = Path(__file__).resolve().parents[1]
    client = V9LLMClient(base_dir=project_root)
    client.model_name = "glm-5.3-flash"
    captured_request = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured_request.update(kwargs)
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content=""))],
                usage=SimpleNamespace(
                    prompt_tokens=1200,
                    completion_tokens=25,
                    cached_tokens=100,
                    total_tokens=1225,
                ),
            )

    client.client = SimpleNamespace(
        chat=SimpleNamespace(completions=FakeCompletions())
    )

    with pytest.raises(LLMResponseError) as exc_info:
        client.step({"id": "0_0_0"}, "# Pixel", "hello")

    err = exc_info.value
    assert err.raw_response == ""
    assert err.model == "glm-5.3-flash"
    assert err.token_usage == {
        "prompt_tokens": 1200,
        "completion_tokens": 25,
        "cached_tokens": 100,
        "total_tokens": 1225,
    }
    assert captured_request["max_completion_tokens"] == 8192
    assert captured_request["reasoning_effort"] == "low"
    assert "max_tokens" not in captured_request
