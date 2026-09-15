import json
import tempfile
from pathlib import Path

from emergentinc.ui.snapshot import create_snapshot, restore_snapshot


def test_snapshot_and_restore():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        live = base / "live"
        live.mkdir(parents=True)

        # Setup mock world inside live
        world_state = {"round": 10, "experiment_id": "test_exp"}
        (live / "world_state.json").write_text(json.dumps(world_state), encoding="utf-8")

        pixels_dir = live / "pixels" / "0_0_0"
        pixels_dir.mkdir(parents=True)
        (pixels_dir / "state.json").write_text(
            json.dumps({"active": 1, "resource": 150}), encoding="utf-8"
        )

        # Setup private directory (which should NOT be backed up)
        private_dir = base / "private"
        private_dir.mkdir(parents=True)
        (private_dir / "secret.key").write_text("SUPER_SECRET_KEY", encoding="utf-8")

        snapshot_dir = base / "test_checkpoint"
        create_snapshot(live, snapshot_dir)

        # Verify snapshot files
        assert (snapshot_dir / "world_state.json").exists()
        assert (snapshot_dir / "pixels" / "0_0_0" / "state.json").exists()
        assert not (snapshot_dir / "private").exists()
        assert not (snapshot_dir / "owner_private").exists()

        # Mutate current world
        (live / "world_state.json").write_text(json.dumps({"round": 99}), encoding="utf-8")
        (pixels_dir / "state.json").write_text(
            json.dumps({"active": 0, "resource": 0}), encoding="utf-8"
        )

        # Restore snapshot
        restore_snapshot(snapshot_dir, live)

        restored_world = json.loads((live / "world_state.json").read_text(encoding="utf-8"))
        restored_pixel = json.loads((pixels_dir / "state.json").read_text(encoding="utf-8"))

        assert restored_world["round"] == 10
        assert restored_pixel["active"] == 1
        assert restored_pixel["resource"] == 150
        # Private secret still intact in base
        assert (private_dir / "secret.key").read_text(encoding="utf-8") == "SUPER_SECRET_KEY"


if __name__ == "__main__":
    test_snapshot_and_restore()
    print("[PASS] test_snapshot_and_restore")
