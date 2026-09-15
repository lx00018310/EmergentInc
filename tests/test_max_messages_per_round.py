import pytest
from emergentinc.engine.world import World
from emergentinc.engine.router import MessageRouter, MAX_MESSAGES_PER_ROUND


def test_max_messages_per_round_delayed_queue(tmp_path):
    world = World(tmp_path / "pixels")
    world.init_genesis()
    router = MessageRouter(world)

    # 尝试一次排入 120 条消息
    msgs = [
        router.create_message("0_0_0", "0_0_0", f"msg_{i}", 1, 1)
        for i in range(120)
    ]
    router.enqueue(msgs)

    # 主队列应最多有 MAX_MESSAGES_PER_ROUND = 100
    assert len(router.queue) == MAX_MESSAGES_PER_ROUND
    # 延期队列容纳超出的 20 条
    assert len(router.delayed_queue) == 20

    # 模拟消费当前轮的 100 条消息
    consumed = 0
    while router.pop_next():
        consumed += 1
    assert consumed == MAX_MESSAGES_PER_ROUND
    assert len(router.queue) == 0

    # 切换到下一回合
    router.roll_to_next_round()
    # 延期队列转入主队列
    assert len(router.queue) == 20
    assert len(router.delayed_queue) == 0
