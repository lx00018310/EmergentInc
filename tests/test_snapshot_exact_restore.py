"""针对 V9.5 规范的快照精确恢复与非回滚边界测试.

验收规则:
1. 恢复快照时精确对账: 快照不存在的未来元胞被移出 live 并归档至 archived_future_pixels;
2. 历史能量绝对不可从快照中复活或增发 (Energy 非回滚边界);
3. 必须生成 snapshot_manifest.json.
"""

import json
from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.pixel import PixelStorage, PixelState
from emergentinc.engine.persistence import SnapshotManager
from emergentinc.engine.core_store import CoreStore


def test_snapshot_exact_restore_removes_future_pixels_and_preserves_energy_boundary(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    ws = paths.workspace_root

    def create_pixel(pid: str, energy: int):
        ps = PixelStorage(paths.live_root / "pixels" / pid)
        coords = [int(x) for x in pid.split("_")]
        ps.save_state(PixelState(id=pid, position=coords, active=True, energy=energy, born_round=1, last_active_round=1))
        ps.save_pixel_md(f"# Mind of {pid}")
        return ps

    # 阶段 1: 初始世界只有元胞 A ("0_0_0") 和 B ("0_1_0")
    create_pixel("0_0_0", energy=1000)
    create_pixel("0_1_0", energy=1000)

    db_path = ws / "ledger" / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_pixel_account("0_0_0", 1000)
    store.ensure_pixel_account("0_1_0", 1000)

    sm = SnapshotManager(ws)
    
    # 创建快照，必须生成 snapshot_manifest.json
    snap_dir = sm.create_snapshot(round_num=1, tag="baseline")
    snap_id = snap_dir.name
    manifest_file = snap_dir / "snapshot_manifest.json"
    assert manifest_file.exists()
    manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
    assert "0_0_0" in manifest_data["pixel_ids"]
    assert "0_1_0" in manifest_data["pixel_ids"]

    # 阶段 2: 演化推进，元胞 A 消耗 400 能量繁殖出未来元胞 C ("0_2_0")
    store.reproduce_pixel("0_0_0", "0_2_0", child_energy=400)
    create_pixel("0_2_0", energy=400)
    # 更新 A 的 state.json 投影
    ps_a = PixelStorage(paths.live_root / "pixels" / "0_0_0")
    st_a = ps_a.load_state()
    st_a.energy = 600
    ps_a.save_state(st_a)

    # 此时 live 中有 A, B, C
    live_p_dir = paths.live_root / "pixels"
    assert (live_p_dir / "0_0_0").exists()
    assert (live_p_dir / "0_1_0").exists()
    assert (live_p_dir / "0_2_0").exists()

    # 阶段 3: 执行快照回退恢复
    sm.restore_cognitive_state(snap_id)

    # 验证 1: 未来元胞 C 从 live/pixels 中被移出
    assert not (live_p_dir / "0_2_0").exists()

    # 验证 2: 未来元胞 C 被安全归档到了 archived_future_pixels/
    archive_dir = paths.live_root / "archived_future_pixels"
    assert (archive_dir / "0_2_0").exists()

    # 验证 3: 能量绝不从快照中复活！
    # 数据库中 A 的能量依然为 600，绝不恢复为快照时的 1000！
    a_acc = store.get_pixel_account("0_0_0")
    assert a_acc["energy"] == 600
    # A 的 state.json 投影中能量也是当前存量 600，不得从快照回滚成 1000
    st_a_restored = ps_a.load_state()
    assert st_a_restored.energy == 600

    # C 的能量保存在数据库原账户中 (400)，不能消失或被父级平白吸收
    c_acc = store.get_pixel_account("0_2_0")
    assert c_acc["energy"] == 400
