import pytest
import json
from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.world import World
from emergentinc.engine.router import MessageRouter, MessageEnvelope
from emergentinc.ui.run_controller import RunController
from emergentinc.ui.loop_store import LoopStore


def test_message_queue_persistence_and_restore(tmp_path):
    pixels_dir = tmp_path / "pixels"
    pixels_dir.mkdir(parents=True, exist_ok=True)
    world = World(pixels_dir)
    state_file = tmp_path / "runtime" / "v9_message_queue.json"

    # 1. 实例化 Router 并在队列中加入消息
    router1 = MessageRouter(world, state_file=state_file)
    msg1 = router1.create_message("0_0_0", "0_0_0", "msg1", 1, 1)
    msg2 = router1.create_message("0_0_0", "0_0_0", "msg2", 1, 1)
    router1.enqueue([msg1, msg2])

    assert len(router1.queue) == 2
    assert state_file.exists()

    # 2. 模拟进程重启：新建 Router 读取同一 state_file
    router2 = MessageRouter(world, state_file=state_file)
    assert len(router2.queue) == 2
    assert router2.queue[0].id == msg1.id
    assert router2.queue[0].content == "msg1"
    assert router2.queue[1].id == msg2.id
    assert router2.queue[1].content == "msg2"


def test_in_progress_crash_recovery_without_message_loss(tmp_path):
    pixels_dir = tmp_path / "pixels"
    pixels_dir.mkdir(parents=True, exist_ok=True)
    world = World(pixels_dir)
    state_file = tmp_path / "runtime" / "v9_message_queue.json"

    router1 = MessageRouter(world, state_file=state_file)
    msg1 = router1.create_message("0_0_0", "0_0_0", "msg1", 1, 1)
    msg2 = router1.create_message("0_0_0", "0_0_0", "msg2", 1, 1)
    router1.enqueue([msg1, msg2])

    # 取出 msg1 处理中
    popped = router1.pop_next()
    assert popped.id == msg1.id
    assert len(router1.queue) == 1
    # 注意此时尚未调用 commit_in_progress，模拟进程在此刻崩溃断电

    # 3. 崩溃后重启
    router2 = MessageRouter(world, state_file=state_file)
    # 未提交的消息必须被恢复至队首
    assert len(router2.queue) == 2
    assert router2.queue[0].id == msg1.id
    assert router2.queue[1].id == msg2.id


def test_consumed_message_idempotent_deduplication(tmp_path):
    pixels_dir = tmp_path / "pixels"
    pixels_dir.mkdir(parents=True, exist_ok=True)
    world = World(pixels_dir)
    state_file = tmp_path / "runtime" / "v9_message_queue.json"

    router1 = MessageRouter(world, state_file=state_file)
    msg = router1.create_message("0_0_0", "0_0_0", "important_msg", 1, 1)
    router1.enqueue([msg])

    # 完整消费并提交
    popped = router1.pop_next()
    router1.commit_in_progress(popped)
    assert len(router1.queue) == 0

    # 模拟重启
    router2 = MessageRouter(world, state_file=state_file)
    assert msg.id in router2.consumed_ids

    # 尝试再次入队已被消费过的同一条消息 -> 自动去重被丢弃
    router2.enqueue([msg])
    assert len(router2.queue) == 0


def test_recover_stale_running_loops(tmp_path):
    paths = get_paths(tmp_path)
    store = LoopStore(paths)

    # 制造一个假死的 RUNNING 状态 Loop (如上次断电前遗留)
    loop_meta = store.start_loop(command_text="run_test", start_round=1)
    loop_id = loop_meta["id"]
    assert store.get_loop(loop_id)["status"] == "RUNNING"

    # 启动 RunController 时自动执行 _recover_stale_loops
    controller = RunController(paths)

    # 验证该 Loop 状态被修复为 INTERRUPTED，原因记为 PROCESS_RESTARTED
    recovered_loop = store.get_loop(loop_id)
    assert recovered_loop["status"] == "INTERRUPTED"
    assert recovered_loop["stop_reason"] == "PROCESS_RESTARTED"
