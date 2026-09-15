import os
import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.workspace_jail import WorkspaceJail, JailViolation

def test_v8_workspace_jail():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        jail = WorkspaceJail(storage)

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)

        # 1. Free workspace digital actions: write, read, move, delete
        jail.write_workspace_file("0_0_0", "src/app.py", "print('hello world')")
        assert "hello world" in jail.read_workspace_file("0_0_0", "src/app.py")

        jail.move_workspace_file("0_0_0", "src/app.py", "main.py")
        assert "hello world" in jail.read_workspace_file("0_0_0", "main.py")

        entries = jail.list_workspace("0_0_0")
        names = [e["name"] for e in entries]
        assert "main.py" in names

        jail.delete_workspace_file("0_0_0", "main.py")
        with pytest.raises(FileNotFoundError):
            jail.read_workspace_file("0_0_0", "main.py", must_exist=True)

        # 2. Path traversal attempts are rejected
        with pytest.raises(JailViolation):
            jail.read_workspace_file("0_0_0", "../../world_state.json")

        with pytest.raises(JailViolation):
            jail.write_workspace_file("0_0_0", "../self.md", "overwrite")

        with pytest.raises(JailViolation):
            jail.write_workspace_file("0_0_0", "/etc/passwd", "evil")

        # 3. Command execution within workspace
        cmd_res = jail.run_workspace_command("0_0_0", "python -c \"print('from_workspace')\"")
        assert cmd_res["exit_code"] == 0
        assert "from_workspace" in cmd_res["output"]

        # 4. Command attempting cd .. is blocked
        with pytest.raises(JailViolation):
            jail.run_workspace_command("0_0_0", "cd .. && ls")
