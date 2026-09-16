import pytest
from pathlib import Path
from emergentinc.engine.operations import OperationExecutor


def test_operations_artifact_save_and_read(tmp_path):
    executor = OperationExecutor(tmp_path / "artifacts")

    ops = [
        {"tool": "save_artifact", "args": {"filename": "report.txt", "content": "Hello World Deliverable"}},
        {"tool": "read_artifact", "args": {"filename": "report.txt"}},
        {"tool": "list_artifacts", "args": {}},
    ]

    receipts, feedback = executor.execute_all("0_0_0", ops)
    assert len(receipts) == 3
    assert all(r.status == "SUCCESS" for r in receipts)
    assert "[ENGINE_FEEDBACK]" in feedback
    assert "Hello World Deliverable" in receipts[1].output["content"]
    assert len(receipts[2].output["artifacts"]) == 1


def test_isolated_code_execution_disabled_when_no_sandbox(tmp_path):
    executor = OperationExecutor(tmp_path / "artifacts")

    # 1. 任意代码执行均被安全阻断
    code_ok = "print('compute result:', 21 * 2)"
    r_ok = executor._dispatch("0_0_0", "run_isolated_code", {"code": code_ok})
    assert r_ok.status == "FAILED"
    assert "CAPABILITY_UNAVAILABLE" in r_ok.error

    # 2. 超时或危险调用同样安全返回不可用
    code_timeout = "import time; time.sleep(10)"
    r_timeout = executor._dispatch("0_0_0", "run_isolated_code", {"code": code_timeout, "timeout": 1})
    assert r_timeout.status == "FAILED"
    assert "CAPABILITY_UNAVAILABLE" in r_timeout.error


def test_artifact_security_boundaries(tmp_path):
    executor = OperationExecutor(tmp_path / "artifacts")

    # 1. 保存正常文件
    r_save = executor._dispatch("0_0_0", "save_artifact", {"filename": "data.txt", "content": "secret 123"})
    assert r_save.status == "SUCCESS"

    # 2. 跨 Pixel 读取被严格拒绝
    r_cross = executor._dispatch("0_0_0", "read_artifact", {"pixel_id": "0_0_1", "filename": "data.txt"})
    assert r_cross.status == "FAILED"
    assert "CROSS_PIXEL_READ_FORBIDDEN" in r_cross.error

    # 3. 路径穿越 (..) 拒绝
    r_traverse = executor._dispatch("0_0_0", "save_artifact", {"filename": "../escape.txt", "content": "bad"})
    assert r_traverse.status == "FAILED"

    # 4. 冒号 (Windows ADS) 拒绝
    r_ads = executor._dispatch("0_0_0", "save_artifact", {"filename": "data.txt:stream", "content": "bad"})
    assert r_ads.status == "FAILED"

    # 5. 非法 pixel_id 拒绝
    r_inv_pid = executor._dispatch("invalid/path", "save_artifact", {"filename": "test.txt", "content": "bad"})
    assert r_inv_pid.status == "FAILED"

