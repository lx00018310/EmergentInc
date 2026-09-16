import json
from pathlib import Path
import tempfile
import time
from unittest.mock import MagicMock, patch

from emergentinc.engine.runner import OwnerActionRequired
from emergentinc.engine.storage import Storage
from emergentinc.ui.run_controller import RunController


from emergentinc.engine.core_store import CoreStore


def test_owner_stop(tmp_path):
    base = Path(tmp_path)
    live = base / "live"
    live.mkdir(parents=True)
    (live / "world_state.json").write_text(
        json.dumps({
            "round": 0,
            "accounting": {},
            "llm_accounting": {},
            "counters": {},
        }),
        encoding="utf-8",
    )
    (live / "pixels").mkdir(parents=True)

    storage = Storage(base)
    storage.ensure_v5_defaults()

    controller = RunController(base)

    mock_scheduler = MagicMock()

    def mock_step(**kwargs):
        w = storage.world()
        w["round"] = int(w.get("round", 0)) + 1
        storage.save_world(w)
        raise OwnerActionRequired(["ER0001"])

    mock_scheduler.run_round.side_effect = mock_step

    with patch.object(controller, "_get_scheduler", return_value=mock_scheduler):
        controller.start(rounds=5, command_text="run 5")

        # Wait for worker thread to process
        for _ in range(40):
            if not controller.status()["running"]:
                break
            time.sleep(0.05)

        st = controller.status()
        assert st["running"] is False
        assert st["stop_reason"] == "OWNER_ACTION_REQUIRED"
        assert "ER0001" in st["pending_owner_requests"]

        # Check run recorded in core store
        store = CoreStore(base / "ledger" / "v9_core.sqlite3")
        run_rec = store.get_run(st["run_id"])
        assert run_rec is not None
        assert run_rec["status"] == "STOPPED"
        assert run_rec["stop_reason"] == "OWNER_ACTION_REQUIRED"


if __name__ == "__main__":
    test_owner_stop()
    print("[PASS] test_owner_stop")
