import json
from pathlib import Path
import tempfile

from emergentinc.engine.storage import Storage
from emergentinc.ui.world_reader import WorldReader


def test_world_api_no_secret():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        live = base / "live"
        live.mkdir(parents=True)
        (live / "world_state.json").write_text(
            json.dumps({
                "round": 5,
                "accounting": {},
                "llm_accounting": {},
                "counters": {},
            }),
            encoding="utf-8",
        )
        (live / "pixels").mkdir(parents=True)

        storage = Storage(base)
        storage.ensure_v5_defaults()

        # Add secret file inside private
        secret_content = "TOP_SECRET_VPS_PRIVATE_KEY_9999"
        cap_file = storage.private / "capabilities" / "CAP0001.json"
        cap_file.write_text(
            json.dumps({
                "host": "1.2.3.4",
                "private_key": secret_content,
            }),
            encoding="utf-8",
        )

        # Add public capability metadata
        storage.save_capability({
            "id": "CAP0001",
            "status": "ACTIVE",
            "type": "public_web_hosting",
            "granted_to": "0_0_0",
            "public_metadata": {"driver": "vps", "port": 80},
        })

        # Add pixel with this capability
        storage.create_pixel(
            "0_0_0",
            {
                "active": 1,
                "position": [0, 0, 0],
                "resource": 100.0,
                "capability_ids": ["CAP0001"],
            },
            {},
            {},
        )

        reader = WorldReader(base)
        dto = reader.get_world_dto()
        dto_json = json.dumps(dto)

        # Assert secret is strictly absent
        assert secret_content not in dto_json
        assert "CAP0001" in dto_json


if __name__ == "__main__":
    test_world_api_no_secret()
    print("[PASS] test_world_api_no_secret")
