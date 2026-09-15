"""认知隔离 LLM 客户端与调用适配 (V9 Cognitive Isolation LLM Client).

核心规则:
1. 单次调用严格限定为三项输入: state.json, pixel.md, message.md。
2. 严禁传入全局世界、市场对象、其他元胞完整心智、组织树等第四类信息。
3. 系统提示词保持极简物理法则，不包含任何商业策略、角色预设或理论。
4. 输出严格遵守 V9PixelResponse Schema。
"""

import os
import re
import json
from pathlib import Path
from typing import Optional, Union, Dict, Any, Tuple, Callable
import httpx
from openai import OpenAI
import jsonschema
from .utils import sha256_text, read_json
from emergentinc.paths import ProjectPaths, get_paths


class CognitiveIsolationViolation(RuntimeError):
    """违反认知隔离原则时抛出的异常."""
    pass


class V9LLMClient:
    """V9 统一模型客户端，保证纯三输入上下文与输出 Schema 校验."""

    def __init__(
        self,
        base_dir: Optional[Union[str, Path, ProjectPaths]] = None,
        mock_handler: Optional[Callable[[Dict[str, Any]], Dict[str, Any]]] = None,
    ):
        if isinstance(base_dir, ProjectPaths):
            self.paths = base_dir
        else:
            self.paths = get_paths(base_dir)

        self.mock_handler = mock_handler
        self.system_prompt_file = self.paths.prompts_dir / "v9_system_prompt.md"
        self.schema_file = self.paths.schemas_dir / "v9_pixel_response.schema.json"

        if self.system_prompt_file.exists():
            self.system_prompt = self.system_prompt_file.read_text(encoding="utf-8")
        else:
            self.system_prompt = "你是一个Pixel。你只能依据当前 state.json、pixel.md 和 message.md 做决定。"

        if self.schema_file.exists():
            self.schema = read_json(self.schema_file)
        else:
            self.schema = {}

        # 环境变量与配置加载
        config_path = self.paths.config_dir / "world_config.json"
        self.cfg = read_json(config_path) if config_path.exists() else {}
        self._init_client()

    def _init_client(self):
        mc = self.cfg.get("model", {})
        env_file = mc.get("env_file", ".env")
        if env_file:
            env_path = self.paths.project_root / env_file
            if env_path.is_file():
                try:
                    from dotenv import load_dotenv
                    load_dotenv(env_path, override=False)
                except Exception:
                    pass

        self.base_url = (
            os.environ.get(mc.get("base_url_env", "MCL_BASE_URL"))
            or os.environ.get("MCL_BASE_URL")
            or mc.get("base_url")
        )
        self.api_key = (
            os.environ.get(mc.get("api_key_env", "MCL_API_KEY"))
            or os.environ.get("MCL_API_KEY")
        )
        self.model_name = (
            os.environ.get(mc.get("decision_model_env", "MCL_DECISION_MODEL"))
            or os.environ.get("MCL_MODEL")
            or mc.get("default_model", "gpt-4o-mini")
        )

        if self.api_key and self.base_url and self.base_url != "CONFIGURE_ME":
            self.client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                http_client=httpx.Client(trust_env=False),
            )
        else:
            self.client = None

    def step(
        self,
        state_dict: Dict[str, Any],
        pixel_md: str,
        message_md: str,
        extra_check: bool = True,
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """唯一模型决策入口.

        严格检查并构造 payload:
        payload 仅包含: state, pixel_md, message_md
        """
        # 1. 认知隔离检查
        payload = {
            "state": state_dict,
            "pixel_md": pixel_md,
            "message_md": message_md,
        }
        if extra_check and len(payload.keys()) != 3:
            raise CognitiveIsolationViolation("Context payload must strictly contain exactly 3 keys: state, pixel_md, message_md")

        user_content = json.dumps(payload, ensure_ascii=False, indent=2)
        prompt_full = f"{self.system_prompt}\n\n{user_content}"
        prompt_hash = sha256_text(prompt_full)

        # 2. 如果存在 mock_handler，优先用于测试或离线模式
        if self.mock_handler is not None:
            data = self.mock_handler(payload)
            jsonschema.validate(data, self.schema)
            audit = {
                "kind": "V9_STEP",
                "model": "mock",
                "prompt_hash": prompt_hash,
                "token_usage": {
                    "prompt_tokens": len(prompt_full) // 4,
                    "completion_tokens": len(json.dumps(data)) // 4,
                    "total_tokens": (len(prompt_full) + len(json.dumps(data))) // 4,
                },
            }
            return data, audit

        # 3. 真实模型调用
        if self.client is None:
            raise RuntimeError("LLM client not configured (missing MCL_API_KEY / MCL_BASE_URL) and no mock_handler provided.")

        mc = self.cfg.get("model", {})
        try:
            r = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=float(mc.get("temperature", {}).get("decision", 0.6)),
                max_tokens=int(mc.get("max_output_tokens", {}).get("decision", 2000)),
                response_format={"type": "json_object"},
            )
        except Exception as e:
            raise RuntimeError(f"CALL_FAILED: V9_STEP: {e}") from e

        raw = (r.choices[0].message.content or "").strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw).strip()

        try:
            data = json.loads(raw)
        except Exception as e:
            raise RuntimeError(f"CALL_FAILED: V9_STEP: invalid JSON response: {e}") from e

        # 4. Schema 校验
        jsonschema.validate(data, self.schema)

        u = r.usage
        usage = {
            "prompt_tokens": getattr(u, "prompt_tokens", 0) if u else 0,
            "completion_tokens": getattr(u, "completion_tokens", 0) if u else 0,
            "total_tokens": getattr(u, "total_tokens", 0) if u else 0,
        }

        audit = {
            "kind": "V9_STEP",
            "model": self.model_name,
            "prompt_hash": prompt_hash,
            "token_usage": usage,
        }
        return data, audit
