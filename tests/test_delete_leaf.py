import json
import tempfile
from pathlib import Path
import pytest

from emergentinc.ui.loop_store import LoopStore


def test_delete_leaf_loop():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        live = base / "live"
        live.mkdir(parents=True)
        (live / "world_state.json").write_text(json.dumps({"round": 1}), encoding="utf-8")
        (live / "pixels").mkdir(parents=True)

        store = LoopStore(base)

        # Create L1 -> L2 -> L3
        store.start_loop("run 1", 1)
        store.finish_loop("L000001", 2, "COMPLETED")

        store.start_loop("run 2", 2)
        store.finish_loop("L000002", 3, "COMPLETED")

        store.start_loop("run 3", 3)
        store.finish_loop("L000003", 4, "COMPLETED")

        # Trying to delete L1 or L2 (non-leaf) must fail
        try:
            store.delete_loop("L000001")
            assert False, "Should have raised ValueError on deleting non-leaf"
        except ValueError as e:
            assert "Cannot delete non-leaf loop" in str(e)

        try:
            store.delete_loop("L000002")
            assert False, "Should have raised ValueError on deleting non-leaf"
        except ValueError as e:
            assert "Cannot delete non-leaf loop" in str(e)

        # Deleting L3 (leaf) must succeed
        store.delete_loop("L000003")

        remaining = [l["id"] for l in store.list_loops()]
        assert "L000003" not in remaining
        assert "L000002" in remaining
        assert "L000001" in remaining

        # Branch head should now point to L000002
        main_branch = store.get_branch("main")
        assert main_branch["head"] == "L000002"


if __name__ == "__main__":
    test_delete_leaf_loop()
    print("[PASS] test_delete_leaf_loop")
