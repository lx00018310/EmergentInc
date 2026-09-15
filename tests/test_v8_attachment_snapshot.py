import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.validator import RuleValidator
from emergentinc.engine.actions import ActionExecutor
from emergentinc.engine.spawn import SpawnService
from emergentinc.engine.workspace_jail import WorkspaceJail

def test_v8_attachment_snapshot():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        jail = WorkspaceJail(storage)
        ledger = ResourceLedger(storage)
        validator = RuleValidator(storage)
        spawn = SpawnService(storage, ledger)
        executor = ActionExecutor(storage, validator, ledger, spawn)

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)
        storage.create_pixel_v8("1_0_0", [1, 0, 0], energy=100.0)

        # 1. Sender creates file in workspace
        jail.write_workspace_file("0_0_0", "report.md", "# Original Report\nVersion 1")

        # 2. Sender sends message with attachment
        msg = {
            "action": "MESSAGE",
            "message": {
                "to": "1_0_0",
                "content": "Sending report snapshot",
                "attachments": ["report.md"]
            }
        }
        res = executor.execute("0_0_0", msg, 1)
        assert res["success"] is True

        # Check receiver inbox attachments
        rec_attach_dir = storage.live / "pixels/1_0_0/inbox/attachments"
        snapshots = list(rec_attach_dir.glob("*_report.md"))
        assert len(snapshots) == 1
        snapshot_file = snapshots[0]
        assert "Version 1" in snapshot_file.read_text(encoding="utf-8")

        # 3. Sender modifies original file
        jail.write_workspace_file("0_0_0", "report.md", "# Modified Report\nVersion 2 (Tampered)")

        # 4. Verify receiver snapshot remains immutable (Version 1)
        assert "Version 1" in snapshot_file.read_text(encoding="utf-8")
        assert "Version 2" not in snapshot_file.read_text(encoding="utf-8")
