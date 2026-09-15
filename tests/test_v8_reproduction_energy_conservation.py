import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.validator import RuleValidator
from emergentinc.engine.actions import ActionExecutor
from emergentinc.engine.spawn import SpawnService

def test_v8_reproduction_energy_conservation():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        ledger = ResourceLedger(storage)
        validator = RuleValidator(storage)
        spawn = SpawnService(storage, ledger)
        executor = ActionExecutor(storage, validator, ledger, spawn)

        # Parent starts with 100 Energy
        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)

        birth_cost = spawn.birth_cost  # default 10.0
        energy_to_child = 40.0

        # Parent reproduces to [1, 0, 0]
        rep_decision = {
            "action": "REPRODUCE",
            "reproduce": {
                "target": [1, 0, 0],
                "energy_to_child": energy_to_child,
                "inheritance": "Inheritance guidance for child."
            }
        }

        ok, reason = validator.validate("0_0_0", rep_decision)
        assert ok is True

        res = executor.execute("0_0_0", rep_decision, 1)
        assert res["success"] is True

        parent_st = storage.pixel_state("0_0_0")
        child_st = storage.pixel_state("1_0_0")

        # Parent should have 100 - 40 - 10 = 50 Energy
        assert parent_st["energy"] == pytest.approx(100.0 - energy_to_child - birth_cost, 0.01)
        # Child should have 40 Energy
        assert child_st["energy"] == pytest.approx(energy_to_child, 0.01)

        # Total energy: parent + child = 90. Exactly decreased by birth_cost (10.0)
        total_energy = parent_st["energy"] + child_st["energy"]
        assert total_energy == pytest.approx(100.0 - birth_cost, 0.01)
