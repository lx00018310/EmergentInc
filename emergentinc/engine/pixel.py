"""Pixel 数据模型与物理规范 (V9 商业元胞规范).

核心规则:
1. 每个 Pixel 只有 state.json 和 pixel.md。
2. pixel.md 最大 2000 字符 (MAX_PIXEL_MD_CHARS = 2000)。
3. state.json 仅保存纯机器与物理参数，严禁包含角色、职位、部门、性格等预设字段。
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
import json
from .utils import read_json, write_json

MAX_PIXEL_MD_CHARS = 2000
FORBIDDEN_STATE_FIELDS = {
    "role", "job", "department", "personality", "risk_tolerance",
    "spawn_preference", "handoff_preference", "marketing_score",
    "engineering_score", "manager", "current_problem", "grace_remaining",
    "last_effective_exchange_round", "waiting_external_request",
    "waiting_for", "capability_ids", "last_feedback", "pending_self_trigger",
    "resource", "capabilities"
}


@dataclass
class PixelState:
    id: str
    position: List[int]
    active: bool = True
    energy: int = 100_000_000
    parent: Optional[str] = None
    born_round: int = 0
    last_active_round: int = 0
    sleep_until_round: Optional[int] = None
    generation: int = 0
    inbox_call_budget_per_round: int = 100_000
    neighbors: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "position": self.position,
            "active": self.active,
            "energy": self.energy,
            "parent": self.parent,
            "born_round": self.born_round,
            "last_active_round": self.last_active_round,
            "sleep_until_round": self.sleep_until_round,
            "generation": self.generation,
            "inbox_call_budget_per_round": self.inbox_call_budget_per_round,
            "neighbors": self.neighbors,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "PixelState":
        # 严格过滤禁止字段
        filtered = {k: v for k, v in d.items() if k not in FORBIDDEN_STATE_FIELDS}
        pid = str(filtered.get("id", "0_0_0"))
        pos = list(filtered.get("position", [0, 0, 0]))
        return cls(
            id=pid,
            position=pos,
            active=bool(filtered.get("active", True)),
            energy=int(filtered.get("energy", filtered.get("resource", 0))),
            parent=filtered.get("parent"),
            born_round=int(filtered.get("born_round", 0)),
            last_active_round=int(filtered.get("last_active_round", 0)),
            sleep_until_round=filtered.get("sleep_until_round"),
            generation=int(filtered.get("generation", 0)),
            inbox_call_budget_per_round=int(filtered.get("inbox_call_budget_per_round", 100_000)),
            neighbors=list(filtered.get("neighbors", [])),
        )


def validate_pixel_state(state_dict: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """验证 state 字典是否符合物理字段约束."""
    for forbidden in FORBIDDEN_STATE_FIELDS:
        if forbidden in state_dict:
            return False, f"Forbidden field '{forbidden}' found in state.json"
    if "id" not in state_dict or "position" not in state_dict:
        return False, "Missing required state fields: 'id' and 'position'"
    return True, None


def validate_pixel_md(content: str) -> Tuple[bool, Optional[str]]:
    """验证 pixel.md 是否满足最大 2000 字符限制."""
    if len(content) > MAX_PIXEL_MD_CHARS:
        return False, f"PIXEL_MD_TOO_LONG: length {len(content)} exceeds limit {MAX_PIXEL_MD_CHARS}"
    return True, None


class PixelStorage:
    """单个 Pixel 目录管理 (仅包含 state.json 与 pixel.md)."""

    def __init__(self, pixel_dir: Path):
        self.dir = Path(pixel_dir)
        self.state_file = self.dir / "state.json"
        self.pixel_file = self.dir / "pixel.md"

    def exists(self) -> bool:
        return self.state_file.exists() and self.pixel_file.exists()

    def load_state(self) -> PixelState:
        data = read_json(self.state_file)
        return PixelState.from_dict(data)

    def save_state(self, state: PixelState):
        self.dir.mkdir(parents=True, exist_ok=True)
        write_json(self.state_file, state.to_dict())

    def load_pixel_md(self) -> str:
        if not self.pixel_file.exists():
            return ""
        return self.pixel_file.read_text(encoding="utf-8")

    def save_pixel_md(self, content: str) -> bool:
        ok, _ = validate_pixel_md(content)
        if not ok:
            return False
        self.dir.mkdir(parents=True, exist_ok=True)
        self.pixel_file.write_text(content, encoding="utf-8")
        return True
