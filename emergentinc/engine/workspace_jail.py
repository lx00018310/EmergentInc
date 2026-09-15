import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional

ALLOWED_SELF_FILES = {"self.md", "public.md", "memory.md", "inheritance.md"}

class JailViolation(PermissionError):
    pass

class WorkspaceJail:
    def __init__(self, storage):
        self.storage = storage
        self.live = self.storage.live

    def get_pixel_dir(self, pixel_id: str) -> Path:
        if not re.match(r'^[a-zA-Z0-9_\-]+$', pixel_id):
            raise JailViolation(f"Invalid pixel_id format: {pixel_id}")
        p = (self.live / "pixels" / pixel_id).resolve()
        pixels_root = (self.live / "pixels").resolve()
        if not str(p).startswith(str(pixels_root)):
            raise JailViolation("Pixel path traversal detected.")
        if not p.exists():
            raise FileNotFoundError(f"Pixel {pixel_id} does not exist.")
        return p

    def get_workspace_dir(self, pixel_id: str) -> Path:
        pixel_dir = self.get_pixel_dir(pixel_id)
        ws = (pixel_dir / "workspace").resolve()
        ws.mkdir(parents=True, exist_ok=True)
        return ws

    def _resolve_workspace_path(self, pixel_id: str, rel_path: str, must_exist: bool = False) -> Path:
        if not rel_path or not isinstance(rel_path, str):
            raise JailViolation("File path must be a non-empty string.")
        # Reject absolute paths or drive letters
        if os.path.isabs(rel_path) or re.match(r'^[a-zA-Z]:', rel_path):
            raise JailViolation(f"Absolute paths are forbidden: {rel_path}")
        ws = self.get_workspace_dir(pixel_id)
        # Normalize and resolve target path
        target = (ws / rel_path).resolve()
        # Verify root jail containment
        if not str(target).startswith(str(ws)):
            raise JailViolation(f"Path traversal outside workspace forbidden: {rel_path}")
        if must_exist and not target.exists():
            raise FileNotFoundError(f"File not found in workspace: {rel_path}")
        return target

    # --- Self Files ---
    def read_self_file(self, pixel_id: str, file_name: str) -> str:
        if file_name not in ALLOWED_SELF_FILES:
            raise JailViolation(f"Cannot read '{file_name}': only {ALLOWED_SELF_FILES} allowed.")
        pixel_dir = self.get_pixel_dir(pixel_id)
        target = (pixel_dir / file_name).resolve()
        if not str(target).startswith(str(pixel_dir)):
            raise JailViolation("Path traversal forbidden.")
        if not target.exists():
            return ""
        return target.read_text(encoding="utf-8", errors="replace")

    def write_self_file(self, pixel_id: str, file_name: str, content: str) -> None:
        if file_name not in ALLOWED_SELF_FILES:
            raise JailViolation(f"Cannot write '{file_name}': only {ALLOWED_SELF_FILES} allowed.")
        pixel_dir = self.get_pixel_dir(pixel_id)
        target = (pixel_dir / file_name).resolve()
        if not str(target).startswith(str(pixel_dir)):
            raise JailViolation("Path traversal forbidden.")
        target.write_text(content, encoding="utf-8")

    def delete_self_file(self, pixel_id: str, file_name: str) -> bool:
        if file_name not in ALLOWED_SELF_FILES:
            raise JailViolation(f"Cannot delete '{file_name}': only {ALLOWED_SELF_FILES} allowed.")
        pixel_dir = self.get_pixel_dir(pixel_id)
        target = (pixel_dir / file_name).resolve()
        if not str(target).startswith(str(pixel_dir)):
            raise JailViolation("Path traversal forbidden.")
        if target.exists():
            target.unlink()
            return True
        return False

    # --- Workspace Files ---
    def list_workspace(self, pixel_id: str, rel_path: str = "") -> List[Dict[str, Any]]:
        ws = self.get_workspace_dir(pixel_id)
        if rel_path:
            target = self._resolve_workspace_path(pixel_id, rel_path, must_exist=True)
        else:
            target = ws
        if not target.is_dir():
            raise NotADirectoryError(f"Path is not a directory: {rel_path}")
        
        entries = []
        for item in sorted(target.iterdir()):
            entries.append({
                "name": item.name,
                "is_dir": item.is_dir(),
                "size": item.stat().st_size if item.is_file() else 0,
                "rel_path": str(item.relative_to(ws)).replace("\\", "/")
            })
        return entries

    def get_workspace_summary(self, pixel_id: str, max_files: int = 30) -> Dict[str, Any]:
        ws = self.get_workspace_dir(pixel_id)
        files = []
        total_size = 0
        for p in ws.rglob("*"):
            if p.is_file():
                sz = p.stat().st_size
                total_size += sz
                if len(files) < max_files:
                    files.append({
                        "path": str(p.relative_to(ws)).replace("\\", "/"),
                        "size": sz,
                        "modified": p.stat().st_mtime
                    })
        # Sort by recently modified
        files.sort(key=lambda x: x["modified"], reverse=True)
        return {
            "total_files": len(list(ws.rglob("*"))),
            "total_bytes": total_size,
            "recent_files": files[:15]
        }

    def read_workspace_file(self, pixel_id: str, rel_path: str, max_chars: int = 10000, must_exist: bool = True) -> str:
        target = self._resolve_workspace_path(pixel_id, rel_path, must_exist=must_exist)
        if not target.is_file():
            raise IsADirectoryError(f"Cannot read directory as file: {rel_path}")
        text = target.read_text(encoding="utf-8", errors="replace")
        if len(text) > max_chars:
            return text[:max_chars] + f"\n... [TRUNCATED at {max_chars} chars]"
        return text

    def write_workspace_file(self, pixel_id: str, rel_path: str, content: str) -> None:
        target = self._resolve_workspace_path(pixel_id, rel_path, must_exist=False)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")

    def delete_workspace_file(self, pixel_id: str, rel_path: str) -> bool:
        target = self._resolve_workspace_path(pixel_id, rel_path, must_exist=True)
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        return True

    def move_workspace_file(self, pixel_id: str, src_rel: str, dst_rel: str) -> None:
        src = self._resolve_workspace_path(pixel_id, src_rel, must_exist=True)
        dst = self._resolve_workspace_path(pixel_id, dst_rel, must_exist=False)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))

    # --- Run Command ---
    def run_workspace_command(self, pixel_id: str, command: str, timeout: int = 10, max_chars: int = 8000) -> Dict[str, Any]:
        ws = self.get_workspace_dir(pixel_id)
        if not command or not isinstance(command, str):
            raise JailViolation("Command must be a non-empty string.")
        
        # Disallow commands that attempt to manipulate outside paths via explicit cd ..
        if re.search(r'\bcd\s+\.\.', command):
            raise JailViolation("Commands attempting directory escape (cd ..) are prohibited.")

        try:
            res = subprocess.run(
                command,
                cwd=str(ws),
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout
            )
            out = (res.stdout or "") + (res.stderr or "")
            if len(out) > max_chars:
                out = out[:max_chars] + f"\n... [OUTPUT TRUNCATED at {max_chars} chars]"
            return {
                "exit_code": res.returncode,
                "output": out.strip()
            }
        except subprocess.TimeoutExpired:
            return {
                "exit_code": -1,
                "output": f"COMMAND_TIMEOUT: execution exceeded {timeout} seconds."
            }
        except Exception as e:
            return {
                "exit_code": -2,
                "output": f"EXECUTION_ERROR: {str(e)}"
            }
