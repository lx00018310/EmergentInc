"""针对 V9.5 规范的损坏队列 Fail-Closed 拦截与隔离测试.

验收规则:
1. 消息队列文件解析失败必须抛出 QueueCorruptedError;
2. 严禁创建空队列覆盖原文件 (保存 .quarantine 副本);
3. 启动前置审计门强行拦截，抛出 409 RECOVERY_REQUIRED.
"""

import pytest
from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.router import MessageRouter
from emergentinc.engine.world import World
from emergentinc.engine.core_store import QueueCorruptedError
from emergentinc.ui.run_controller import RunController
from emergentinc.ui.loop_store import LoopStore
from fastapi import HTTPException


def test_queue_corruption_raises_error_and_creates_quarantine(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True)
    runtime_dir = ws / "runtime"
    runtime_dir.mkdir(parents=True)
    queue_file = runtime_dir / "v9_message_queue.json"

    # 写入损坏的 JSON 数据
    corrupted_data = "{bad_json: [123, invalid"
    queue_file.write_text(corrupted_data, encoding="utf-8")

    world = World(ws / "live" / "pixels")

    # 必须抛出 QueueCorruptedError
    with pytest.raises(QueueCorruptedError):
        MessageRouter(world, state_file=queue_file)

    # 验证原文件未被清空或覆盖
    assert queue_file.read_text(encoding="utf-8") == corrupted_data

    # 验证生成了 .quarantine 隔离文件
    quarantine_files = list(runtime_dir.glob("v9_message_queue*.quarantine"))
    assert len(quarantine_files) > 0
    assert quarantine_files[0].read_text(encoding="utf-8") == corrupted_data


def test_queue_corruption_blocks_run_controller_startup(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)

    # 写入损坏队列文件
    queue_file = paths.runtime_root / "v9_message_queue.json"
    queue_file.write_text("{corrupt: true,", encoding="utf-8")

    controller = RunController(paths)

    # 尝试启动 Run，必须被 _run_startup_audit 强行拦截并抛出 RECOVERY_REQUIRED 异常
    with pytest.raises(RuntimeError) as exc_info:
        controller.start(rounds=1, run_budget_tokens=10000, global_budget_tokens=100000)

    assert "RECOVERY_REQUIRED" in str(exc_info.value)
