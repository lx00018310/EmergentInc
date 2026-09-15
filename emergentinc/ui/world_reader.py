import re
import json
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from emergentinc.paths import ProjectPaths, get_paths
from emergentinc.engine.storage import Storage

ALLOWED_DOCS = {'state', 'genome', 'memory', 'history', 'llm_log', 'inbox'}

class WorldReader:
    def __init__(self, base_dir: Optional[Union[str, Path, ProjectPaths]] = None):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)
        self.base = self.paths.workspace_root
        self.s = Storage(self.paths)

    def get_world_dto(self) -> Dict[str, Any]:
        self.s.ensure_v5_defaults()
        w = self.s.world()
        rn = int(w.get('round', 0))

        # Pixels
        pixel_dtos = []
        for pid in self.s.pixel_ids():
            try:
                st = self.s.pixel_state(pid)
                gn = self.s.pixel_genome(pid)
                mem = self.s.pixel_memory(pid)
            except Exception:
                continue

            active = bool(st.get('active', False))
            waiting = bool(st.get('waiting_external_request') or st.get('waiting_for'))
            capabilities = st.get('capability_ids', [])

            pixel_dtos.append({
                "id": pid,
                "position": st.get('position', [0, 0, 0]),
                "active": active,
                "resource": float(st.get('resource', 0.0)),
                "current_problem": st.get('current_problem'),
                "parent": st.get('parent'),
                "born_round": st.get('born_round', 0),
                "grace_remaining": st.get('grace_remaining', 0),
                "sleep_until_round": st.get('sleep_until_round'),
                "waiting": waiting,
                "waiting_external_request": st.get('waiting_external_request'),
                "capabilities": capabilities,
                "genome": gn,
                "memory": mem
            })

        # Problems
        problems = []
        for pid in self.s.problem_ids():
            try:
                p = self.s.problem(pid)
                problems.append({
                    "id": p.get('id'),
                    "status": p.get('status'),
                    "current_holder": p.get('current_holder'),
                    "creator": p.get('creator'),
                    "description": p.get('description', ''),
                    "current_state": p.get('current_state', ''),
                    "desired_state": p.get('desired_state', ''),
                    "acceptance_criteria": p.get('acceptance_criteria', []),
                    "reward_budget": p.get('reward_budget', 0.0),
                    "created_round": p.get('created_round', 0)
                })
            except Exception:
                pass

        # Owner Requests (never includes private secret files)
        owner_requests = []
        for rid in self.s.external_request_ids():
            try:
                r = self.s.external_request(rid)
                owner_requests.append({
                    "id": r.get('id'),
                    "status": r.get('status'),
                    "requester": r.get('requester'),
                    "capability_type": r.get('capability_type'),
                    "purpose": r.get('purpose'),
                    "requested_operations": r.get('requested_operations', []),
                    "estimated_external_cost": r.get('estimated_external_cost', {}),
                    "problem_id": r.get('problem_id'),
                    "created_round": r.get('created_round'),
                    "owner_reason": r.get('owner_reason'),
                    "capability_id": r.get('capability_id')
                })
            except Exception:
                pass

        return {
            "round": rn,
            "pixels": pixel_dtos,
            "problems": problems,
            "owner_requests": owner_requests,
            "counters": w.get('counters', {}),
            "external_accounting": w.get('external_accounting', {}),
            "llm_accounting": w.get('llm_accounting', {}),
            "accounting": w.get('accounting', {})
        }

    def get_pixel_document(self, pixel_id: str, doc_name: str) -> str:
        # Anti path-traversal validation
        if not re.match(r'^[a-zA-Z0-9_\-]+$', pixel_id):
            raise ValueError(f"Invalid pixel_id format: {pixel_id}")

        if doc_name not in ALLOWED_DOCS:
            raise ValueError(f"Document '{doc_name}' is not in allowed document list: {sorted(ALLOWED_DOCS)}")

        pixel_dir = (self.s.live / 'pixels' / pixel_id).resolve()
        pixels_root = (self.s.live / 'pixels').resolve()
        if not str(pixel_dir).startswith(str(pixels_root)):
            raise PermissionError("Access outside pixels directory is strictly forbidden.")

        if not pixel_dir.exists():
            raise FileNotFoundError(f"Pixel '{pixel_id}' does not exist.")

        # Read md if present, else try json
        md_file = pixel_dir / f"{doc_name}.md"
        json_file = pixel_dir / f"{doc_name}.json"

        if md_file.exists():
            return md_file.read_text(encoding='utf-8')
        elif json_file.exists():
            data = json.loads(json_file.read_text(encoding='utf-8'))
            return json.dumps(data, ensure_ascii=False, indent=2)
        else:
            return f"# {doc_name} for {pixel_id}\n\n*(Document not found)*"
