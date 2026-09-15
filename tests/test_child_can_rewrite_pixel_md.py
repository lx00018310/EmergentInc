import pytest
from pathlib import Path
from emergentinc.engine.scheduler import V9RoundScheduler


def test_child_can_rewrite_pixel_md(tmp_path):
    round_decisions = {}

    def mock_decide(payload):
        st = payload.get("state", {})
        pid = st.get("id")
        if pid == "0_0_0":
            # 母体繁殖子代 [1, 0, 0]，并给初始心智
            return {
                "pixel_md": "Parent mind",
                "message_md": "Hello child",
                "send_to": ["1_0_0"],
                "environment_read": False,
                "reproduce": {
                    "target": [1, 0, 0],
                    "child_energy": 50000,
                    "child_pixel_md": "Parent taught me to be X.",
                },
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }
        elif pid == "1_0_0":
            # 子代醒来，彻底推翻并重写自身心智
            return {
                "pixel_md": "I rewrite myself completely to be Y.",
                "message_md": "",
                "send_to": ["STOP"],
                "environment_read": False,
                "reproduce": None,
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

    child_storage = sched.world.get_pixel_storage("1_0_0")
    assert child_storage.exists()
    assert child_storage.load_pixel_md() == "I rewrite myself completely to be Y."
