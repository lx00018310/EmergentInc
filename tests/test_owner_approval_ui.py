import json

import pytest
from fastapi.testclient import TestClient

from emergentinc.engine.utils import write_json
from emergentinc.engine.router import MessageRouter
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


def test_pending_owner_request_survives_controller_restart_and_does_not_block_run(tmp_path):
    paths = make_pending_request(tmp_path)
    controller = RunController(paths)
    assert controller.status()["pending_owner_requests"] == ["req_6_test"]
    # V9 本地闭环精简标准：待审批请求不再阻断 Run 启动
    res = controller.start(1)
    assert res["running"] is True
    assert controller._worker_thread is not None
    controller._worker_thread.join(timeout=5)
    # 历史请求文件未被篡改或清空
    req_data = json.loads((paths.live_root / "external_requests" / "req_6_test.json").read_text(encoding="utf-8"))
    assert req_data["status"] == "PENDING_OWNER"


def test_generic_v9_request_can_be_approved_without_profile_file(tmp_path):
    paths = make_pending_request(tmp_path)
    world = World(paths.live_root / "pixels")
    router = MessageRouter(world, state_file=paths.runtime_root / "v9_message_queue.json")
    old_message = router.create_message(
        sender="0_0_0",
        recipient="0_0_0",
        content="older queued message",
        hop=1,
        round_num=5,
    )
    router.enqueue([old_message])

    # 1. 验证 HTTP 写端点已断开 (404/405)
    with TestClient(create_app(paths)) as client:
        response = client.post(
            "/api/owner/requests/req_6_test/approve",
            json={"reason": "Use the owner-provided public page; no payment authority granted."},
        )
        assert response.status_code in (404, 405)

    # 2. 验证底层 OwnerBridge 核心实现完整保留
    from emergentinc.ui.owner_bridge import OwnerBridge
    bridge = OwnerBridge(paths)
    app_res = bridge.approve_request(
        "req_6_test",
        reason="Use the owner-provided public page; no payment authority granted."
    )
    assert app_res["status"] == "APPROVED"
    assert bridge.list_requests(pending_only=True) == []

    queue = json.loads((paths.runtime_root / "v9_message_queue.json").read_text(encoding="utf-8"))
    assert len(queue["queue"]) == 2
    assert "APPROVED" in queue["queue"][0]["content"]
    assert queue["queue"][1]["id"] == old_message.id
