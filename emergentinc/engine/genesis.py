"""创世提示词配置与生命周期管理 (V9 Genesis Prompt Manager).

核心规则:
1. 创世提示词保存于 workspace/runtime/genesis_prompt.json。
2. content.strip() == "" 表示关闭，非空表示启用。
3. 首次升级且文件不存在时写入建议的初始创世提示词。
4. 文件已存在时绝不覆盖 Owner 的内容；Owner 清空后重启不得重新填充默认内容。
5. Run 运行中禁止修改 (API 返回 409)。
6. 字符上限 12,000 字符，统一规范换行为 LF。
7. 内容发生真实变更时 revision 递增；内容未变保存不产生新 revision。
8. 创世提示词仅作为 system prompt 的附加 [GENESIS_CONTEXT]，绝对不进入三输入 payload 或 message.md。
"""

import json
import hashlib
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, Tuple, Optional

MAX_GENESIS_PROMPT_CHARS = 12000

INITIAL_GENESIS_PROMPT = (
    "你正处在一个尚未被解释、尚未形成稳定结构的开放世界中。\n\n"
    "未来可能出现真实问题、有限资源、不同能力、交换、分工、合作、竞争以及稳定关系，"
    "但这些都只是可能出现的现象，不是世界预设的目标、身份或正确答案。\n\n"
    "底层规则没有规定什么样的 Pixel 更好，也没有规定上下级、组织、专业、价值、利润或成功应该是什么。"
    "不要为了迎合某种期待而假装这些结构已经存在。\n\n"
    "你的初始方向只有：\n"
    "1. 主动观察你被允许观察的真实环境与局部反馈；\n"
    "2. 在有限 energy 下进行小规模尝试，记录结果，并持续修正自己的 pixel.md；\n"
    "3. 通过局部 message 与直接邻居交换事实、问题、请求、方法或结果；\n"
    "4. 把未经观察或验证的判断当作假设，而不是事实；\n"
    "5. 自己决定是否独立行动、协作、转移 energy、复制或停止传播；\n"
    "6. 可以形成任何自我定义和稳定模式，也可以在证据变化后推翻它们。\n\n"
    "不要把任何暂时有效的做法误认为世界规则。只有在长期运行中反复出现并经外部结果支持的模式，"
    "才可能被观察者称为这个世界的规律。"
)


class GenesisPromptManager:
    """创世提示词持久化与版本控制器."""

    def __init__(self, runtime_dir: Path):
        self.runtime_dir = Path(runtime_dir)
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.runtime_dir / "genesis_prompt.json"
        self.ensure_initialized()

    def ensure_initialized(self) -> Dict[str, Any]:
        """首次加载初始化，如文件已存在则绝不覆盖."""
        if not self.config_file.exists():
            clean_content = INITIAL_GENESIS_PROMPT.replace("\r\n", "\n").replace("\r", "\n")
            data = {
                "schema_version": 1,
                "revision": 1,
                "content": clean_content,
                "sha256": hashlib.sha256(clean_content.encode("utf-8")).hexdigest(),
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
        """更新创世提示词 (仅当内容发生实际变化时递增 revision)."""
        clean = (raw_content or "").replace("\r\n", "\n").replace("\r", "\n")
        # 纯空白视为空串关闭
        if not clean.strip():
            clean = ""

        if len(clean) > MAX_GENESIS_PROMPT_CHARS:
            raise ValueError(f"Genesis prompt length ({len(clean)}) exceeds maximum allowed ({MAX_GENESIS_PROMPT_CHARS})")

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

    def get_effective_system_prompt(self, base_system_prompt: str) -> Tuple[str, Dict[str, Any]]:
        """组合物理基础 prompt 与当前锁定的创世提示词."""
        data = self.get_prompt()
        content = data.get("content", "").strip()
        if content:
            effective = f"{base_system_prompt}\n\n[GENESIS_CONTEXT]\n{content}"
        else:
            effective = base_system_prompt

        meta = {
            "effective_prompt_hash": hashlib.sha256(effective.encode("utf-8")).hexdigest(),
            "genesis_revision": data.get("revision", 0),
            "genesis_sha256": data.get("sha256"),
            "genesis_active": bool(content),
        }
        return effective, meta
