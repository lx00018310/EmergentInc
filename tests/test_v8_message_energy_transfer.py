import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.validator import RuleValidator
from emergentinc.engine.actions import ActionExecutor
from emergentinc.engine.spawn import SpawnService

def test_v8_message_energy_transfer():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        ledger = ResourceLedger(storage)
        validator = RuleValidator(storage)
        spawn = SpawnService(storage, ledger)
        executor = ActionExecutor(storage, validator, ledger, spawn)

        # 0_0_0 has 50.0, 1_0_0 has 20.0
        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=50.0)
        storage.create_pixel_v8("1_0_0", [1, 0, 0], energy=20.0)

        # 1. Successful energy transfer of 15 Energy
        msg_with_energy = {
            "action": "MESSAGE",
            "message": {
                "to": "1_0_0",
                "content": "Payment for task",
                "energy": 15.0
            }
        }
        ok, reason = validator.validate("0_0_0", msg_with_energy)
        assert ok is True

        res = executor.execute("0_0_0", msg_with_energy, 1)
        assert res["success"] is True

        st_0 = storage.pixel_state("0_0_0")
        st_1 = storage.pixel_state("1_0_0")

        # 0_0_0 paid 15 + action_cost (transfer_cost = 0.5 or 0.2)
        action_cost = validator.action_cost("MESSAGE")
        assert st_0["energy"] == pytest.approx(50.0 - 15.0 - action_cost, 0.01)
        # 1_0_0 received 15
        assert st_1["energy"] == pytest.approx(20.0 + 15.0, 0.01)

        # 2. Overdraft attempt fails validation
        excessive_msg = {
            "action": "MESSAGE",
            "message": {
                "to": "1_0_0",
                "content": "Cannot afford this",
                "energy": 999.0
            }
        }
        ok, reason = validator.validate("0_0_0", excessive_msg)
        assert ok is False
        assert "insufficient energy" in reason
