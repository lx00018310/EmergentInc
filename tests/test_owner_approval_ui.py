import json

import pytest
from fastapi.testclient import TestClient

from emergentinc.engine.utils import write_json
from emergentinc.engine.world import World
from emergentinc.paths import get_paths
from emergentinc.ui.app import create_app
from emergentinc.ui.run_controller import RunController


def make_pending_request(tmp_path):
    paths = get_paths(tmp_path)
    World(paths.live_root / "pixels").init_genesis()
    write_json(paths.live_root / "world_state.json", {"round": 6})
    request = {
        "id": "req_6_test",
        "request_id": "req_6_test",
        "pixel_id": "0_0_0",
        "round": 6,
        "type": "channel_support",
        "description": "Need an external channel",
        "status": "PENDING_OWNER",
    }
    write_json(paths.live_root / "external_requests" / "req_6_test.json", request)
    return paths


def test_pending_owner_request_survives_controller_restart_and_blocks_run(tmp_path):
    paths = make_pending_request(tmp_path)
    controller = RunController(paths)
    assert controller.status()["pending_owner_requests"] == ["req_6_test"]
    with pytest.raises(RuntimeError, match="OWNER_ACTION_REQUIRED"):
        controller.start(1)


def test_generic_v9_request_can_be_approved_without_profile_file(tmp_path):
    paths = make_pending_request(tmp_path)
    with TestClient(create_app(paths)) as client:
        response = client.post(
            "/api/owner/requests/req_6_test/approve",
            json={"reason": "Use the owner-provided public page; no payment authority granted."},
        )
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "APPROVED"
        requests = client.get("/api/owner/requests").json()
        assert requests[0]["status"] == "APPROVED"
        status = client.get("/api/run/status").json()
        assert status["pending_owner_requests"] == []

    queue = json.loads((paths.runtime_root / "v9_message_queue.json").read_text(encoding="utf-8"))
    assert len(queue["queue"]) == 1
    assert "APPROVED" in queue["queue"][0]["content"]
