import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from .utils import read_json, write_json

class MarketService:
    def __init__(self, storage, ledger=None):
        self.s = storage
        self.ledger = ledger
        self.opp_dir = self.s.live / 'market' / 'opportunities'
        self.arch_dir = self.s.live / 'market' / 'archive'
        self.opp_dir.mkdir(parents=True, exist_ok=True)
        self.arch_dir.mkdir(parents=True, exist_ok=True)

    def _parse_opportunity(self, mid: str, text: str) -> Dict[str, Any]:
        data = {
            "id": mid,
            "need": "",
            "reward": 0.0,
            "success": "",
            "status": "OPEN",
            "participants": []
        }
        need_m = re.search(r'##\s*Need\s*\n(.*?)(?=\n##|\Z)', text, re.DOTALL | re.IGNORECASE)
        if need_m:
            data["need"] = need_m.group(1).strip()

        reward_m = re.search(r'##\s*Reward\s*\n(.*?)(?=\n##|\Z)', text, re.DOTALL | re.IGNORECASE)
        if reward_m:
            num = re.search(r'(\d+(?:\.\d+)?)', reward_m.group(1))
            if num:
                data["reward"] = float(num.group(1))

        success_m = re.search(r'##\s*Success\s*\n(.*?)(?=\n##|\Z)', text, re.DOTALL | re.IGNORECASE)
        if success_m:
            data["success"] = success_m.group(1).strip()

        status_m = re.search(r'##\s*Status\s*\n(.*?)(?=\n##|\Z)', text, re.DOTALL | re.IGNORECASE)
        if status_m:
            data["status"] = status_m.group(1).strip().upper()

        part_m = re.search(r'##\s*Participants\s*\n(.*?)(?=\n##|\Z)', text, re.DOTALL | re.IGNORECASE)
        if part_m:
            parts = [p.strip() for p in part_m.group(1).replace('\n', ',').split(',') if p.strip()]
            data["participants"] = parts

        return data

    def list_open_opportunities(self) -> List[Dict[str, Any]]:
        results = []
        for p in sorted(self.opp_dir.glob('M*.md')):
            try:
                text = p.read_text(encoding='utf-8')
                opp = self._parse_opportunity(p.stem, text)
                if opp["status"] == "OPEN":
                    results.append(opp)
            except Exception:
                pass
        return results

    def get_opportunity(self, mid: str) -> Optional[Dict[str, Any]]:
        p = self.opp_dir / f"{mid}.md"
        if not p.exists():
            p = self.arch_dir / f"{mid}.md"
            if not p.exists():
                return None
        text = p.read_text(encoding='utf-8')
        return self._parse_opportunity(mid, text)

    def save_opportunity(self, opp: Dict[str, Any]) -> None:
        mid = opp["id"]
        parts_str = ", ".join(opp.get("participants", []))
        content = f"""# {mid}

## Need
{opp.get('need', '')}

## Reward
{opp.get('reward', 0.0)} Energy

## Success
{opp.get('success', '')}

## Status
{opp.get('status', 'OPEN')}

## Participants
{parts_str}
"""
        target = self.opp_dir / f"{mid}.md"
        target.write_text(content, encoding='utf-8')

    def claim_opportunity(self, pixel_id: str, mid: str) -> Dict[str, Any]:
        opp = self.get_opportunity(mid)
        if not opp:
            return {"success": False, "error": f"Opportunity {mid} not found"}
        if opp["status"] != "OPEN":
            return {"success": False, "error": f"Opportunity {mid} is {opp['status']}"}
        if pixel_id not in opp["participants"]:
            opp["participants"].append(pixel_id)
            self.save_opportunity(opp)
        return {"success": True, "message": f"Pixel {pixel_id} claimed opportunity {mid}", "opportunity": opp}

    def submit_result(self, pixel_id: str, mid: str, summary: str, artifacts: Optional[List[str]] = None, verified_external: bool = False) -> Dict[str, Any]:
        opp = self.get_opportunity(mid)
        if not opp:
            return {"success": False, "error": f"Opportunity {mid} not found"}
        if opp["status"] != "OPEN":
            return {"success": False, "error": f"Opportunity {mid} is already {opp['status']}"}

        # Check if external verification is required by success condition
        requires_external = any(kw in opp["success"].lower() for kw in ["cny", "usd", "external_customer", "真实客户", "支付"])
        if requires_external and not verified_external:
            return {
                "success": False,
                "error": "EXTERNAL_TRUTH_REQUIRED: Opportunity requires verified external customer payment. AI assertion alone is insufficient."
            }

        # Close and archive
        opp["status"] = "CLOSED"
        opp.setdefault("participants", [])
        if pixel_id not in opp["participants"]:
            opp["participants"].append(pixel_id)
        self.save_opportunity(opp)
        self.s.archive_market_opportunity(mid)

        # Reward submitting pixel
        reward = float(opp.get("reward", 0.0))
        if reward > 0 and self.ledger:
            self.ledger.reward_market_energy(pixel_id, reward)

        return {
            "success": True,
            "status": "CLOSED",
            "reward_awarded": reward,
            "awarded_to": pixel_id,
            "message": f"Opportunity {mid} closed successfully with reward {reward} Energy."
        }
