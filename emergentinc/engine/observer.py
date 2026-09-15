"""观测者系统 (V9 Observer Metrics).

核心规则:
1. 只观察，绝不将全局统计信息反馈给 Pixel 上下文。
2. 统计活跃元胞数、能量分布、繁殖/死亡数、实际花费与外部核验收入。
"""

import json
from pathlib import Path
from typing import Dict, Any, List
from .pixel import PixelStorage, PixelState
from .world import World
from .utils import read_json


class Observer:
    """收集并计算宏观观测指标."""

    def __init__(self, workspace_dir: Path):
        self.workspace = Path(workspace_dir)
        self.live_dir = self.workspace / "live"
        self.pixels_dir = self.live_dir / "pixels"
        self.ledger_file = self.workspace / "ledger" / "energy_ledger.jsonl"
        self.world = World(self.pixels_dir)

    def collect_metrics(self) -> Dict[str, Any]:
        all_ids = self.world.list_pixel_ids()
        active_ids = self.world.list_pixel_ids(active_only=True)

        energies: List[int] = []
        dead_count = 0
        reproduction_count = 0

        for pid in all_ids:
            storage = self.world.get_pixel_storage(pid)
            if storage.exists():
                st = storage.load_state()
                energies.append(st.energy)
                if not st.active:
                    dead_count += 1
                if st.parent is not None:
                    reproduction_count += 1

        total_energy = sum(energies)
        max_energy = max(energies, default=0)
        min_energy = min(energies, default=0)
        avg_energy = total_energy / len(energies) if energies else 0.0

        # 从 ledger 统计总收入与总结算费用
        total_spent = 0
        total_revenue = 0
        if self.ledger_file.exists():
            with self.ledger_file.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        record = json.loads(line)
                        etype = record.get("entry_type")
                        amt = record.get("amount", 0)
                        if etype == "settle" and amt < 0:
                            total_spent += abs(amt)
                        elif etype == "revenue":
                            total_revenue += amt
                    except Exception:
                        pass

        return {
            "total_pixels": len(all_ids),
            "active_pixels": len(active_ids),
            "dead_pixels": dead_count,
            "reproduction_count": reproduction_count,
            "energy_metrics": {
                "total": total_energy,
                "max": max_energy,
                "min": min_energy,
                "avg": avg_energy,
            },
            "financial_metrics": {
                "total_spent_equivalent_tokens": total_spent,
                "total_revenue_equivalent_tokens": total_revenue,
            },
        }
