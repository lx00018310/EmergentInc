"""临时提示词配置与生命周期管理 (Temporary Prompt Manager).

核心规则:
1. 临时提示词保存于 workspace/runtime/temporary_prompt.json。
2. 独立于创世提示词，默认空白 (content="")，不自动填充建议内容。
3. 随时可保存、修改、清空；清空后后续 Run 不注入，重启不恢复默认内容。
4. Run 运行中禁止修改 (API 返回 409)。
5. 字符上限 12,000 字符，统一规范换行为 LF。
6. 内容发生真实变更时 revision 递增；内容未变保存不产生新 revision。
7. 临时提示词仅作为 system prompt 的附加 [TEMPORARY_CONTEXT]，绝对不进入三输入 payload 或 message.md。
"""

import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, Optional

MAX_TEMPORARY_PROMPT_CHARS = 12000


class TemporaryPromptManager:
    """临时提示词持久化与版本控制器."""

    def __init__(self, runtime_dir: Path):
        self.runtime_dir = Path(runtime_dir)
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.runtime_dir / "temporary_prompt.json"
        self.ensure_initialized()

    def ensure_initialized(self) -> Dict[str, Any]:
        """首次加载初始化，如文件不存在则创建空白默认结构."""
        if not self.config_file.exists():
            data = {
                "schema_version": 1,
                "revision": 0,
                "content": "",
                "sha256": hashlib.sha256(b"").hexdigest(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            self._save_file(data)
            return data
        return self.get_prompt()

    def _save_file(self, data: Dict[str, Any]):
        tmp_file = self.config_file.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_file.replace(self.config_file)

    def get_prompt(self) -> Dict[str, Any]:
        if not self.config_file.exists():
            return {
                "schema_version": 1,
                "revision": 0,
                "content": "",
                "sha256": hashlib.sha256(b"").hexdigest(),
                "active": False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        try:
            data = json.loads(self.config_file.read_text(encoding="utf-8"))
            content = data.get("content", "")
            data["active"] = bool(content.strip())
            return data
        except Exception:
            return {
                "schema_version": 1,
                "revision": 0,
                "content": "",
                "sha256": hashlib.sha256(b"").hexdigest(),
                "active": False,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }

    def update_prompt(self, raw_content: str) -> Dict[str, Any]:
        """更新临时提示词 (仅当内容发生实际变化时递增 revision)."""
        clean = (raw_content or "").replace("\r\n", "\n").replace("\r", "\n")
        # 纯空白视为空串关闭
        if not clean.strip():
            clean = ""

        if len(clean) > MAX_TEMPORARY_PROMPT_CHARS:
            raise ValueError(
                f"Temporary prompt length ({len(clean)}) exceeds maximum allowed ({MAX_TEMPORARY_PROMPT_CHARS})"
            )

        current = self.get_prompt()
        new_hash = hashlib.sha256(clean.encode("utf-8")).hexdigest()

        if clean == current.get("content", ""):
            # 内容无变化，不递增 revision
            return current

        new_rev = int(current.get("revision", 0)) + 1
        new_data = {
            "schema_version": 1,
            "revision": new_rev,
            "content": clean,
            "sha256": new_hash,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._save_file(new_data)
        new_data["active"] = bool(clean.strip())
        return new_data

    def clear_prompt(self) -> Dict[str, Any]:
        """清空临时提示词."""
        return self.update_prompt("")
