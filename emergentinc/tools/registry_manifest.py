"""统一工具注册入口与装配清单 (Registry Manifest).

显式装配所有内置工具规范并提供配置同步能力.
"""

import json
import copy
from pathlib import Path
from typing import Optional, Dict, Any

from .contracts import ToolSpec
from .registry import ToolRegistry
from .artifacts import save_artifact_spec, read_artifact_spec, list_artifacts_spec
from .private_files import list_private_files_spec, read_private_file_spec, inspect_private_image_spec
from .vps import (
    vps_exec_spec,
    vps_list_files_spec,
    vps_read_file_spec,
    vps_write_file_spec,
    vps_upload_file_spec,
    vps_download_file_spec,
)

# 基础内置工具列表
BUILTIN_SPECS = [
    save_artifact_spec,
    read_artifact_spec,
    list_artifacts_spec,
    list_private_files_spec,
    read_private_file_spec,
    inspect_private_image_spec,
    vps_exec_spec,
    vps_list_files_spec,
    vps_read_file_spec,
    vps_write_file_spec,
    vps_upload_file_spec,
    vps_download_file_spec,
]


def load_or_init_tools_config(private_root: Path) -> Dict[str, Any]:
    """读取或初始化 workspace/private/tools.json 配置文件."""
    config_file = private_root / "tools.json"
    default_config: Dict[str, Any] = {
        "tools": {spec.name: {"enabled": spec.enabled, "timeout_seconds": spec.timeout_seconds} for spec in BUILTIN_SPECS}
    }

    if not config_file.exists():
        try:
            config_file.parent.mkdir(parents=True, exist_ok=True)
            config_file.write_text(json.dumps(default_config, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
        return default_config

    try:
        user_config = json.loads(config_file.read_text(encoding="utf-8"))
        if not isinstance(user_config, dict):
            raise ValueError(f"Invalid tools.json format: expected a JSON object, got {type(user_config).__name__}")

        # 合并缺项，保留用户自定义配置
        tools_map = user_config.setdefault("tools", {})
        dirty = False
        for spec in BUILTIN_SPECS:
            if spec.name not in tools_map:
                tools_map[spec.name] = {"enabled": spec.enabled, "timeout_seconds": spec.timeout_seconds}
                dirty = True

        if dirty:
            try:
                config_file.write_text(json.dumps(user_config, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass

        return user_config
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse tools.json as valid JSON: {str(e)}")


def create_default_registry(private_root: Optional[Path] = None) -> ToolRegistry:
    """创建并装配默认的工具注册表."""
    registry = ToolRegistry()

    # 读取工具配置
    config_map: Dict[str, Any] = {}
    if private_root and private_root.exists():
        try:
            full_config = load_or_init_tools_config(private_root)
            config_map = full_config.get("tools", {})
        except Exception as e:
            # 格式错误明确报错，不静默重置
            raise RuntimeError(f"Tools configuration error in '{private_root / 'tools.json'}': {str(e)}")

    for base_spec in BUILTIN_SPECS:
        # 深拷贝以防实例间状态污染
        spec = copy.copy(base_spec)
        tool_cfg = config_map.get(spec.name)
        if isinstance(tool_cfg, dict):
            if "enabled" in tool_cfg:
                spec.enabled = bool(tool_cfg["enabled"])
            if "timeout_seconds" in tool_cfg:
                spec.timeout_seconds = float(tool_cfg["timeout_seconds"])

        registry.register(spec)

    return registry


# 默认单例注册表 (无 private_root 路径时采用纯内置默认值)
default_registry = create_default_registry()
