import tempfile
from pathlib import Path
import json

from ui.loop_store import LoopStore

def test_loop_branching_and_checkout():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        (base / 'world_state.json').write_text(json.dumps({"round": 1}), encoding='utf-8')
        (base / 'pixels').mkdir(parents=True)

        store = LoopStore(base)
        
        # Start & Finish Loop 1
        l1 = store.start_loop("跑1轮", start_round=1)
        assert l1['id'] == 'L000001'
        store.finish_loop('L000001', end_round=2, status='COMPLETED')

        # Start & Finish Loop 2
        l2 = store.start_loop("跑2轮", start_round=2)
        assert l2['id'] == 'L000002'
        assert l2['parent'] == 'L000001'
        store.finish_loop('L000002', end_round=4, status='COMPLETED')

        # Branch from L1
        branch_info = store.branch_from('L000001', 'experiment-A')
        assert branch_info['branch'] == 'experiment-A'
        assert branch_info['head'] == 'L000001'

        manifest = store.get_manifest()
        assert manifest['current_branch'] == 'experiment-A'
        assert manifest['current_loop'] == 'L000001'

        # Next loop under experiment-A should have parent L1
        l3 = store.start_loop("跑3轮", start_round=2)
        assert l3['id'] == 'L000003'
        assert l3['parent'] == 'L000001'
        assert l3['branch'] == 'experiment-A'
        store.finish_loop('L000003', end_round=5, status='COMPLETED')

if __name__ == '__main__':
    test_loop_branching_and_checkout()
    print("[PASS] test_loop_branching_and_checkout")
