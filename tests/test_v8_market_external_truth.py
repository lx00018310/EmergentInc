import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.ledger import ResourceLedger
from emergentinc.engine.market import MarketService

def test_v8_market_external_truth():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        ledger = ResourceLedger(storage)
        market = MarketService(storage, ledger)

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=50.0)

        # Create market opportunity requiring external payment
        market.save_opportunity({
            "id": "M0005",
            "need": "Real customer payment >= 1 CNY",
            "reward": 100.0,
            "success": "payer_role = EXTERNAL_CUSTOMER, CNY >= 1",
            "status": "OPEN",
            "participants": ["0_0_0"]
        })

        # 1. AI Pixel falsely asserts "A customer paid me 1 CNY!" without external verification
        false_claim = market.submit_result(
            pixel_id="0_0_0",
            mid="M0005",
            summary="I found a customer online who paid 1 CNY into my pocket.",
            verified_external=False
        )
        assert false_claim["success"] is False
        assert "EXTERNAL_TRUTH_REQUIRED" in false_claim["error"]

        # Ensure opportunity is NOT closed and reward is NOT paid
        opp = market.get_opportunity("M0005")
        assert opp["status"] == "OPEN"
        st = storage.pixel_state("0_0_0")
        assert st["energy"] == 50.0

        # 2. When real external event verification is provided (e.g. gateway verified payment)
        verified_claim = market.submit_result(
            pixel_id="0_0_0",
            mid="M0005",
            summary="External payment gateway received transaction TX_001.",
            verified_external=True
        )
        assert verified_claim["success"] is True
        assert verified_claim["status"] == "CLOSED"

        # Energy reward is injected
        st_after = storage.pixel_state("0_0_0")
        assert st_after["energy"] == pytest.approx(50.0 + 100.0, 0.01)
