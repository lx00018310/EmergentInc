import pytest
from emergentinc.engine.world import World
from emergentinc.engine.router import MessageRouter
from emergentinc.engine.pixel import PixelState


def test_neighbor_route_success(tmp_path):
    world = World(tmp_path / "pixels")
    world.init_genesis()

    # 创建直接邻居 1_0_0 (active=True)
    n_storage = world.get_pixel_storage("1_0_0")
    n_storage.save_state(PixelState(id="1_0_0", position=[1, 0, 0], active=True, energy=1000))
    world.refresh_all_neighbors()

    router = MessageRouter(world)
    msgs, err = router.route_response(
        sender_id="0_0_0",
        send_to=["1_0_0"],
        message_content="Hello neighbor",
        current_hop=1,
        round_num=1,
    )
    assert err is None
    assert len(msgs) == 1
    assert msgs[0].sender == "0_0_0"
    assert msgs[0].recipient == "1_0_0"
    assert msgs[0].content == "Hello neighbor"
