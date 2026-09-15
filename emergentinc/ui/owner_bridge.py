from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from emergentinc.paths import ProjectPaths, get_paths
from emergentinc.engine.storage import Storage
from emergentinc.cli import owner

class OwnerBridge:
    def __init__(self, base_dir: Optional[Union[str, Path, ProjectPaths]] = None):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)
        self.base = self.paths.workspace_root
        self.s = Storage(self.paths)

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
