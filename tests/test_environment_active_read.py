import pytest
from pathlib import Path
from emergentinc.engine.scheduler import V9RoundScheduler


def test_environment_active_read(tmp_path):
    # 第一步请求读环境，第二步接收到环境后停止
    call_count = 0
    seen_in_step_2 = ""

    def mock_decide(payload):
        nonlocal call_count, seen_in_step_2
        call_count += 1
        if call_count == 1:
            return {
                "pixel_md": "I want to see the environment.",
                "message_md": "",
                "send_to": ["STOP"],
                "environment_read": True,
                "reproduce": None,
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }
        else:
            seen_in_step_2 = payload.get("message_md", "")
            return {
                "pixel_md": "I have seen the environment.",
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
    sched.env.update_content("MARKET_OPPORTUNITY: Payment >= 1 CNY")

    init_msg = sched.router.create_message(
        sender="SYSTEM", recipient="0_0_0", content="Start", hop=1, round_num=1
    )
    sched.router.enqueue([init_msg])

    sched.run_round()

    assert call_count == 2
    assert "MARKET_OPPORTUNITY: Payment >= 1 CNY" in seen_in_step_2
