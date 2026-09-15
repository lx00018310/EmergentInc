import pytest
from emergentinc.engine.llm import V9LLMClient, CognitiveIsolationViolation


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
