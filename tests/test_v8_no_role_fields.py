import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.invariants import check_invariants

def test_v8_no_role_fields():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()

        # Valid V8 pixel
        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)
        errors = check_invariants(storage)
        assert len(errors) == 0

        # Inject forbidden role field into state.json
        st = storage.pixel_state("0_0_0")
        st["role"] = "marketing"
        storage.save_pixel_state("0_0_0", st)

        errors_with_role = check_invariants(storage)
        assert any("role" in err for err in errors_with_role)

        # Inject forbidden department field
        del st["role"]
        st["department"] = "engineering"
        storage.save_pixel_state("0_0_0", st)

        errors_with_dept = check_invariants(storage)
        assert any("department" in err for err in errors_with_dept)
