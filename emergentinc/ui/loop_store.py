import json
import shutil
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union
from emergentinc.paths import ProjectPaths, get_paths
from . import snapshot

class LoopStore:
    def __init__(self, base_dir: Optional[Union[str, Path, ProjectPaths]] = None):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)
        self.base = self.paths.workspace_root
        self.loops_dir = self.paths.loops_root
        self.live_dir = self.paths.live_root
        self.manifest_path = self.loops_dir / 'manifest.json'
        self.branches_dir = self.loops_dir / 'branches'
        self.checkpoints_dir = self.loops_dir / 'checkpoints'
        self.ensure_initialized()

    def _read_json(self, path: Path) -> Dict[str, Any]:
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding='utf-8'))

    def _write_json(self, path: Path, data: Any) -> None:
        from emergentinc.engine.utils import write_json
        write_json(path, data)

    def ensure_initialized(self) -> None:
        self.branches_dir.mkdir(parents=True, exist_ok=True)
        self.checkpoints_dir.mkdir(parents=True, exist_ok=True)
        if not self.manifest_path.exists():
            manifest = {
                "current_branch": "main",
                "current_loop": None
            }
            self._write_json(self.manifest_path, manifest)
        
        main_branch_path = self.branches_dir / 'main.json'
        if not main_branch_path.exists():
            main_branch = {
                "branch": "main",
                "head": None,
                "created_from": None
            }
            self._write_json(main_branch_path, main_branch)

    def get_manifest(self) -> Dict[str, Any]:
        return self._read_json(self.manifest_path)

    def save_manifest(self, manifest: Dict[str, Any]) -> None:
        self._write_json(self.manifest_path, manifest)

    def list_branches(self) -> List[Dict[str, Any]]:
        branches = []
        for p in sorted(self.branches_dir.glob('*.json')):
            branches.append(self._read_json(p))
        return branches

    def get_branch(self, name: str) -> Optional[Dict[str, Any]]:
        p = self.branches_dir / f"{name}.json"
        if p.exists():
            return self._read_json(p)
        return None

    def save_branch(self, name: str, data: Dict[str, Any]) -> None:
        p = self.branches_dir / f"{name}.json"
        self._write_json(p, data)

    def get_loop(self, loop_id: str) -> Optional[Dict[str, Any]]:
        p = self.checkpoints_dir / loop_id / 'meta.json'
        if p.exists():
            return self._read_json(p)
        return None

    def list_loops(self) -> List[Dict[str, Any]]:
        loops = []
        for d in sorted(self.checkpoints_dir.iterdir()):
            if d.is_dir() and (d / 'meta.json').exists():
                loops.append(self._read_json(d / 'meta.json'))
        return loops

    def _next_loop_id(self) -> str:
        nums = []
        for d in self.checkpoints_dir.iterdir():
            if d.is_dir() and d.name.startswith('L'):
                try:
                    nums.append(int(d.name[1:]))
                except ValueError:
                    pass
        next_num = max(nums, default=0) + 1
        return f"L{next_num:06d}"

    def start_loop(self, command_text: str, start_round: int) -> Dict[str, Any]:
        manifest = self.get_manifest()
        current_branch_name = manifest.get('current_branch', 'main')
        branch_info = self.get_branch(current_branch_name) or {"branch": current_branch_name, "head": None}
        parent_id = branch_info.get('head')

        loop_id = self._next_loop_id()
        ckpt_dir = self.checkpoints_dir / loop_id
        ckpt_dir.mkdir(parents=True, exist_ok=True)

        # Snapshot before
        before_dir = ckpt_dir / 'before'
        snapshot.create_snapshot(self.live_dir, before_dir)

        meta = {
            "id": loop_id,
            "parent": parent_id,
            "branch": current_branch_name,
            "command": command_text,
            "start_round": start_round,
            "end_round": start_round,
            "status": "RUNNING",
            "stop_reason": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "checkpoint": f"checkpoints/{loop_id}"
        }
        self._write_json(ckpt_dir / 'meta.json', meta)

        # Update branch head & manifest
        branch_info['head'] = loop_id
        self.save_branch(current_branch_name, branch_info)
        manifest['current_loop'] = loop_id
        self.save_manifest(manifest)

        return meta

    def finish_loop(self, loop_id: str, end_round: int, status: str, stop_reason: Optional[str] = None) -> Dict[str, Any]:
        ckpt_dir = self.checkpoints_dir / loop_id
        meta_path = ckpt_dir / 'meta.json'
        meta = self._read_json(meta_path)
        if not meta:
            raise ValueError(f"Loop not found: {loop_id}")

        after_dir = ckpt_dir / 'after'
        try:
            snapshot.create_snapshot(self.live_dir, after_dir)
        except Exception as exc:
            meta.update(end_round=end_round, status="ERROR",
                        stop_reason=f"SNAPSHOT_FAILED: {exc}",
                        finished_at=datetime.now(timezone.utc).isoformat())
            self._write_json(meta_path, meta)
            raise

        meta['end_round'] = end_round
        meta['status'] = status
        meta['stop_reason'] = stop_reason
        meta['finished_at'] = datetime.now(timezone.utc).isoformat()
        self._write_json(meta_path, meta)

        return meta

    def checkout_loop(self, loop_id: str, new_branch_name: Optional[str] = None) -> Dict[str, Any]:
        meta = self.get_loop(loop_id)
        if not meta:
            raise ValueError(f"Loop not found: {loop_id}")

        if not new_branch_name:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            new_branch_name = f"branch_{timestamp}"

        if self.get_branch(new_branch_name):
            raise ValueError(f"Branch already exists: {new_branch_name}")

        ckpt_dir = self.checkpoints_dir / loop_id
        src_snap = ckpt_dir / 'after'
        if not src_snap.exists():
            src_snap = ckpt_dir / 'before'
        if not src_snap.exists():
            raise FileNotFoundError(f"No snapshot found for loop {loop_id}")

        # Restore snapshot
        snapshot.restore_snapshot(src_snap, self.live_dir)

        # Create branch
        manifest = self.get_manifest()
        new_branch = {
            "branch": new_branch_name,
            "head": loop_id,
            "created_from": manifest.get('current_branch', 'main')
        }
        self.save_branch(new_branch_name, new_branch)

        manifest['current_branch'] = new_branch_name
        manifest['current_loop'] = loop_id
        self.save_manifest(manifest)

        return {"branch": new_branch_name, "head": loop_id}

    def branch_from(self, loop_id: str, branch_name: str) -> Dict[str, Any]:
        meta = self.get_loop(loop_id)
        if not meta:
            raise ValueError(f"Loop not found: {loop_id}")

        clean_name = branch_name.strip()
        if not clean_name:
            raise ValueError("Branch name cannot be empty")
        if self.get_branch(clean_name):
            raise ValueError(f"Branch already exists: {clean_name}")

        ckpt_dir = self.checkpoints_dir / loop_id
        src_snap = ckpt_dir / 'after'
        if not src_snap.exists():
            src_snap = ckpt_dir / 'before'
        if not src_snap.exists():
            raise FileNotFoundError(f"No snapshot found for loop {loop_id}")

        snapshot.restore_snapshot(src_snap, self.live_dir)

        manifest = self.get_manifest()
        new_branch = {
            "branch": clean_name,
            "head": loop_id,
            "created_from": manifest.get('current_branch', 'main')
        }
        self.save_branch(clean_name, new_branch)

        manifest['current_branch'] = clean_name
        manifest['current_loop'] = loop_id
        self.save_manifest(manifest)

        return new_branch

    def delete_loop(self, loop_id: str) -> None:
        meta = self.get_loop(loop_id)
        if not meta:
            raise ValueError(f"Loop not found: {loop_id}")

        all_loops = self.list_loops()
        children = [l['id'] for l in all_loops if l.get('parent') == loop_id]
        if children:
            raise ValueError(f"Cannot delete non-leaf loop {loop_id}; children exist: {children}")

        # If it's a branch head, move head to parent
        branches = self.list_branches()
        for b in branches:
            if b.get('head') == loop_id:
                b['head'] = meta.get('parent')
                self.save_branch(b['branch'], b)

        manifest = self.get_manifest()
        if manifest.get('current_loop') == loop_id:
            manifest['current_loop'] = meta.get('parent')
            self.save_manifest(manifest)

        ckpt_dir = self.checkpoints_dir / loop_id
        if ckpt_dir.exists():
            shutil.rmtree(ckpt_dir)

    def delete_branch(self, branch_name: str) -> None:
        manifest = self.get_manifest()
        if manifest.get('current_branch') == branch_name:
            raise ValueError(f"Cannot delete active branch: {branch_name}")
        if branch_name == 'main':
            raise ValueError("Cannot delete main branch")

        p = self.branches_dir / f"{branch_name}.json"
        if not p.exists():
            raise ValueError(f"Branch not found: {branch_name}")

        p.unlink()
