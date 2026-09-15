from pathlib import Path
from typing import Dict, Any, List, Optional
from scripts.storage import Storage
from scripts import owner

class OwnerBridge:
    def __init__(self, base_dir: str | Path = '.'):
        self.base = Path(base_dir)
        self.s = Storage(str(self.base))

    def list_requests(self, pending_only: bool = True) -> List[Dict[str, Any]]:
        self.s.ensure_v5_defaults()
        out = []
        for rid in self.s.external_request_ids():
            try:
                r = self.s.external_request(rid)
                if pending_only and r.get('status') != 'PENDING_OWNER':
                    continue
                out.append(r)
            except Exception:
                pass
        return out

    def approve_request(
        self,
        request_id: str,
        capability_id: Optional[str] = None,
        profile_file: Optional[str] = None,
        reason: str = 'approved'
    ) -> Dict[str, Any]:
        self.s.ensure_v5_defaults()
        r = self.s.external_request(request_id)
        if r.get('status') != 'PENDING_OWNER':
            raise RuntimeError(f"Request {request_id} is not in PENDING_OWNER state (status={r.get('status')})")

        if not capability_id:
            capability_id = self.s._next_id('capabilities', 'CAP')

        if not profile_file:
            raise ValueError("profile_file path is required for capability approval.")

        p_path = Path(profile_file)
        if not p_path.exists():
            raise FileNotFoundError(f"Profile file not found: {profile_file}")

        owner.approve(self.s, request_id, capability_id, str(p_path), reason)

        return {
            "status": "APPROVED",
            "request_id": request_id,
            "capability_id": capability_id,
            "reason": reason
        }

    def reject_request(self, request_id: str, reason: str) -> Dict[str, Any]:
        self.s.ensure_v5_defaults()
        r = self.s.external_request(request_id)
        if r.get('status') != 'PENDING_OWNER':
            raise RuntimeError(f"Request {request_id} is not in PENDING_OWNER state (status={r.get('status')})")

        clean_reason = reason.strip() or "Rejected by Owner"
        owner.reject(self.s, request_id, clean_reason)

        return {
            "status": "REJECTED",
            "request_id": request_id,
            "reason": clean_reason
        }
