import pytest
from pathlib import Path
from emergentinc.engine.scheduler import V9RoundScheduler


def test_environment_not_auto_visible(tmp_path):
    # 模拟 LLM 决策，不读取环境
    seen_messages = []

    def mock_decide(payload):
        seen_messages.append(payload.get("message_md", ""))
        return {
            "pixel_md": "thinking",
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
    sched.env.update_content("SECRET_ENVIRONMENT_TRUTH_12345")

    # 手动投递一条普通唤醒消息
    init_msg = sched.router.create_message(
        sender="SYSTEM", recipient="0_0_0", content="Wake up", hop=1, round_num=1
    )
    sched.router.enqueue([init_msg])

    sched.run_round()

    # 验证元胞看到的输入绝不包含环境事实
    for msg_content in seen_messages:
        assert "SECRET_ENVIRONMENT_TRUTH_12345" not in msg_content
