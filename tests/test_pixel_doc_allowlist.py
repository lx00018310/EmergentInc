import json
from pathlib import Path
import tempfile
import pytest

from emergentinc.engine.storage import Storage
from emergentinc.ui.world_reader import WorldReader


def test_pixel_doc_allowlist():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        live = base / "live"
        live.mkdir(parents=True)
        (live / "world_state.json").write_text(
            json.dumps({
                "round": 0,
                "accounting": {},
                "llm_accounting": {},
                "counters": {},
            }),
            encoding="utf-8",
        )
        (live / "pixels").mkdir(parents=True)

        storage = Storage(base)
        storage.ensure_v5_defaults()

        storage.create_pixel("0_0_0", {"active": 1, "resource": 100.0}, {}, {})
        (live / "pixels" / "0_0_0" / "history.md").write_text(
            "# History\nRound 1: Born", encoding="utf-8"
        )

        reader = WorldReader(base)

        # 1. Allowed docs
        content = reader.get_pixel_document("0_0_0", "history")
        assert "Round 1: Born" in content

        # 2. Disallowed doc names
        with pytest.raises(ValueError) as exc:
            reader.get_pixel_document("0_0_0", "unauthorized_doc")
        assert "not in allowed document list" in str(exc.value)

        # 3. Path traversal attack in doc_name
        with pytest.raises(ValueError):
            reader.get_pixel_document("0_0_0", "../../private/secret")

        # 4. Path traversal attack in pixel_id
        with pytest.raises(ValueError):
            reader.get_pixel_document("../..", "state")


if __name__ == "__main__":
    test_pixel_doc_allowlist()
    print("[PASS] test_pixel_doc_allowlist")
