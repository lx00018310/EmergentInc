import json
import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.workspace_jail import WorkspaceJail, JailViolation

def test_v8_pixel_ownership():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        jail = WorkspaceJail(storage)

        # Create two pixels
        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)
        storage.create_pixel_v8("1_0_0", [1, 0, 0], energy=100.0)

        # 1. Pixel can read and write its own self.md, public.md, memory.md
        jail.write_self_file("0_0_0", "self.md", "# My New Self\nAutonomous agent.")
        assert "Autonomous agent" in jail.read_self_file("0_0_0", "self.md")

        jail.write_self_file("0_0_0", "public.md", "# Public\nI can do data analysis.")
        assert "data analysis" in jail.read_self_file("0_0_0", "public.md")

        # 2. Pixel CANNOT write state.json via self_file API (Engine managed)
        with pytest.raises(JailViolation):
            jail.write_self_file("0_0_0", "state.json", "{}")

        # 3. Pixel CANNOT write activity/ via self_file API (Engine managed)
        with pytest.raises(JailViolation):
            jail.write_self_file("0_0_0", "activity/audit.log", "fake")

        # 4. Pixel CANNOT read other pixel's self.md or memory.md through its own jail
        # Passing another pixel's path directly is a violation
        with pytest.raises(JailViolation):
            jail.read_self_file("0_0_0", "../1_0_0/self.md")

        with pytest.raises(JailViolation):
            jail.read_workspace_file("0_0_0", "../1_0_0/self.md")
