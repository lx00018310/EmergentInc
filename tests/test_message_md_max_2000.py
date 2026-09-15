import pytest
from emergentinc.engine.router import validate_message_md, MAX_MESSAGE_MD_CHARS, MessageRouter
from emergentinc.engine.world import World


def test_message_md_length_limit(tmp_path):
    world = World(tmp_path / "pixels")
    router = MessageRouter(world)

    valid_text = "M" * MAX_MESSAGE_MD_CHARS
    ok, err = validate_message_md(valid_text)
    assert ok is True
    assert err is None

    invalid_text = "M" * (MAX_MESSAGE_MD_CHARS + 1)
    ok, err = validate_message_md(invalid_text)
    assert ok is False
    assert "MESSAGE_TOO_LONG" in err

    # 路由器处理超长消息时应拦截并返回错误反馈给发送者自身
    msgs, err_routed = router.route_response(
        sender_id="0_0_0",
        send_to=["SELF"],
        message_content=invalid_text,
        current_hop=1,
        round_num=1,
    )
    assert len(msgs) == 1
    assert msgs[0].is_feedback is True
    assert msgs[0].recipient == "0_0_0"
    assert "MESSAGE_TOO_LONG" in msgs[0].content
