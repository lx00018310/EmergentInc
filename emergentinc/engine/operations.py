"""通用工具执行通道与薄适配器 (V9 Operations Adapter).

核心规则:
1. 单次响应最多执行 3 个工具操作，按顺序执行。
2. 某步失败或结果未知则停止剩余操作，保留已发生结果。
3. 委托底层统一 ToolRegistry 分发执行，不写日益庞大的 if/else。
4. 支持传入 CoreStore 进行原子 STARTED/SUCCESS/FAILED/UNKNOWN 记录与重放去重。
5. 工具结果通过 [ENGINE_FEEDBACK] 消息回传元胞。
"""

import json
import uuid
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple, Optional, Callable

from emergentinc.tools.contracts import ToolContext, ToolResult
from emergentinc.tools.registry import ToolRegistry
from emergentinc.tools.registry_manifest import default_registry, create_default_registry
from emergentinc.tools.artifacts import is_valid_coord_id, validate_artifact_filename
from .utils import sha256_text

MAX_OPERATIONS_PER_STEP = 3


@dataclass
class OperationReceipt:
    operation_id: str
    tool: str
    status: str  # "SUCCESS" | "FAILED" | "UNKNOWN"
    output: Any
    error: Optional[str] = None
    cost_tokens: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "operation_id": self.operation_id,
            "tool": self.tool,
            "status": self.status,
            "output": self.output,
            "error": self.error,
            "cost_tokens": self.cost_tokens,
        }


class OperationExecutor:
    """薄适配器：委托统一工具注册表执行，并提供兼容既有调用的回执接口."""

    def __init__(
        self,
        artifacts_root: Path,
        registry: Optional[ToolRegistry] = None,
        private_root: Optional[Path] = None,
        workspace_root: Optional[Path] = None,
    ):
        self.artifacts_root = Path(artifacts_root).resolve()
        self.artifacts_root.mkdir(parents=True, exist_ok=True)
        self.workspace_root = Path(workspace_root).resolve() if workspace_root else self.artifacts_root.parent.parent
        self.private_root = Path(private_root).resolve() if private_root else (self.workspace_root / "private")

        if registry is not None:
            self.registry = registry
        elif self.private_root.exists():
            self.registry = create_default_registry(self.private_root)
        else:
            self.registry = default_registry

    def execute_all(
        self,
        pixel_id: str,
        operations: List[Dict[str, Any]],
        run_id: Optional[str] = None,
        message_id: Optional[str] = None,
        stop_requested: Optional[Callable[[], bool]] = None,
        core_store: Optional[Any] = None,
    ) -> Tuple[List[OperationReceipt], str]:
        """按顺序执行操作，最多 3 个，若某步失败则中断后续操作并汇总回执."""
        receipts: List[OperationReceipt] = []
        truncated_ops = operations[:MAX_OPERATIONS_PER_STEP]

        for idx, op in enumerate(truncated_ops):
            tool = op.get("tool", "")
            args = op.get("args", {})
            if not isinstance(args, dict):
                args = {}

            # 生成稳定 operation_id (若有 message_id 则基于 message_id + op_index 保证确定性)
            if message_id:
                op_id = f"op_{sha256_text(f'{message_id}_{idx}_{tool}')[:12]}"
            else:
                op_id = f"op_{uuid.uuid4().hex[:8]}"

            args_hash = sha256_text(json.dumps(args, sort_keys=True, ensure_ascii=False))

            receipt: Optional[OperationReceipt] = None

            # 若提供了 core_store，执行原子持久化与重放去重判定
            if core_store is not None and hasattr(core_store, "record_tool_started"):
                is_new, existing = core_store.record_tool_started(
                    operation_id=op_id,
                    run_id=run_id,
                    message_id=message_id or "direct",
                    pixel_id=pixel_id,
                    op_index=idx,
                    tool=tool,
                    args_hash=args_hash,
                )
                if not is_new and existing:
                    # 重放已有记录，不执行外部副作用
                    res_data = existing.get("result") or {}
                    receipt = OperationReceipt(
                        operation_id=op_id,
                        tool=tool,
                        status=existing.get("status", "UNKNOWN"),
                        output=res_data.get("output"),
                        error=res_data.get("error_message") or res_data.get("error"),
                    )

            if receipt is None:
                # 实际执行工具
                context = ToolContext(
                    workspace_root=self.workspace_root,
                    pixel_id=pixel_id,
                    run_id=run_id or "direct",
                    message_id=message_id or "direct",
                    operation_id=op_id,
                    stop_requested=stop_requested,
                    core_store=core_store,
                )

                tool_result: ToolResult = self.registry.execute(tool, args, context)

                # 落库终态记录
                if core_store is not None and hasattr(core_store, "record_tool_finished"):
                    core_store.record_tool_finished(
                        operation_id=op_id,
                        status=tool_result.status,
                        result=tool_result.to_dict(),
                    )

                err_msg = tool_result.error_message
                if tool_result.error_code:
                    if err_msg:
                        err_msg = f"{tool_result.error_code}: {err_msg}"
                    else:
                        err_msg = tool_result.error_code

                receipt = OperationReceipt(
                    operation_id=op_id,
                    tool=tool,
                    status=tool_result.status,
                    output=tool_result.output,
                    error=err_msg,
                )

            receipts.append(receipt)
            if receipt.status != "SUCCESS":
                break

        # 格式化为回执消息
        lines = ["[ENGINE_FEEDBACK]", "Operations Receipt:"]
        for r in receipts:
            lines.append(f"- Tool: {r.tool} | Status: {r.status}")
            if r.status == "SUCCESS":
                lines.append(f"  Result: {r.output}")
            else:
                lines.append(f"  Error: {r.error}")

        feedback_md = "\n".join(lines)
        return receipts, feedback_md

    def _dispatch(self, pixel_id: str, tool: str, args: Dict[str, Any]) -> OperationReceipt:
        """向后兼容的单操作分发接口."""
        receipts, _ = self.execute_all(pixel_id, [{"tool": tool, "args": args}])
        return receipts[0]
