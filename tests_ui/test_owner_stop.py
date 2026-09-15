import time
import tempfile
from pathlib import Path
import json
from unittest.mock import patch, MagicMock

from ui.run_controller import RunController
from scripts.storage import Storage
from scripts.runner import OwnerActionRequired

def test_owner_stop():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        (base / 'world_state.json').write_text(json.dumps({
            "round": 0,
            "accounting": {},
            "llm_accounting": {},
            "counters": {}
        }), encoding='utf-8')
        (base / 'pixels').mkdir(parents=True)

        storage = Storage(str(base))
        storage.ensure_v5_defaults()

        controller = RunController(base)

        mock_runner = MagicMock()
        def mock_step():
            w = storage.world()
            w['round'] = int(w.get('round', 0)) + 1
            storage.save_world(w)
            raise OwnerActionRequired(["ER0001"])

        mock_runner.run_one.side_effect = mock_step

        with patch('ui.run_controller.RoundRunner', return_value=mock_runner):
            controller.start(rounds=5, command_text="run 5")

            # Wait for worker thread to process
            for _ in range(40):
                if not controller.status()['running']:
                    break
                time.sleep(0.05)

            st = controller.status()
            assert st['running'] is False
            assert st['stop_reason'] == 'OWNER_ACTION_REQUIRED'
            assert 'ER0001' in st['pending_owner_requests']

            # Check loop meta recorded in loop_store
            loop = controller.loop_store.get_loop(st['current_loop'])
            assert loop is not None
            assert loop['status'] == 'STOPPED'
            assert loop['stop_reason'] == 'OWNER_ACTION_REQUIRED'

if __name__ == '__main__':
    test_owner_stop()
    print("[PASS] test_owner_stop")
