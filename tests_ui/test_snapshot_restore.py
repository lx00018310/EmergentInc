import tempfile
import shutil
from pathlib import Path
import json

from ui.snapshot import create_snapshot, restore_snapshot

def test_snapshot_and_restore():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        
        # Setup mock world
        world_state = {"round": 10, "experiment_id": "test_exp"}
        (base / 'world_state.json').write_text(json.dumps(world_state), encoding='utf-8')
        
        pixels_dir = base / 'pixels' / '0_0_0'
        pixels_dir.mkdir(parents=True)
        (pixels_dir / 'state.json').write_text(json.dumps({"active": 1, "resource": 150}), encoding='utf-8')
        
        # Setup owner private (which should NOT be backed up)
        private_dir = base / 'owner_private'
        private_dir.mkdir(parents=True)
        (private_dir / 'secret.key').write_text("SUPER_SECRET_KEY", encoding='utf-8')
        
        snapshot_dir = base / 'test_checkpoint'
        create_snapshot(base, snapshot_dir)
        
        # Verify snapshot files
        assert (snapshot_dir / 'world_state.json').exists()
        assert (snapshot_dir / 'pixels' / '0_0_0' / 'state.json').exists()
        assert not (snapshot_dir / 'owner_private').exists()
        
        # Mutate current world
        (base / 'world_state.json').write_text(json.dumps({"round": 99}), encoding='utf-8')
        (pixels_dir / 'state.json').write_text(json.dumps({"active": 0, "resource": 0}), encoding='utf-8')
        
        # Restore snapshot
        restore_snapshot(snapshot_dir, base)
        
        restored_world = json.loads((base / 'world_state.json').read_text(encoding='utf-8'))
        restored_pixel = json.loads((pixels_dir / 'state.json').read_text(encoding='utf-8'))
        
        assert restored_world["round"] == 10
        assert restored_pixel["active"] == 1
        assert restored_pixel["resource"] == 150
        # Private secret still intact in base
        assert (base / 'owner_private' / 'secret.key').read_text(encoding='utf-8') == "SUPER_SECRET_KEY"

if __name__ == '__main__':
    test_snapshot_and_restore()
    print("[PASS] test_snapshot_and_restore")
