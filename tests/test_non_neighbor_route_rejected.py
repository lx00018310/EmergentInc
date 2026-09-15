import pytest
from emergentinc.engine.world import World
from emergentinc.engine.router import MessageRouter
from emergentinc.engine.pixel import PixelState


def test_non_neighbor_route_rejected(tmp_path):
    world = World(tmp_path / "pixels")
    world.init_genesis()

    # 创建远距离节点 5_5_5
    far_storage = world.get_pixel_storage("5_5_5")
    far_storage.save_state(PixelState(id="5_5_5", position=[5, 5, 5], active=True, energy=1000))

    router = MessageRouter(world)
    msgs, err = router.route_response(
        sender_id="0_0_0",
        send_to=["5_5_5"],
        message_content="Far call",
        current_hop=1,
        round_num=1,
    )
    # 应当拦截并生成反馈给自身
    assert len(msgs) == 1
    assert msgs[0].is_feedback is True
    assert msgs[0].recipient == "0_0_0"
    assert "not a direct 3D neighbor" in msgs[0].content


def test_inactive_neighbor_route_rejected(tmp_path):
    world = World(tmp_path / "pixels")
    world.init_genesis()

    # 创建死掉的直接邻居 1_0_0 (active=False)
    dead_storage = world.get_pixel_storage("1_0_0")
    dead_storage.save_state(PixelState(id="1_0_0", position=[1, 0, 0], active=False, energy=0))

    router = MessageRouter(world)
    msgs, err = router.route_response(
        sender_id="0_0_0",
        send_to=["1_0_0"],
        message_content="Hello dead neighbor",
        current_hop=1,
        round_num=1,
    )
    assert len(msgs) == 1
    assert msgs[0].is_feedback is True
    assert msgs[0].recipient == "0_0_0"
    assert "not an active neighbor" in msgs[0].content
