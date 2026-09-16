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

    def _inject_v9_feedback(self, pixel_id: str, request_id: str, status: str, reason: str):
        try:
            from emergentinc.engine.world import World
            from emergentinc.engine.router import MessageRouter
            q_file = self.paths.runtime_root / "v9_message_queue.json"
            w = World(self.paths.live_root / "pixels")
            router = MessageRouter(w, state_file=q_file)
            fb = f"[ENGINE_FEEDBACK]\n\nOwner request '{request_id}' {status}.\nReason: {reason}"
            msg = router.create_message(
                sender="ENGINE",
                recipient=pixel_id,
                content=fb,
                hop=1,
                round_num=int(self.s.world().get("round", 1)),
                source_type="engine_feedback",
                is_feedback=True,
            )
            router.enqueue_front([msg])
        except Exception:
            pass

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

        # 判断是否为 V9 通用 request (无需 capability profile)
        requester = r.get('pixel_id') or r.get('requester')
        if not profile_file and requester:
            r.update({
                'status': 'APPROVED',
                'resolved_round': self.s.world().get('round', 0),
                'owner_reason': reason,
            })
            self.s.save_external_request(r)
            self._inject_v9_feedback(requester, request_id, 'APPROVED', reason)
            return {
                "status": "APPROVED",
                "request_id": request_id,
                "reason": reason
            }

        if not capability_id:
            capability_id = self.s._next_id('capabilities', 'CAP')

        if not profile_file:
            raise ValueError("profile_file path is required for capability approval.")

        p_path = Path(profile_file)
        if not p_path.exists():
            raise FileNotFoundError(f"Profile file not found: {profile_file}")

        owner.approve(self.s, request_id, capability_id, str(p_path), reason)
        if requester:
            self._inject_v9_feedback(requester, request_id, 'APPROVED', reason)

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
        requester = r.get('pixel_id') or r.get('requester')

        r.update({
            'status': 'REJECTED',
            'resolved_round': self.s.world().get('round', 0),
            'owner_reason': clean_reason,
        })
        self.s.save_external_request(r)

        if requester:
            self._inject_v9_feedback(requester, request_id, 'REJECTED', clean_reason)

        return {
            "status": "REJECTED",
            "request_id": request_id,
            "reason": clean_reason
        }
