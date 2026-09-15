import pytest
import tempfile
from pathlib import Path
from emergentinc.engine.storage import Storage
from emergentinc.engine.market import MarketService
from emergentinc.engine.local_view import LocalViewBuilder
from emergentinc.engine.context_sandbox import ContextSandbox

def test_v8_market_not_auto_visible():
    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        storage = Storage(base)
        storage.ensure_v5_defaults()
        market = MarketService(storage)
        lv = LocalViewBuilder(storage)
        sandbox = ContextSandbox(storage.config())

        storage.create_pixel_v8("0_0_0", [0, 0, 0], energy=100.0)

        # 1. Create a market opportunity
        market.save_opportunity({
            "id": "M0001",
            "need": "Find a real user to pay 1 CNY",
            "reward": 100.0,
            "success": "payer_role = EXTERNAL_CUSTOMER, CNY >= 1",
            "status": "OPEN",
            "participants": []
        })

        # 2. Build local view for 0_0_0
        view = lv.build("0_0_0", round_num=1)

        # 3. Verify market is NOT present in local view
        assert "market" not in view or len(view.get("market", [])) == 0
        assert "M0001" not in str(view)

        # 4. Verify API sandbox payload does NOT leak market
        payload = sandbox.pixel_payload(view)
        assert "M0001" not in str(payload)
        assert "market" not in payload
