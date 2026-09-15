import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.validator import RuleValidator
from emergentinc.engine.actions import ActionExecutor
from emergentinc.engine.spawn import SpawnService

def test_v8_neighbor_message_only():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        ledger = ResourceLedger(storage)
        validator = RuleValidator(storage)
        spawn = SpawnService(storage, ledger)
        executor = ActionExecutor(storage, validator, ledger, spawn)

        # Create origin, direct neighbor, and distant pixel
        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)
        storage.create_pixel_v8("1_0_0", [1, 0, 0], energy=100.0)
        storage.create_pixel_v8("5_5_5", [5, 5, 5], energy=100.0)

        # 1. Neighbor message: 0_0_0 -> 1_0_0 PASS
        valid_msg = {
            "action": "MESSAGE",
            "message": {
                "to": "1_0_0",
                "content": "Hello direct neighbor"
            }
        }
        ok, reason = validator.validate("0_0_0", valid_msg)
        assert ok is True
        res = executor.execute("0_0_0", valid_msg, 1)
        assert res["success"] is True

        # Check delivered in receiver inbox
        inbox_msgs = storage.inbox_messages("1_0_0")
        assert len(inbox_msgs) == 1
        assert inbox_msgs[0]["content"] == "Hello direct neighbor"

        # 2. Non-neighbor message: 0_0_0 -> 5_5_5 FAIL
        distant_msg = {
            "action": "MESSAGE",
            "message": {
                "to": "5_5_5",
                "content": "Hello distant pixel"
            }
        }
        ok, reason = validator.validate("0_0_0", distant_msg)
        assert ok is False
        assert "not a 6-neighbor" in reason

        with pytest.raises(ValueError) as exc:
            executor.execute("0_0_0", distant_msg, 1)
        assert "not a 6-neighbor" in str(exc.value)
