import copy
import json
from .utils import sha256_text

class ContextViolation(RuntimeError):
    pass

class ContextSandbox:
    def __init__(self, config):
        self.cfg = config.get('sandbox', {})
        self.max_chars = int(self.cfg.get('max_string_chars', 5000))
        self.forbidden = [x.lower() for x in self.cfg.get('forbidden_key_fragments', [
            'world_state', 'all_pixels', 'global_resource', 'owner_private',
            'api_key', 'secret', 'password', 'private_key', 'market_opportunities'
        ])]
        self.external_label = self.cfg.get('external_content_label', 'UNTRUSTED_EXTERNAL_DATA')

    def _truncate(self, v):
        if isinstance(v, str):
            return v if len(v) <= self.max_chars else v[:self.max_chars] + '\n[TRUNCATED]'
        if isinstance(v, list):
            return [self._truncate(x) for x in v]
        if isinstance(v, dict):
            return {k: self._truncate(x) for k, x in v.items()}
        return v

    def _assert_no_forbidden_keys(self, obj, path='root'):
        if isinstance(obj, dict):
            for k, v in obj.items():
                kl = str(k).lower()
                if any(fragment in kl for fragment in self.forbidden):
                    raise ContextViolation(f'forbidden context key at {path}.{k}')
                self._assert_no_forbidden_keys(v, f'{path}.{k}')
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                self._assert_no_forbidden_keys(v, f'{path}[{i}]')

    def pixel_payload(self, local_view: dict) -> dict:
        self._assert_no_forbidden_keys(local_view)
        # Strictly ensure neighbor data contains ONLY id, active, energy, public_md
        sanitized_neighbors = []
        for n in local_view.get("neighbors", []):
            sanitized_neighbors.append({
                "id": n.get("id") or n.get("pixel_id"),
                "active": bool(n.get("active", False)),
                "energy": float(n.get("energy", n.get("resource", 0.0))),
                "public_md": self._truncate(n.get("public_md", ""))
            })

        self_view = local_view.get("self", {})
        payload = {
            "round": local_view.get("round"),
            "self": {
                "pixel_id": self_view.get("pixel_id"),
                "state": self._truncate(self_view.get("state", {})),
                "self_md": self._truncate(self_view.get("self_md", "")),
                "memory_md": self._truncate(self_view.get("memory_md", "")),
                "workspace_summary": self._truncate(self_view.get("workspace_summary", {}))
            },
            "neighbors": sanitized_neighbors,
            "inbox": self._truncate(local_view.get("inbox", {})),
            "last_feedback": self._truncate(local_view.get("last_feedback")),
            "capabilities": self._truncate(local_view.get("external", {}).get("capabilities", [])),
            "available_tools": local_view.get("available_tools", []),
            "available_actions": local_view.get("allowed_actions", [])
        }

        # Backwards-compatibility for older tests
        if "allowed_actions" in local_view and "available_actions" not in payload:
            payload["allowed_actions"] = local_view["allowed_actions"]

        self._assert_no_forbidden_keys(payload)
        return payload

    @staticmethod
    def audit(payload):
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return {
            'sandbox_hash': sha256_text(raw),
            'sandbox_top_keys': sorted(payload.keys()),
            'sandbox_chars': len(raw)
        }
