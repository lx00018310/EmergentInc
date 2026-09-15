import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.local_view import LocalViewBuilder
from emergentinc.engine.context_sandbox import ContextSandbox
from emergentinc.engine.invariants import check_invariants

def test_v8_no_genome_runtime():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        lv = LocalViewBuilder(storage)
        sandbox = ContextSandbox(storage.config())

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)

        # 1. State must not contain genome fields
        st = storage.pixel_state("0_0_0")
        for g_param in ["risk_tolerance", "cost_sensitivity", "spawn_preference", "novelty_preference"]:
            assert g_param not in st

        # 2. Local view perception must not contain genome float parameters
        view = lv.build("0_0_0", 1)
        payload = sandbox.pixel_payload(view)
        payload_str = str(payload)
        for g_param in ["risk_tolerance", "cost_sensitivity", "spawn_preference", "novelty_preference"]:
            assert g_param not in payload_str

        # 3. If genome parameter is injected into state.json, invariant check catches it
        st["risk_tolerance"] = 0.8
        storage.save_pixel_state("0_0_0", st)
        errors = check_invariants(storage)
        assert any("risk_tolerance" in err for err in errors)
