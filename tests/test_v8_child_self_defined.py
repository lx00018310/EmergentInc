import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.spawn import SpawnService
from emergentinc.engine.workspace_jail import WorkspaceJail

def test_v8_child_self_defined():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        ledger = ResourceLedger(storage)
        spawn = SpawnService(storage, ledger)
        jail = WorkspaceJail(storage)

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)

        # Parent gives inheritance message
        parent_advice = "I hope you explore the market."
        spawn.spawn_v8(
            parent_id="0_0_0",
            target_pos=(1, 0, 0),
            energy_to_child=40.0,
            inheritance_text=parent_advice,
            round_num=1
        )

        child_id = "1_0_0"
        child_st = storage.pixel_state(child_id)

        # 1. Child does NOT have pre-defined role in state.json
        assert "role" not in child_st
        assert "profession" not in child_st
        assert "department" not in child_st

        # 2. Child has default open self.md
        self_content = storage.pixel_self(child_id)
        assert "I will decide who I become" in self_content

        # 3. Child received inheritance
        inh_content = storage.pixel_inheritance(child_id)
        assert parent_advice in inh_content

        # 4. Child freely defines its own self and public identity
        jail.write_self_file(child_id, "self.md", "# My Choice\nI choose to be an engineer.")
        jail.write_self_file(child_id, "public.md", "# Public\nOffering backend tools.")
        assert "I choose to be an engineer" in storage.pixel_self(child_id)
        assert "Offering backend tools" in storage.pixel_public(child_id)

        # 5. Child can even delete or modify inheritance.md
        jail.delete_self_file(child_id, "inheritance.md")
        assert storage.pixel_inheritance(child_id) == ""
