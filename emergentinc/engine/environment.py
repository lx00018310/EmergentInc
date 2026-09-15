"""外部环境管理 (V9 Environment).

核心规则:
1. 世界只有一个外部现实状态文件: environment.md。
2. environment.md 默认对所有 Pixel 完全不可见，绝对不自动注入。
3. 只有 Pixel 在上一跳中显式声明 environment_read: true 时，Engine 才在下一跳将其作为 message.md 传入。
4. Pixel 不能直接写 environment.md，只能由 Owner 或现实事实核验记录更新。
"""

from pathlib import Path
from typing import Optional, Dict, Any
from .utils import read_json, write_json


DEFAULT_ENVIRONMENT_MD = """# Environment

现实目标：
尝试获得至少一个真实外部用户自愿支付 >= 1 CNY。

当前：
真实收入 = 0 CNY
真实外部客户 = 0

成功条件：
只有真实外部支付可以作为成功。
"""


class Environment:
    """管理全局单一环境文件 environment.md 与事实核验."""

    def __init__(self, env_path: Path):
        self.path = Path(env_path)
        if not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(DEFAULT_ENVIRONMENT_MD, encoding="utf-8")

    def read_content(self) -> str:
        """获取当前环境的完整文本内容."""
        if not self.path.exists():
            return ""
        return self.path.read_text(encoding="utf-8")

    def update_content(self, new_content: str):
        """Owner 或外部事实系统更新环境内容."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(new_content, encoding="utf-8")

    def append_fact(self, fact_text: str):
        """追加已核验的外部事实."""
        current = self.read_content()
        updated = current.strip() + f"\n\n- [FACT] {fact_text}\n"
        self.update_content(updated)


class EnvironmentScheduler:
    """Legacy V8 环境调度器 (兼容旧测试)."""

    def __init__(self, storage):
        self.s = storage
        exp_file = self.s.paths.experiments_dir / "experiment_001.json"
        self.exp = read_json(exp_file) if exp_file.exists() else {}

    def inject(self, round_num):
        events = {}
        created = []
        for item in self.exp.get("environment_schedule", []):
            if int(item["round"]) != round_num:
                continue
            pdef = item["problem"]
            pid = pdef["id"]
            if pid in self.s.problem_ids():
                continue
            entry = item["entry_pixel"]
            p = {
                "id": pid,
                "status": "OPEN",
                "creator": "ENVIRONMENT",
                "current_holder": None,
                "parent_problem": None,
                "current_state": pdef["current_state"],
                "desired_state": pdef["desired_state"],
                "acceptance": pdef["acceptance"],
                "reward_offer": float(pdef["reward_offer"]),
                "reward_source": {"type": "ENVIRONMENT"},
                "route": ["ENVIRONMENT"],
                "contracts": [],
                "offers": [
                    {
                        "from": "ENVIRONMENT",
                        "to": entry,
                        "offered_resource": float(pdef["reward_offer"]),
                        "status": "OPEN",
                        "round": round_num,
                    }
                ],
                "bids": [],
                "evidence": [],
                "evidence_policy": pdef["evidence_policy"],
                "created_round": round_num,
                "deadline_round": None,
            }
            self.s.save_problem(p)
            events.setdefault(entry, []).append(f"Environment offered {pid}")
            created.append(pid)
        return events, created
