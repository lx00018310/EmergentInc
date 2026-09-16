"""统一工具契约模型 (Tool Contracts).

定义工具描述规范 (ToolSpec)、执行上下文 (ToolContext) 与执行结果 (ToolResult).
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, Any, Optional, Literal


@dataclass
class ToolContext:
    """工具调用的受保护上下文 (由引擎安全注入，模型无法篡改)."""

    workspace_root: Path
    pixel_id: str
    run_id: str
    message_id: str
    operation_id: str
    stop_requested: Optional[Callable[[], bool]] = None
    core_store: Optional[Any] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def live_root(self) -> Path:
        return self.workspace_root / "live"

    @property
    def artifacts_root(self) -> Path:
        return self.workspace_root / "live" / "artifacts"

    @property
    def private_root(self) -> Path:
        return self.workspace_root / "private"


@dataclass
class ToolResult:
    """结构化工具执行结果回执."""

    operation_id: str
    tool: str
    status: Literal["SUCCESS", "FAILED", "UNKNOWN"]
    output: Any = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    duration_ms: float = 0.0
    truncated: bool = False
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "operation_id": self.operation_id,
            "tool": self.tool,
            "status": self.status,
            "output": self.output,
            "duration_ms": round(self.duration_ms, 2),
            "truncated": self.truncated,
        }
        if self.error_code:
            d["error_code"] = self.error_code
        if self.error_message:
            d["error_message"] = self.error_message
        if self.details:
            d["details"] = self.details
        return d


@dataclass
class ToolSpec:
    """工具注册规范定义."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    handler: Callable[[Dict[str, Any], ToolContext], ToolResult]
    effect: Literal["read", "write"] = "read"
    timeout_seconds: float = 30.0
    enabled: bool = True
