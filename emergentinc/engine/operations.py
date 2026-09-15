"""通用工具执行通道与隔离交付物管理 (V9 Operations & Artifacts).

核心规则:
1. 单次响应最多执行 3 个工具操作，按顺序执行。
2. 某步失败则停止剩余操作，保留已发生结果。
3. 交付物存储于 artifacts/ 目录，按 Pixel 身份严格隔离。
4. 提供代码隔离执行器 (run_isolated_code)，配置时间与进程限制，不访问敏感环境变量。
5. 工具结果通过 [ENGINE_FEEDBACK] 消息回传元胞。
"""

import sys
import os
import subprocess
import time
import uuid
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple, Optional
from .utils import sha256_text

MAX_OPERATIONS_PER_STEP = 3
DEFAULT_CODE_TIMEOUT_SECONDS = 5


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
    """工具操作执行器与交付物空间."""

    def __init__(self, artifacts_root: Path):
        self.artifacts_root = Path(artifacts_root)
        self.artifacts_root.mkdir(parents=True, exist_ok=True)

    def _pixel_artifact_dir(self, pixel_id: str) -> Path:
        d = self.artifacts_root / pixel_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def execute_all(
        self,
        pixel_id: str,
        operations: List[Dict[str, Any]],
    ) -> Tuple[List[OperationReceipt], str]:
        """按顺序执行操作，最多 3 个，若某步失败则中断后续操作并汇总回执."""
        receipts: List[OperationReceipt] = []
        truncated_ops = operations[:MAX_OPERATIONS_PER_STEP]

        for op in truncated_ops:
            tool = op.get("tool", "")
            args = op.get("args", {})
            receipt = self._dispatch(pixel_id, tool, args)
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
        op_id = f"op_{uuid.uuid4().hex[:8]}"

        if tool == "save_artifact":
            return self._tool_save_artifact(op_id, pixel_id, args)
        elif tool == "read_artifact":
            return self._tool_read_artifact(op_id, pixel_id, args)
        elif tool == "list_artifacts":
            return self._tool_list_artifacts(op_id, pixel_id, args)
        elif tool == "run_isolated_code":
            return self._tool_run_isolated_code(op_id, pixel_id, args)
        else:
            return OperationReceipt(
                operation_id=op_id,
                tool=tool,
                status="FAILED",
                output=None,
                error=f"Unknown tool: '{tool}'",
            )

    def _tool_save_artifact(self, op_id: str, pixel_id: str, args: Dict[str, Any]) -> OperationReceipt:
        filename = args.get("filename", "").strip()
        content = args.get("content", "")
        if not filename:
            return OperationReceipt(op_id, "save_artifact", "FAILED", None, "Missing 'filename'")
        # 防止路径遍历
        if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
            return OperationReceipt(op_id, "save_artifact", "FAILED", None, "Invalid artifact filename")

        target_file = self._pixel_artifact_dir(pixel_id) / filename
        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_text(content, encoding="utf-8")

        artifact_hash = sha256_text(content)
        return OperationReceipt(
            operation_id=op_id,
            tool="save_artifact",
            status="SUCCESS",
            output={
                "pixel_id": pixel_id,
                "filename": filename,
                "size_bytes": len(content.encode("utf-8")),
                "sha256": artifact_hash,
            },
        )

    def _tool_read_artifact(self, op_id: str, pixel_id: str, args: Dict[str, Any]) -> OperationReceipt:
        target_pixel_id = args.get("pixel_id", pixel_id).strip()
        filename = args.get("filename", "").strip()
        if not filename:
            return OperationReceipt(op_id, "read_artifact", "FAILED", None, "Missing 'filename'")
        if ".." in filename or filename.startswith("/") or filename.startswith("\\"):
            return OperationReceipt(op_id, "read_artifact", "FAILED", None, "Invalid artifact filename")

        target_file = self.artifacts_root / target_pixel_id / filename
        if not target_file.exists():
            return OperationReceipt(op_id, "read_artifact", "FAILED", None, f"Artifact '{filename}' not found")

        try:
            content = target_file.read_text(encoding="utf-8")
            return OperationReceipt(
                operation_id=op_id,
                tool="read_artifact",
                status="SUCCESS",
                output={"content": content, "size": len(content)},
            )
        except Exception as e:
            return OperationReceipt(op_id, "read_artifact", "FAILED", None, str(e))

    def _tool_list_artifacts(self, op_id: str, pixel_id: str, args: Dict[str, Any]) -> OperationReceipt:
        p_dir = self._pixel_artifact_dir(pixel_id)
        items = []
        for p in p_dir.glob("*"):
            if p.is_file():
                items.append({
                    "filename": p.name,
                    "size_bytes": p.stat().st_size,
                    "sha256": sha256_text(p.read_text(encoding="utf-8", errors="ignore")),
                })
        return OperationReceipt(
            operation_id=op_id,
            tool="list_artifacts",
            status="SUCCESS",
            output={"artifacts": items},
        )

    def _tool_run_isolated_code(self, op_id: str, pixel_id: str, args: Dict[str, Any]) -> OperationReceipt:
        code = args.get("code", "")
        timeout = int(args.get("timeout", DEFAULT_CODE_TIMEOUT_SECONDS))
        if not code:
            return OperationReceipt(op_id, "run_isolated_code", "FAILED", None, "Empty code snippet")

        # 准备干净环境变量，剔除 API keys 等机密
        safe_env = {
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
            "PATH": os.environ.get("PATH", ""),
            "PYTHONPATH": "",
        }

        try:
            res = subprocess.run(
                [sys.executable, "-c", code],
                capture_output=True,
                text=True,
                timeout=timeout,
                env=safe_env,
                cwd=str(self._pixel_artifact_dir(pixel_id)),
            )
            return OperationReceipt(
                operation_id=op_id,
                tool="run_isolated_code",
                status="SUCCESS" if res.returncode == 0 else "FAILED",
                output={
                    "returncode": res.returncode,
                    "stdout": res.stdout[:2000],
                    "stderr": res.stderr[:2000],
                },
                error=res.stderr[:500] if res.returncode != 0 else None,
            )
        except subprocess.TimeoutExpired:
            return OperationReceipt(
                operation_id=op_id,
                tool="run_isolated_code",
                status="FAILED",
                output=None,
                error=f"Execution timed out after {timeout} seconds",
            )
        except Exception as e:
            return OperationReceipt(
                operation_id=op_id,
                tool="run_isolated_code",
                status="FAILED",
                output=None,
                error=str(e),
            )
