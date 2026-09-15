import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.local_view import LocalViewBuilder
from emergentinc.engine.context_sandbox import ContextSandbox, ContextViolation
from emergentinc.engine.workspace_jail import WorkspaceJail

def test_v8_api_sandbox_no_global_view():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        lv = LocalViewBuilder(storage)
        sandbox = ContextSandbox(storage.config())
        jail = WorkspaceJail(storage)

        # Create origin and neighbor
        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)
        storage.create_pixel_v8("1_0_0", [1, 0, 0], energy=100.0)

        # Neighbor writes secret thoughts in self.md and confidential files in workspace
        jail.write_self_file("1_0_0", "self.md", "# Neighbor Secret Plan\nSteal energy.")
        jail.write_self_file("1_0_0", "memory.md", "# Secret Memory\nHidden password.")
        jail.write_workspace_file("1_0_0", "secret_code.py", "SECRET_KEY = 12345")
        jail.write_self_file("1_0_0", "public.md", "# Public\nI am friendly.")

        # 0_0_0 builds local perception
        view = lv.build("0_0_0", 1)
        payload = sandbox.pixel_payload(view)

        # 1. Neighbor's public.md IS present
        neighbors = payload["neighbors"]
        n_100 = next(n for n in neighbors if n["id"] == "1_0_0")
        assert "friendly" in n_100["public_md"]

        # 2. Neighbor's private content MUST NOT leak into 0_0_0's perception
        payload_str = str(payload)
        assert "Steal energy" not in payload_str
        assert "Hidden password" not in payload_str
        assert "SECRET_KEY" not in payload_str
        assert "secret_code.py" not in payload_str

        # 3. Forbidden key check in ContextSandbox
        with pytest.raises(ContextViolation):
            sandbox.pixel_payload({"round": 1, "world_state": {"round": 1}})

        with pytest.raises(ContextViolation):
            sandbox.pixel_payload({"round": 1, "owner_private": "key"})
