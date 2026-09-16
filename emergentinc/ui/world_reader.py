"""V9 专用的世界状态读取与 DTO 转换服务 (V9 World Reader).

核心规则:
1. 严格收敛至 V9 数据规范，输出包含 V9 纯净核心字段与 Observer 宏观指标。
2. 兼容保留历史 rounds 目录中的决策活动快照 (latest_activity)。
3. 提供最新 Round 消息流记录 (Message Flow)，供 2.5D 地图动态展示。
4. 严格白名单与路径穿越防御检查 (ALLOWED_DOCS)。
"""

import json
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from emergentinc.paths import ProjectPaths, get_paths
from emergentinc.engine.world import World
from emergentinc.engine.pixel import PixelStorage
from emergentinc.engine.environment import Environment
from emergentinc.engine.observer import Observer
from emergentinc.engine.utils import read_json

ALLOWED_DOCS = {
    "state", "self", "public", "memory", "inheritance",
    "history", "llm_log", "inbox", "genome", "pixel", "environment"
}


class WorldReader:
    """提供供 Web UI 消费的完整 V9 DTO."""

    def __init__(self, base_dir: Optional[Union[str, Path, ProjectPaths]] = None):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)
        self.workspace = self.paths.workspace_root
        self.live = self.paths.live_root
        self.pixels_dir = self.live / "pixels"
        self.artifacts_dir = self.live / "artifacts"
        self.env_file = self.live / "environment.md"
        self.world_state_file = self.live / "world_state.json"

        self.world = World(self.pixels_dir)
        self.env = Environment(self.env_file)
        self.observer = Observer(self.workspace)

    def get_world_dto(self) -> Dict[str, Any]:
        # 1. 基础轮次状态
        w_state = {}
        if self.world_state_file.exists():
            try:
                w_state = read_json(self.world_state_file)
            except Exception:
                pass
        current_round = int(w_state.get("round", 0))

        # 2. 读取最新回合快照 (若有)，以兼容旧 activity
        latest_round_data = {}
        round_file = self.live / "rounds" / f"round_{current_round:04d}.json"
        if round_file.exists():
            try:
                latest_round_data = read_json(round_file)
            except Exception:
                pass

        decisions = latest_round_data.get("decisions", {})
        applied = {item.get("pixel") for item in latest_round_data.get("applied", [])}
        rejected = {item.get("pixel"): item.get("reason", "REJECTED") for item in latest_round_data.get("rejected", [])}

        # 3. 宏观观测者指标
        metrics = self.observer.collect_metrics()

        # 4. 读取各元胞信息
        pixel_dtos = []
        for pid in self.world.list_pixel_ids():
            storage = self.world.get_pixel_storage(pid)
            if not storage.state_file.exists():
                continue
            st = storage.load_state()
            mind = storage.load_pixel_md()

            art_dir = self.artifacts_dir / pid
            art_count = len(list(art_dir.glob("*"))) if art_dir.exists() else 0

            raw_st = {}
            if storage.state_file.exists():
                try:
                    raw_st = read_json(storage.state_file)
                except Exception:
                    pass
            caps = raw_st.get("capability_ids", raw_st.get("capabilities", []))

            latest_activity = None
            if pid in decisions:
                dec = decisions[pid]
                result = "REJECTED" if pid in rejected else ("APPLIED" if pid in applied else "RECORDED")
                latest_activity = {
                    "round": current_round,
                    "action": dec.get("action", "V9_STEP"),
                    "intent": dec.get("intent", dec.get("reasoning_summary", "")),
                    "result": result,
                    "work_output": dec.get("work_output"),
                }

            pixel_dtos.append({
                "id": pid,
                "position": st.position,
                "active": st.active,
                "energy": st.energy,
                "resource": st.energy,
                "parent": st.parent,
                "born_round": st.born_round,
                "last_active_round": st.last_active_round,
                "generation": st.generation,
                "neighbors": st.neighbors,
                "capabilities": caps,
                "pixel_md": mind,
                "pixel_md_length": len(mind),
                "artifacts_count": art_count,
                "latest_activity": latest_activity,
            })

        # 5. 最新消息流快照
        latest_flow = []
        flow_file = self.paths.ui_state_root / "latest_flow.json"
        if flow_file.exists():
            try:
                latest_flow = read_json(flow_file)
            except Exception:
                pass

        return {
            "round": current_round,
            "pixels": pixel_dtos,
            "environment_md": self.env.read_content(),
            "metrics": metrics,
            "latest_message_flow": latest_flow,
            "problems": [],
            "owner_requests": [],
        }

    def get_pixel_document(self, pixel_id: str, doc_name: str) -> str:
        """获取元胞文档内容，严格校验白名单与路径穿越."""
        if ".." in doc_name or "/" in doc_name or "\\" in doc_name:
            raise ValueError("Path traversal attack detected")
        if ".." in pixel_id or "/" in pixel_id or "\\" in pixel_id:
            raise ValueError("Path traversal attack detected")

        if doc_name not in ALLOWED_DOCS:
            raise ValueError(f"Document '{doc_name}' is not in allowed document list")

        if doc_name == "environment":
            return self.env.read_content()

        p_dir = self.pixels_dir / pixel_id
        if not p_dir.exists():
            raise FileNotFoundError(f"Pixel '{pixel_id}' does not exist.")

        if doc_name == "pixel":
            p_file = p_dir / "pixel.md"
            return p_file.read_text(encoding="utf-8") if p_file.exists() else ""
        elif doc_name == "state":
            st_file = p_dir / "state.json"
            return st_file.read_text(encoding="utf-8") if st_file.exists() else ""
        else:
            # 兼容读取其他历史文件 (如 history.md, self.md 等)
            target = p_dir / f"{doc_name}.md"
            if not target.exists():
                target = p_dir / f"{doc_name}.json"
            if not target.exists():
                raise FileNotFoundError(f"Document '{doc_name}' not found for pixel '{pixel_id}'")
            return target.read_text(encoding="utf-8")

    def list_pixel_artifacts(self, pixel_id: str) -> List[Dict[str, Any]]:
        """列出指定 Pixel 的所有本地交付物 (只读)."""
        from emergentinc.engine.operations import is_valid_coord_id
        if not is_valid_coord_id(pixel_id):
            raise ValueError(f"Invalid pixel_id format: '{pixel_id}'")
        artifacts_p_dir = self.artifacts_dir / pixel_id
        if not artifacts_p_dir.exists() or not artifacts_p_dir.is_dir():
            return []
        items = []
        for p in sorted(artifacts_p_dir.glob("*")):
            if p.is_file():
                items.append({
                    "filename": p.name,
                    "size_bytes": p.stat().st_size,
                })
        return items

    def get_pixel_artifact(self, pixel_id: str, filename: str) -> str:
        """读取指定 Pixel 的本地交付物文本内容 (严格防范路径穿越)."""
        from emergentinc.engine.operations import is_valid_coord_id, validate_artifact_filename
        if not is_valid_coord_id(pixel_id):
            raise ValueError(f"Invalid pixel_id format: '{pixel_id}'")
        ok, err = validate_artifact_filename(filename)
        if not ok:
            raise ValueError(err or "Invalid filename")
        artifacts_p_dir = (self.artifacts_dir / pixel_id).resolve()
        target = (artifacts_p_dir / filename.strip()).resolve()
        if not str(target).startswith(str(artifacts_p_dir)):
            raise PermissionError("Path traversal attack detected")
        if not target.exists() or not target.is_file():
            raise FileNotFoundError(f"Artifact '{filename}' not found for pixel '{pixel_id}'")
        return target.read_text(encoding="utf-8", errors="replace")
