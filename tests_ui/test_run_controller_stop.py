import time
import tempfile
from pathlib import Path
import json
from unittest.mock import patch, MagicMock

from ui.run_controller import RunController
from scripts.storage import Storage

def test_run_controller_stop():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        (base / 'world_state.json').write_text(json.dumps({
            "round": 0,
            "counters": {},
            "llm_accounting": {},
            "accounting": {}
        }), encoding='utf-8')
        (base / 'pixels').mkdir(parents=True)

        storage = Storage(str(base))
        storage.ensure_v5_defaults()

        controller = RunController(base)

        mock_runner = MagicMock()
        def mock_step():
            time.sleep(0.04)
            w = storage.world()
            w['round'] = int(w.get('round', 0)) + 1
            storage.save_world(w)
            return {"round": w['round'], "owner_requests": []}

        mock_runner.run_one.side_effect = mock_step

        with patch('ui.run_controller.RoundRunner', return_value=mock_runner):
            controller.start(rounds=10, command_text="run 10")
            assert controller.status()['running'] is True

            time.sleep(0.06)
            controller.request_stop()

            # Wait for worker thread to finish
            for _ in range(40):
                if not controller.status()['running']:
                    break
                time.sleep(0.05)

            st = controller.status()
            assert st['running'] is False
            assert st['stop_requested'] is True
            assert st['stop_reason'] == 'USER_STOPPED'
            assert st['completed_rounds'] < 10

if __name__ == '__main__':
    test_run_controller_stop()
    print("[PASS] test_run_controller_stop")
