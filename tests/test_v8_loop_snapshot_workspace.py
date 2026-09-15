import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.workspace_jail import WorkspaceJail
from emergentinc.engine.market import MarketService
from emergentinc.ui.snapshot import create_snapshot, restore_snapshot

def test_v8_loop_snapshot_workspace():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        live = base / "live"
        live.mkdir(parents=True)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        jail = WorkspaceJail(storage)
        market = MarketService(storage)

        # Create V8 pixel with files in workspace
        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)
        jail.write_self_file("0_0_0", "self.md", "# Custom Self\nMy Identity")
        jail.write_workspace_file("0_0_0", "app/code.py", "val = 42")

        # Create market opportunity
        market.save_opportunity({
            "id": "M0001",
            "need": "Make 1 CNY",
            "reward": 100.0,
            "success": "CNY >= 1",
            "status": "OPEN",
            "participants": ["0_0_0"]
        })

        # 1. Take Snapshot
        snapshot_dir = base / "loops" / "checkpoint_001"
        create_snapshot(live, snapshot_dir)

        # Verify snapshot contents
        assert (snapshot_dir / "world_state.json").exists()
        assert (snapshot_dir / "pixels" / "0_0_0" / "self.md").exists()
        assert (snapshot_dir / "pixels" / "0_0_0" / "workspace" / "app" / "code.py").exists()
        assert (snapshot_dir / "market" / "opportunities" / "M0001.md").exists()

        # Verify excluded sensitive items
        assert not (snapshot_dir / "owner_private").exists()
        assert not (snapshot_dir / ".env").exists()

        # 2. Modify live workspace (simulate accidental deletion/corruption)
        jail.delete_workspace_file("0_0_0", "app/code.py")
        jail.write_self_file("0_0_0", "self.md", "Corrupted")

        # 3. Restore snapshot
        restore_snapshot(snapshot_dir, live)

        # Verify restored contents
        assert "My Identity" in jail.read_self_file("0_0_0", "self.md")
        assert "val = 42" in jail.read_workspace_file("0_0_0", "app/code.py")
