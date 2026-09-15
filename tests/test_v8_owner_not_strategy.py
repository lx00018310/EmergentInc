import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.validator import RuleValidator
from emergentinc.engine.actions import ActionExecutor
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.spawn import SpawnService

def test_v8_owner_not_strategy():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        ledger = ResourceLedger(storage)
        validator = RuleValidator(storage)
        spawn = SpawnService(storage, ledger)
        executor = ActionExecutor(storage, validator, ledger, spawn)

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)

        # 1. Physical resource request: PASS
        valid_owner_req = {
            "action": "ASK_OWNER",
            "owner_request": {
                "needed_resource": "PAYMENT_QR_CODE",
                "question": "Please place payment.png in workspace for receiving 1 CNY."
            }
        }
        ok, reason = validator.validate("0_0_0", valid_owner_req)
        assert ok is True
        res = executor.execute("0_0_0", valid_owner_req, 1)
        assert res["success"] is True
        assert res["owner_action_required"] is True

        # 2. Asking owner for business decision / marketing strategy: FAIL
        invalid_strategy_req = {
            "action": "ASK_OWNER",
            "owner_request": {
                "needed_resource": "STRATEGY",
                "question": "老板帮我找客户，或者告诉我该卖什么商业策略"
            }
        }
        ok, reason = validator.validate("0_0_0", invalid_strategy_req)
        assert ok is False
        assert "owner cannot be asked for business strategy" in reason

        # 3. Asking owner to buy product: FAIL
        invalid_buyer_req = {
            "action": "ASK_OWNER",
            "owner_request": {
                "needed_resource": "BUYER",
                "question": "老板购买我的网页服务并付款"
            }
        }
        ok, reason = validator.validate("0_0_0", invalid_buyer_req)
        assert ok is False
        assert "owner cannot be asked for business strategy" in reason
