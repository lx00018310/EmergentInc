import os
import shutil
from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.utils import read_json, write_json
from emergentinc.ui.snapshot import create_snapshot

FORBIDDEN_FIELDS = [
    'role', 'profession', 'department', 'manager',
    'specialization', 'job_type', 'job', 'genome',
    'current_problem', 'handoff_preference', 'risk_tolerance',
    'spawn_preference', 'cost_sensitivity', 'novelty_preference',
    'learned_principles', 'waiting_external_request', 'waiting_for'
]

def migrate_v8(base_dir=None):
    paths = get_paths(base_dir)
    storage = Storage(paths)
    live = paths.live_root

    print("==================================================")
    print("[START] EmergentInc V7.1 -> V8 Minimal Kernel Migration")
    print("==================================================")

    # 1. 迁移前安全快照 (Loop Snapshot)
    snapshot_dir = paths.loops_root / "snapshot_pre_v8_migration"
    print(f"[1/4] Creating safety snapshot -> {snapshot_dir}")
    create_snapshot(live, snapshot_dir)
    print("      Snapshot created successfully.")

    # 2. 准备 Market 目录
    opp_dir = live / "market" / "opportunities"
    arch_dir = live / "market" / "archive"
    opp_dir.mkdir(parents=True, exist_ok=True)
    arch_dir.mkdir(parents=True, exist_ok=True)

    # 3. 迁移 Problems 到 Market
    prob_dir = live / "problems"
    migrated_probs = 0
    if prob_dir.exists():
        print("[2/4] Migrating Problems to Market Opportunities...")
        for p_file in sorted(prob_dir.glob("P*.json")):
            try:
                p = read_json(p_file)
                pid = p.get("id")
                mid = f"M{pid[1:]}"
                status = p.get("status", "OPEN")

                # 特殊迁移 P0005 目标
                if pid == "P0005":
                    need = p.get("desired_state") or "创造一个业务，找到真实外部客户，并使其自愿付费至少 1 元。"
                    reward = float(p.get("reward_offer") or 100.0)
                    success = "payer_role = EXTERNAL_CUSTOMER, CNY >= 1"
                    m_status = "OPEN"
                else:
                    need = p.get("desired_state") or p.get("description") or f"Problem {pid}"
                    reward = float(p.get("reward_offer") or 100.0)
                    success = str(p.get("acceptance") or "Task completion verified.")
                    m_status = "CLOSED" if status in ("CLOSED", "RESOLVED") else "OPEN"

                opp_content = f"""# {mid}

## Need
{need}

## Reward
{reward} Energy

## Success
{success}

## Status
{m_status}

## Participants
"""
                if m_status == "CLOSED":
                    target_file = arch_dir / f"{mid}.md"
                else:
                    target_file = opp_dir / f"{mid}.md"

                target_file.write_text(opp_content, encoding="utf-8")
                migrated_probs += 1
            except Exception as e:
                print(f"      [WARN] Migration failed for {p_file.name}: {e}")

        print(f"      Converted/Archived {migrated_probs} tasks to Market.")

    # 4. 迁移 Pixels 到 V8 架构
    pixels_dir = live / "pixels"
    migrated_pixels = 0
    if pixels_dir.exists():
        print("[3/4] Upgrading Pixels to V8 Minimal Kernel structure...")
        for p_dir in sorted(pixels_dir.iterdir()):
            if not p_dir.is_dir() or not (p_dir / "state.json").exists():
                continue
            pid = p_dir.name

            # 4.1 迁移 genome.json -> legacy/genome_v7.json
            genome_file = p_dir / "genome.json"
            if genome_file.exists():
                legacy_dir = p_dir / "legacy"
                legacy_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(genome_file, legacy_dir / "genome_v7.json")

            # 4.2 清理 state.json 组织预定义字段
            st = read_json(p_dir / "state.json")
            energy = float(st.get("energy", st.get("resource", 100.0)))
            st["energy"] = energy
            st["resource"] = energy  # 保持别名
            for f in FORBIDDEN_FIELDS:
                st.pop(f, None)
            st.setdefault("position", [0, 0, 0])
            st.setdefault("parent", None)
            st.setdefault("born_round", 0)
            st.setdefault("sleep_until_round", None)
            st.setdefault("capabilities", [])
            st.setdefault("last_feedback", None)
            st.setdefault("last_active_round", int(storage.world().get("round", 0)))
            write_json(p_dir / "state.json", st)

            # 4.3 补齐 self.md, public.md, memory.md, inheritance.md
            self_file = p_dir / "self.md"
            if not self_file.exists():
                self_file.write_text(
                    f"# Self — {pid}\n\nI exist.\nI can observe, act, learn, communicate and change myself.\n",
                    encoding="utf-8"
                )

            public_file = p_dir / "public.md"
            if not public_file.exists():
                public_file.write_text(
                    f"# Public — {pid}\n\nAvailable for collaboration.\n",
                    encoding="utf-8"
                )

            mem_file = p_dir / "memory.md"
            if not mem_file.exists():
                old_mem_json = p_dir / "memory.json"
                if old_mem_json.exists():
                    try:
                        mem_data = read_json(old_mem_json)
                        mem_text = f"# Memory — {pid}\n\n" + "\n".join([f"- {k}: {v}" for k, v in mem_data.items()]) + "\n"
                    except Exception:
                        mem_text = f"# Memory — {pid}\n"
                else:
                    mem_text = f"# Memory — {pid}\n"
                mem_file.write_text(mem_text, encoding="utf-8")

            inh_file = p_dir / "inheritance.md"
            if not inh_file.exists():
                inh_file.write_text(f"# Inheritance — {pid}\n\nInitial Genesis Pixel.\n", encoding="utf-8")

            # 4.4 确保 V8 子目录结构
            (p_dir / "workspace").mkdir(parents=True, exist_ok=True)
            (p_dir / "inbox" / "messages").mkdir(parents=True, exist_ok=True)
            (p_dir / "inbox" / "attachments").mkdir(parents=True, exist_ok=True)
            (p_dir / "activity" / "rounds").mkdir(parents=True, exist_ok=True)

            migrated_pixels += 1
            print(f"      - Pixel {pid} upgraded (Energy: {energy})")

        print(f"      Total {migrated_pixels} pixels upgraded.")

    print("==================================================")
    print("[DONE] V8 Minimal Kernel Migration Finished Successfully!")
    print("==================================================")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", default=None, help="工作区路径")
    args = parser.parse_args()
    migrate_v8(args.workspace)
