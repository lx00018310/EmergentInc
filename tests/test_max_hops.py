import pytest
from pathlib import Path
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.router import MAX_HOPS_PER_ROUND


def test_max_hops_per_round(tmp_path):
    hop_feedback_seen = False

    def mock_decide(payload):
        nonlocal hop_feedback_seen
        msg = payload.get("message_md", "")
        if "MAX_HOPS_REACHED" in msg:
            hop_feedback_seen = True
            return {
                "pixel_md": "stop thinking",
                "message_md": "",
                "send_to": ["STOP"],
                "environment_read": False,
                "reproduce": None,
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }
        # 无限 SELF 循环
        return {
            "pixel_md": "looping",
            "message_md": "again",
            "send_to": ["SELF"],
            "environment_read": False,
            "reproduce": None,
            "energy_transfer": [],
            "owner_request": None,
            "operations": [],
        }

    sched = V9RoundScheduler(workspace_dir=tmp_path, mock_handler=mock_decide)
    sched.world.init_genesis(initial_energy=1000000)

    init_msg = sched.router.create_message(
        sender="SYSTEM", recipient="0_0_0", content="Start loop", hop=1, round_num=1
    )
    sched.router.enqueue([init_msg])

    res1 = sched.run_round()
    # 第一轮应在 MAX_HOPS_PER_ROUND 处强制结束
    assert res1["hops_executed"] >= MAX_HOPS_PER_ROUND

    # 第二轮元胞收到反馈消息
    res2 = sched.run_round()
    assert hop_feedback_seen is True
