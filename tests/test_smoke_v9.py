"""V9 Smoke Test (Plan 第 56 节冒烟测试).

验证 Kernel:
1. Environment 初始存在数字 42。
2. Pixel 启动，主动读取 Environment。
3. Pixel 获知数字 42 并记入 pixel.md。
4. Pixel 在直接邻接空位复制子代，并划拨能量。
"""

import pytest
from pathlib import Path
from emergentinc.engine.scheduler import V9RoundScheduler


def test_v9_kernel_smoke(tmp_path):
    step_count = 0

    def mock_decide(payload):
        nonlocal step_count
        step_count += 1
        st = payload.get("state", {})
        pid = st.get("id")
        msg = payload.get("message_md", "")
        current_mind = payload.get("pixel_md", "")

        if step_count == 1:
            # 第一步: 主动读环境
            return {
                "pixel_md": "Step 1: I need to explore the environment.",
                "message_md": "",
                "send_to": ["STOP"],
                "environment_read": True,
                "reproduce": None,
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }
        elif step_count == 2:
            # 第二步: 收到环境消息 (含有 42)，记入心智，并复制子代到 [1, 0, 0]
            assert "42" in msg
            return {
                "pixel_md": "Step 2: Discovered external truth 42. Spawning helper.",
                "message_md": "Child, truth is 42",
                "send_to": ["1_0_0"],
                "environment_read": False,
                "reproduce": {
                    "target": [1, 0, 0],
                    "child_energy": 20000000,
                    "child_pixel_md": "Inherited truth: 42",
                },
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }
        elif step_count == 3:
            # 第三步: 子代醒来，确认心智并停止
            assert pid == "1_0_0"
            assert "42" in current_mind
            return {
                "pixel_md": "Child active. Truth 42 verified.",
                "message_md": "",
                "send_to": ["STOP"],
                "environment_read": False,
                "reproduce": None,
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }

    sched = V9RoundScheduler(workspace_dir=tmp_path, mock_handler=mock_decide)
    sched.world.init_genesis(initial_energy=100000000, initial_pixel_md="Genesis Pixel ready.")
    sched.env.update_content("# Environment\n\n存在一个数字：42。")

    # 投递创世唤醒消息
    init_msg = sched.router.create_message(
        sender="SYSTEM", recipient="0_0_0", content="Awaken", hop=1, round_num=1
    )
    sched.router.enqueue([init_msg])

    res = sched.run_round()

    # 验证创世元胞心智记录了 42
    p0_storage = sched.world.get_pixel_storage("0_0_0")
    assert "Discovered external truth 42" in p0_storage.load_pixel_md()

    # 验证子代元胞成功生成并在物理网格中激活
    assert sched.world.is_occupied((1, 0, 0))
    p1_storage = sched.world.get_pixel_storage("1_0_0")
    assert p1_storage.exists()
    assert p1_storage.load_state().active is True
    # 子代经历了一次醒来决策调用，扣除其实际调用的少量 token
    child_energy = p1_storage.load_state().energy
    assert child_energy < 20000000
    assert child_energy >= 19990000
    assert "Truth 42 verified" in p1_storage.load_pixel_md()

    # 验证系统总能量守恒 (扣除了调用的少量 token，无凭空增发)
    total_energy = p0_storage.load_state().energy + p1_storage.load_state().energy
    assert total_energy <= 100000000
    assert total_energy > 99000000
