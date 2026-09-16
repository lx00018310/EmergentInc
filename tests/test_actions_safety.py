import pytest
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState
from emergentinc.engine.world import World
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.runner import OwnerActionRequired
from emergentinc.ui.owner_bridge import OwnerBridge
from emergentinc.paths import get_paths


def test_reproduction_atomicity_and_rollback_on_failure(tmp_path):
    ledger_file = tmp_path / "ledger" / "energy_ledger.jsonl"
    mgr = EnergyManager(ledger_file)

    p_storage = PixelStorage(tmp_path / "pixels" / "0_0_0")
    p_storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=5000))
    c_storage = PixelStorage(tmp_path / "pixels" / "1_0_0")

    # 1. 心智内容超长 (>2000字) 拦截
    too_long_md = "A" * 2005
    ok, err = mgr.allocate_reproduction(p_storage, c_storage, child_energy=1000, child_pos=[1, 0, 0], child_pixel_md=too_long_md, current_round=1)
    assert ok is False
    assert "PIXEL_MD_TOO_LONG" in str(err)
    assert p_storage.load_state().energy == 5000
    assert not c_storage.dir.exists()

    # 2. 母体能量不足拦截
    ok, err = mgr.allocate_reproduction(p_storage, c_storage, child_energy=10000, child_pos=[1, 0, 0], child_pixel_md="valid mind", current_round=1)
    assert ok is False
    assert "insufficient energy" in str(err).lower()
    assert p_storage.load_state().energy == 5000
    assert not c_storage.dir.exists()

    # 3. 成功复制与能量守恒
    ok, err = mgr.allocate_reproduction(p_storage, c_storage, child_energy=1500, child_pos=[1, 0, 0], child_pixel_md="valid mind", current_round=1)
    assert ok is True
    assert p_storage.load_state().energy == 3500
    assert c_storage.load_state().energy == 1500
    assert c_storage.load_state().active is True
    assert p_storage.load_state().energy + c_storage.load_state().energy == 5000

    # 4. 再次向同一位置复制拦截 (已被占用)
    another_child_storage = PixelStorage(tmp_path / "pixels" / "1_0_0")
    ok, err = mgr.allocate_reproduction(p_storage, another_child_storage, child_energy=500, child_pos=[1, 0, 0], child_pixel_md="mind", current_round=1)
    assert ok is False
    assert "already occupied" in str(err)
    assert p_storage.load_state().energy == 3500


def test_transfer_safety_and_inactive_recipient_rejection(tmp_path):
    ledger_file = tmp_path / "ledger" / "energy_ledger.jsonl"
    mgr = EnergyManager(ledger_file)

    s1 = PixelStorage(tmp_path / "pixels" / "0_0_0")
    s2 = PixelStorage(tmp_path / "pixels" / "1_0_0")
    s1.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=2000))
    # s2 为失活元胞
    s2.save_state(PixelState(id="1_0_0", position=[1, 0, 0], active=False, energy=0))

    # 向失活元胞转账应被拒绝
    ok, err = mgr.transfer_energy(s1, s2, 500)
    assert ok is False
    assert "not active" in str(err)
    assert s1.load_state().energy == 2000
    assert s2.load_state().energy == 0

    # 激活 s2 后转账成功
    st2 = s2.load_state()
    st2.active = True
    s2.save_state(st2)

    ok, tx_id = mgr.transfer_energy(s1, s2, 500)
    assert ok is True
    assert s1.load_state().energy == 1500
    assert s2.load_state().energy == 500


def test_owner_request_action_and_bridge_feedback(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    pixels_dir = paths.live_root / "pixels"
    pixels_dir.mkdir(parents=True, exist_ok=True)

    # 准备元胞
    px = pixels_dir / "0_0_0"
    px.mkdir()
    storage = PixelStorage(px)
    storage.save_state(PixelState(
        id="0_0_0",
        position=[0, 0, 0],
        active=True,
        energy=100_000,
        inbox_call_budget_per_round=50_000,
    ))
    storage.save_pixel_md("# Genesis Pixel\n")

    # 构造 mock LLM 返回 owner_request
    class MockOwnerRequestLLM:
        model_name = "mock"
        def step(self, state_dict, pixel_md, message_md):
            return {
                "pixel_md": pixel_md,
                "owner_request": {
                    "type": "cap_deploy",
                    "description": "Need permission for external service",
                    "details": {"env": "prod"}
                },
                "send_to": ["STOP"],
            }, {
                "token_usage": {"prompt_tokens": 100, "completion_tokens": 50, "cached_tokens": 0},
                "model": "mock",
            }

    scheduler = V9RoundScheduler(tmp_path, llm_client=MockOwnerRequestLLM())
    msg = scheduler.router.create_message(
        sender="0_0_0",
        recipient="0_0_0",
        content="start round",
        hop=1,
        round_num=1,
    )
    scheduler.router.enqueue([msg])

    # 调度器执行时应抛出 OwnerActionRequired
    with pytest.raises(OwnerActionRequired):
        scheduler.run_round()

    # 检查 external_requests 目录是否成功生成请求文件
    req_files = list(scheduler.owner_requests_dir.glob("*.json"))
    assert len(req_files) == 1
    req_path = req_files[0]

    # 测试 OwnerBridge 审批批准
    bridge = OwnerBridge(paths)
    ok_app = bridge.approve_request(req_path.stem, reason="Approved by admin")
    assert ok_app.get("status") == "APPROVED"

    # 审批后应给该元胞队列投递 feedback 唤醒消息
    scheduler.router.load_state()
    assert len(scheduler.router.queue) == 1
    fb_msg = scheduler.router.queue[0]
    assert fb_msg.recipient == "0_0_0"
    assert "APPROVED" in fb_msg.content
