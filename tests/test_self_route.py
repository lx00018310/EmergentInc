import pytest
from emergentinc.engine.world import World
from emergentinc.engine.router import MessageRouter


def test_self_route(tmp_path):
    world = World(tmp_path / "pixels")
    world.init_genesis()
    router = MessageRouter(world)

    msgs, err = router.route_response(
        sender_id="0_0_0",
        send_to=["SELF"],
        message_content="Thinking alone",
        current_hop=1,
        round_num=1,
    )
    assert err is None
    assert len(msgs) == 1
    assert msgs[0].sender == "0_0_0"
    assert msgs[0].recipient == "0_0_0"
    assert msgs[0].content == "Thinking alone"
    assert msgs[0].hop == 2
