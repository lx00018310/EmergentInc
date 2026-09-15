"""3D 物理网格与空间管理 (V9 World).

核心规则:
1. 3D 六邻域: (x±1, y, z), (x, y±1, z), (x, y, z±1)。
2. 邻接信息仅包含物理存在性与活跃状态 (id, active)，绝不泄漏邻居的 pixel.md。
3. 繁殖只允许在直接六邻域的未占用空位。
"""

from pathlib import Path
from typing import List, Dict, Tuple, Optional, Set
from .utils import coord_to_id, id_to_coord, neighbors6, read_json
from .pixel import PixelState, PixelStorage


class World:
    """管理空间网格中的 Pixels 及其物理拓扑."""

    def __init__(self, pixels_dir: Path):
        self.pixels_dir = Path(pixels_dir)

    def list_pixel_ids(self, active_only: bool = False) -> List[str]:
        """列出当前世界中所有的 Pixel ID."""
        if not self.pixels_dir.exists():
            return []
        ids = []
        for d in self.pixels_dir.iterdir():
            if d.is_dir() and (d / "state.json").exists():
                if active_only:
                    st = read_json(d / "state.json")
                    if not st.get("active", False):
                        continue
                ids.append(d.name)
        return sorted(ids)

    def get_pixel_storage(self, pixel_id: str) -> PixelStorage:
        return PixelStorage(self.pixels_dir / pixel_id)

    def is_occupied(self, pos: Tuple[int, int, int]) -> bool:
        """检查坐标是否已被占用 (无论 active 状态)."""
        pid = coord_to_id(pos)
        return (self.pixels_dir / pid / "state.json").exists()

    def get_occupied_positions(self) -> Set[Tuple[int, int, int]]:
        positions = set()
        for pid in self.list_pixel_ids():
            positions.add(id_to_coord(pid))
        return positions

    def is_neighbor(self, id1: str, id2: str) -> bool:
        """判定两个 Pixel 是否为 3D 六邻域直接邻居."""
        if id1 == id2:
            return False
        return id2 in neighbors6(id1)

    def get_neighbors_status(self, pixel_id: str) -> List[Dict[str, bool]]:
        """获取六邻域状态: 仅包含已存在邻居的 ID 与活跃状态."""
        status_list = []
        for n_id in neighbors6(pixel_id):
            p_storage = self.get_pixel_storage(n_id)
            if p_storage.state_file.exists():
                st = p_storage.load_state()
                status_list.append({"id": n_id, "active": st.active})
        return status_list

    def refresh_pixel_neighbors(self, pixel_id: str):
        """刷新指定 Pixel 的 state.json 中的 neighbors 物理感知列表."""
        storage = self.get_pixel_storage(pixel_id)
        if storage.state_file.exists():
            state = storage.load_state()
            state.neighbors = self.get_neighbors_status(pixel_id)
            storage.save_state(state)

    def refresh_all_neighbors(self):
        for pid in self.list_pixel_ids():
            self.refresh_pixel_neighbors(pid)

    def init_genesis(self, initial_energy: int = 100_000_000, initial_pixel_md: str = "") -> PixelStorage:
        """初始化创世元胞 (0, 0, 0)."""
        pid = "0_0_0"
        storage = self.get_pixel_storage(pid)
        if not storage.exists():
            genesis_state = PixelState(
                id=pid,
                position=[0, 0, 0],
                active=True,
                energy=initial_energy,
                parent=None,
                born_round=0,
                last_active_round=0,
                generation=0,
            )
            storage.save_state(genesis_state)
            storage.save_pixel_md(initial_pixel_md)
        self.refresh_pixel_neighbors(pid)
        return storage
