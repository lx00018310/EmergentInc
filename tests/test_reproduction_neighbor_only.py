import pytest
from pathlib import Path
from emergentinc.engine.scheduler import V9RoundScheduler


def test_reproduction_neighbor_only(tmp_path):
    # 尝试在非直接邻居 [3, 0, 0] 复制，必须失败
    received_feedback = []

    def mock_decide(payload):
        msg = payload.get("message_md", "")
        if "[ENGINE_FEEDBACK]" in msg:
            received_feedback.append(msg)
            return {
                "pixel_md": "mind",
                "message_md": "",
                "send_to": ["STOP"],
                "environment_read": False,
                "reproduce": None,
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }
        return {
            "pixel_md": "mind",
            "message_md": "",
            "send_to": ["STOP"],
            "environment_read": False,
            "reproduce": {
                "target": [3, 0, 0],
                "child_energy": 5000,
                "child_pixel_md": "I am child",
            },
            "energy_transfer": [],
            "owner_request": None,
            "operations": [],
        }

    sched = V9RoundScheduler(workspace_dir=tmp_path, mock_handler=mock_decide)
    sched.world.init_genesis(initial_energy=100000)

    init_msg = sched.router.create_message(
        sender="SYSTEM", recipient="0_0_0", content="Start", hop=1, round_num=1
    )
    sched.router.enqueue([init_msg])

    sched.run_round()

    assert any("not a direct neighbor" in fb for fb in received_feedback)
    assert not sched.world.is_occupied((3, 0, 0))
