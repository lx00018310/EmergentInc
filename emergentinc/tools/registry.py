"""统一工具注册中心 (Tool Registry).

负责工具规范的集中注册、重复校验、参数 Schema 校验、Prompt 目录渲染与安全调度.
"""

import time
import json
from typing import Dict, Any, List, Optional, Tuple
import jsonschema

from .contracts import ToolSpec, ToolContext, ToolResult


class ToolRegistry:
    """集中式工具注册与分发管理器."""

    def __init__(self):
        self._specs: Dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec, overwrite: bool = False) -> None:
        """注册一个工具规范。默认不允许重复注册同名工具."""
        if not spec.name or not isinstance(spec.name, str):
            raise ValueError("Tool name must be a non-empty string")
        if spec.name in self._specs and not overwrite:
            raise ValueError(f"Duplicate tool registration: '{spec.name}' is already registered")
        self._specs[spec.name] = spec

    def unregister(self, name: str) -> Optional[ToolSpec]:
        """注销工具."""
        return self._specs.pop(name, None)

    def get(self, name: str) -> Optional[ToolSpec]:
        """获取指定工具规范."""
        return self._specs.get(name)

    def list_specs(self, enabled_only: bool = True) -> List[ToolSpec]:
        """列出所有工具规范."""
        specs = list(self._specs.values())
        if enabled_only:
            specs = [s for s in specs if s.enabled]
        return sorted(specs, key=lambda s: s.name)

    def validate_args(self, spec: ToolSpec, args: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """依据 ToolSpec 的 JSON Schema 严格校验输入参数."""
        schema = spec.input_schema or {"type": "object"}
        try:
            jsonschema.validate(instance=args, schema=schema)
            return True, None
        except jsonschema.ValidationError as e:
            return False, f"Argument validation error: {e.message}"
        except Exception as e:
            return False, f"Schema validation failed: {str(e)}"

    def execute(self, tool_name: str, args: Dict[str, Any], context: ToolContext) -> ToolResult:
        """分发执行工具，包含参数校验、超时管理与耗时统计."""
        spec = self.get(tool_name)
        if not spec:
            return ToolResult(
                operation_id=context.operation_id,
                tool=tool_name,
                status="FAILED",
                error_code="CAPABILITY_UNAVAILABLE",
                error_message=f"Tool '{tool_name}' is not registered or unavailable.",
            )

        if not spec.enabled:
            return ToolResult(
                operation_id=context.operation_id,
                tool=tool_name,
                status="FAILED",
                error_code="TOOL_DISABLED",
                error_message=f"Tool '{tool_name}' is currently disabled in configuration.",
            )

        # 参数校验
        valid, err_msg = self.validate_args(spec, args)
        if not valid:
            return ToolResult(
                operation_id=context.operation_id,
                tool=tool_name,
                status="FAILED",
                error_code="INVALID_ARGUMENTS",
                error_message=err_msg,
            )

        # 检查停止信号
        if context.stop_requested and context.stop_requested():
            return ToolResult(
                operation_id=context.operation_id,
                tool=tool_name,
                status="FAILED",
                error_code="USER_STOPPED",
                error_message="Execution stopped by user request before running tool.",
            )

        start_time = time.time()
        try:
            result = spec.handler(args, context)
            duration_ms = (time.time() - start_time) * 1000.0
            result.duration_ms = duration_ms
            return result
        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000.0
            return ToolResult(
                operation_id=context.operation_id,
                tool=tool_name,
                status="FAILED",
                error_code="TOOL_EXECUTION_ERROR",
                error_message=f"Unexpected error executing tool '{tool_name}': {str(e)}",
                duration_ms=duration_ms,
            )

    def render_catalog_for_prompt(self) -> str:
        """为模型生成简洁、无歧义的工具目录说明与参数契约."""
        lines = [
            "### [TOOLS_CATALOG]",
            "你可以通过 operations 数组调用以下受控工具 (每次最多 3 项，按序执行)。",
            "工具调用格式: `{\"operations\": [{\"tool\": \"<tool_name>\", \"args\": { ... }}]}`",
            "",
        ]
        specs = self.list_specs(enabled_only=True)
        if not specs:
            lines.append("当前无可用工具。")
            return "\n".join(lines)

        for s in specs:
            schema_str = json.dumps(s.input_schema, ensure_ascii=False)
            lines.append(f"- **`{s.name}`** ({s.effect}): {s.description}")
            lines.append(f"  - 参数规范 (JSON Schema): `{schema_str}`")

        return "\n".join(lines)
