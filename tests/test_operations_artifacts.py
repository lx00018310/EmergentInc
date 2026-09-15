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


def test_isolated_code_execution_security_and_timeout(tmp_path):
    executor = OperationExecutor(tmp_path / "artifacts")

    # 1. 正常执行
    code_ok = "print('compute result:', 21 * 2)"
    r_ok = executor._dispatch("0_0_0", "run_isolated_code", {"code": code_ok})
    assert r_ok.status == "SUCCESS"
    assert "compute result: 42" in r_ok.output["stdout"]

    # 2. 超时保护
    code_timeout = "import time; time.sleep(10)"
    r_timeout = executor._dispatch("0_0_0", "run_isolated_code", {"code": code_timeout, "timeout": 1})
    assert r_timeout.status == "FAILED"
    assert "timed out" in r_timeout.error
