"""V8 至 V9 系统迁移程序 (V9 Migration Engine).

核心迁移逻辑:
1. 元胞心智合并: 将旧 self.md, memory.md, public.md, inheritance.md 合并为 pixel.md (<=2000字截断或摘要)。
2. state.json 净化: 严格剥离所有角色、任务、部门、基因组等非物理字段。
3. 工作区隔离: 旧 workspace/ 目录重命名移动至 legacy_v8_workspace/，彻底脱离 V9 Runtime。
4. 环境收敛: 旧 market 和现实目标合并收敛为全局 environment.md。
"""

import shutil
from pathlib import Path
from typing import Dict, Any
from .utils import read_json, write_json
from .pixel import PixelState, FORBIDDEN_STATE_FIELDS, MAX_PIXEL_MD_CHARS


class V9Migrator:
    """负责将旧版 workspace 迁移至 V9 纯净架构."""

    def __init__(self, workspace_dir: Path):
        self.ws = Path(workspace_dir)
        self.live = self.ws / "live"

    def migrate(self) -> Dict[str, Any]:
        report = {
            "migrated_pixels": [],
            "archived_workspaces": [],
            "environment_created": False,
        }

        # 1. 迁移每个 Pixel
        pixels_dir = self.live / "pixels"
        if pixels_dir.exists():
            for p in pixels_dir.iterdir():
                if p.is_dir():
                    pid = p.name
                    # 1.1 合并心智文件为 pixel.md
                    combined_mind = self._merge_mind_files(p)
                    pixel_md_path = p / "pixel.md"
                    pixel_md_path.write_text(combined_mind, encoding="utf-8")

                    # 1.2 净化 state.json
                    st_path = p / "state.json"
                    if st_path.exists():
                        old_st = read_json(st_path)
                        clean_st = {k: v for k, v in old_st.items() if k not in FORBIDDEN_STATE_FIELDS}
                        # 确保必须物理字段
                        clean_st.setdefault("energy", 100_000_000)
                        clean_st.setdefault("active", True)
                        clean_st.setdefault("born_round", 0)
                        clean_st.setdefault("last_active_round", 0)
                        clean_st.setdefault("generation", 0)
                        clean_st.setdefault("inbox_call_budget_per_round", 10000)
                        write_json(st_path, clean_st)

                    # 1.3 归档旧 workspace
                    old_ws = p / "workspace"
                    if old_ws.exists():
                        target_legacy = p / "legacy_v8_workspace"
                        if target_legacy.exists():
                            shutil.rmtree(target_legacy)
                        shutil.move(str(old_ws), str(target_legacy))
                        report["archived_workspaces"].append(f"{pid}/workspace -> {pid}/legacy_v8_workspace")

                    # 1.4 清理已废除的冗余心智文件 (只保留 state.json, pixel.md 与 legacy 归档)
                    for deprecated in [
                        "self.md", "public.md", "memory.md", "memory.json",
                        "inheritance.md", "genome.json", "genome.md", "inbox.md", "state.md"
                    ]:
                        dep_file = p / deprecated
                        if dep_file.exists():
                            dep_file.unlink()

                    report["migrated_pixels"].append(pid)

        # 2. 归档全局旧 market 与 problems，迁移生成 environment.md
        env_path = self.live / "environment.md"
        if not env_path.exists():
            env_content = "# Environment\n\n现实目标：\n尝试获得至少一个真实外部用户自愿支付 >= 1 CNY。\n\n当前：\n真实收入 = 0 CNY\n真实外部客户 = 0\n"
            env_path.write_text(env_content, encoding="utf-8")
            report["environment_created"] = True

        return report

    def _merge_mind_files(self, pixel_dir: Path) -> str:
        parts = ["[MIGRATION GENERATED]"]
        for fn in ["self.md", "memory.md", "inheritance.md", "public.md"]:
            f = pixel_dir / fn
            if f.exists():
                text = f.read_text(encoding="utf-8").strip()
                if text:
                    parts.append(f"### From {fn}\n{text}")

        merged = "\n\n".join(parts)
        if len(merged) > MAX_PIXEL_MD_CHARS:
            # 截断以保证不超标
            merged = merged[: MAX_PIXEL_MD_CHARS - 30] + "\n...[TRUNCATED BY MIGRATION]"
        return merged
