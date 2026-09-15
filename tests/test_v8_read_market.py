import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.validator import RuleValidator
from emergentinc.engine.actions import ActionExecutor
from emergentinc.engine.spawn import SpawnService
from emergentinc.engine.market import MarketService

def test_v8_read_market():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        ledger = ResourceLedger(storage)
        validator = RuleValidator(storage)
        spawn = SpawnService(storage, ledger)
        market = MarketService(storage, ledger)
        executor = ActionExecutor(storage, validator, ledger, spawn, market=market)

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)
        storage.create_pixel_v8("1_0_0", [1, 0, 0], energy=100.0)

        # 1. Add Market opportunity
        market.save_opportunity({
            "id": "M0005",
            "need": "Make 1 CNY business loop",
            "reward": 100.0,
            "success": "payer_role = EXTERNAL_CUSTOMER, CNY >= 1",
            "status": "OPEN",
            "participants": []
        })

        # 2. Pixel 0_0_0 executes WORK: READ_MARKET
        work_decision = {
            "action": "WORK",
            "work": {
                "intent": "Read open market opportunities",
                "operations": [
                    {"tool": "READ_MARKET", "args": {}}
                ]
            }
        }
        res = executor.execute("0_0_0", work_decision, 1)
        assert res["success"] is True
        ops_res = res["operations_result"]
        assert len(ops_res) == 1
        opps = ops_res[0]["opportunities"]
        assert len(opps) == 1
        assert opps[0]["id"] == "M0005"

        # 3. Pixel 0_0_0 claims opportunity
        claim_decision = {
            "action": "WORK",
            "work": {
                "intent": "Claim M0005",
                "operations": [
                    {"tool": "CLAIM_MARKET_OPPORTUNITY", "args": {"opportunity_id": "M0005"}}
                ]
            }
        }
        res_claim = executor.execute("0_0_0", claim_decision, 2)
        assert res_claim["success"] is True

        opp_after = market.get_opportunity("M0005")
        assert "0_0_0" in opp_after["participants"]

        # 4. Pixel 1_0_0 can also claim (multi-participant allowed)
        claim_decision_1 = {
            "action": "WORK",
            "work": {
                "intent": "Also join M0005",
                "operations": [
                    {"tool": "CLAIM_MARKET_OPPORTUNITY", "args": {"opportunity_id": "M0005"}}
                ]
            }
        }
        executor.execute("1_0_0", claim_decision_1, 3)
        opp_after_2 = market.get_opportunity("M0005")
        assert "0_0_0" in opp_after_2["participants"]
        assert "1_0_0" in opp_after_2["participants"]
