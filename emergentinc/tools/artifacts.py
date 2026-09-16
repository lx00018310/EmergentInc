"""元胞本地隔离交付物工具 (Artifact Tools).

包含:
- save_artifact: 写入当前元胞空间下的文本交付物
- read_artifact: 读取当前元胞空间下的交付物 (文本内容或二进制描述)
- list_artifacts: 列出当前元胞空间下的所有交付物
"""

import re
from pathlib import Path
from typing import Dict, Any, Tuple, Optional

from .contracts import ToolSpec, ToolContext, ToolResult
from emergentinc.engine.utils import sha256_text

COORD_ID_PATTERN = re.compile(r"^-?\d+_-?\d+_-?\d+$")
BINARY_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".bin", ".tar", ".gz", ".zip", ".pdf"}


def is_valid_coord_id(pixel_id: str) -> bool:
    """验证 pixel_id 是否符合 3D 坐标规范."""
    if not isinstance(pixel_id, str):
        return False
    return bool(COORD_ID_PATTERN.match(pixel_id.strip()))


def validate_artifact_filename(filename: str) -> Tuple[bool, Optional[str]]:
    """严格校验 artifact 文件名，防范目录穿越、盘符逃逸与 Windows ADS 流."""
    if not filename or not isinstance(filename, str):
        return False, "Missing or invalid 'filename'"
    name = filename.strip()
    if ".." in name or "/" in name or "\\" in name or ":" in name:
        return False, "Invalid artifact filename: directory traversal or path separators forbidden"
    forbidden_chars = set('<>"/\\|?*:\0')
    if any(c in forbidden_chars for c in name):
        return False, "Invalid artifact filename: forbidden characters detected"
    return True, None


def get_pixel_artifacts_dir(artifacts_root: Path, pixel_id: str) -> Path:
    """安全解析当前元胞交付物目录."""
    if not is_valid_coord_id(pixel_id):
        raise ValueError(f"Invalid pixel_id format: '{pixel_id}'")
    d = (artifacts_root / pixel_id).resolve()
    if not str(d).startswith(str(artifacts_root.resolve())):
        raise ValueError(f"Path escape detected for pixel_id: '{pixel_id}'")
    d.mkdir(parents=True, exist_ok=True)
    return d


def handle_save_artifact(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    pixel_id = context.pixel_id
    if not is_valid_coord_id(pixel_id):
        return ToolResult(
            operation_id=context.operation_id,
            tool="save_artifact",
            status="FAILED",
            error_code="INVALID_PIXEL_ID",
            error_message=f"Invalid pixel_id format: '{pixel_id}'",
        )

    filename = str(args.get("filename", "")).strip()
    content = str(args.get("content", ""))
    ok, err = validate_artifact_filename(filename)
    if not ok:
        return ToolResult(
            operation_id=context.operation_id,
            tool="save_artifact",
            status="FAILED",
            error_code="INVALID_FILENAME",
            error_message=err,
        )

    try:
        p_dir = get_pixel_artifacts_dir(context.artifacts_root, pixel_id)
        target_file = (p_dir / filename).resolve()
        if not str(target_file).startswith(str(p_dir.resolve())):
            return ToolResult(
                operation_id=context.operation_id,
                tool="save_artifact",
                status="FAILED",
                error_code="PATH_ESCAPE",
                error_message="Path traversal escape detected",
            )

        target_file.parent.mkdir(parents=True, exist_ok=True)
        target_file.write_text(content, encoding="utf-8")

        artifact_hash = sha256_text(content)
        return ToolResult(
            operation_id=context.operation_id,
            tool="save_artifact",
            status="SUCCESS",
            output={
                "pixel_id": pixel_id,
                "filename": filename,
                "size_bytes": len(content.encode("utf-8")),
                "sha256": artifact_hash,
            },
        )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="save_artifact",
            status="FAILED",
            error_code="WRITE_ERROR",
            error_message=str(e),
        )


def handle_read_artifact(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    pixel_id = context.pixel_id
    if not is_valid_coord_id(pixel_id):
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_artifact",
            status="FAILED",
            error_code="INVALID_PIXEL_ID",
            error_message=f"Invalid pixel_id format: '{pixel_id}'",
        )

    target_pixel_id = str(args.get("pixel_id", pixel_id)).strip()
    if target_pixel_id != pixel_id:
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_artifact",
            status="FAILED",
            error_code="CROSS_PIXEL_FORBIDDEN",
            error_message="CROSS_PIXEL_READ_FORBIDDEN: Cross-pixel artifact reading is strictly disabled.",
        )

    filename = str(args.get("filename", "")).strip()
    ok, err = validate_artifact_filename(filename)
    if not ok:
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_artifact",
            status="FAILED",
            error_code="INVALID_FILENAME",
            error_message=err,
        )

    try:
        p_dir = get_pixel_artifacts_dir(context.artifacts_root, pixel_id)
        target_file = (p_dir / filename).resolve()
        if not str(target_file).startswith(str(p_dir.resolve())):
            return ToolResult(
                operation_id=context.operation_id,
                tool="read_artifact",
                status="FAILED",
                error_code="PATH_ESCAPE",
                error_message="Path traversal escape detected",
            )

        if not target_file.exists() or not target_file.is_file():
            return ToolResult(
                operation_id=context.operation_id,
                tool="read_artifact",
                status="FAILED",
                error_code="FILE_NOT_FOUND",
                error_message=f"Artifact '{filename}' not found",
            )

        # 区分二进制与文本
        suffix = target_file.suffix.lower()
        if suffix in BINARY_EXTENSIONS:
            return ToolResult(
                operation_id=context.operation_id,
                tool="read_artifact",
                status="SUCCESS",
                output={
                    "type": "binary",
                    "filename": filename,
                    "size_bytes": target_file.stat().st_size,
                    "message": "Binary artifact detected. Content cannot be read directly as text. Use inspect_private_image or download via UI.",
                },
            )

        try:
            content = target_file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return ToolResult(
                operation_id=context.operation_id,
                tool="read_artifact",
                status="SUCCESS",
                output={
                    "type": "binary",
                    "filename": filename,
                    "size_bytes": target_file.stat().st_size,
                    "message": "Binary or non-UTF8 artifact detected. Cannot be read as text.",
                },
            )

        offset = int(args.get("offset", 0))
        limit = int(args.get("limit", 4000))
        sliced = content[offset:offset + limit]
        truncated = (offset + limit) < len(content)

        return ToolResult(
            operation_id=context.operation_id,
            tool="read_artifact",
            status="SUCCESS",
            output={
                "type": "text",
                "filename": filename,
                "content": sliced,
                "offset": offset,
                "limit": limit,
                "total_size": len(content),
                "truncated": truncated,
            },
            truncated=truncated,
        )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_artifact",
            status="FAILED",
            error_code="READ_ERROR",
            error_message=str(e),
        )


def handle_list_artifacts(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    pixel_id = context.pixel_id
    if not is_valid_coord_id(pixel_id):
        return ToolResult(
            operation_id=context.operation_id,
            tool="list_artifacts",
            status="FAILED",
            error_code="INVALID_PIXEL_ID",
            error_message=f"Invalid pixel_id format: '{pixel_id}'",
        )

    try:
        p_dir = get_pixel_artifacts_dir(context.artifacts_root, pixel_id)
        items = []
        for p in sorted(p_dir.glob("*")):
            if p.is_file():
                items.append({
                    "filename": p.name,
                    "size_bytes": p.stat().st_size,
                })
        return ToolResult(
            operation_id=context.operation_id,
            tool="list_artifacts",
            status="SUCCESS",
            output={"artifacts": items, "total_count": len(items)},
        )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="list_artifacts",
            status="FAILED",
            error_code="LIST_ERROR",
            error_message=str(e),
        )


save_artifact_spec = ToolSpec(
    name="save_artifact",
    description="在当前元胞的隔离交付物空间中保存一个文本文件 (覆盖或创建)。",
    input_schema={
        "type": "object",
        "properties": {
            "filename": {"type": "string", "description": "交付物文件名，禁止路径分隔符或 .."},
            "content": {"type": "string", "description": "要保存的文本内容"},
        },
        "required": ["filename", "content"],
        "additionalProperties": False,
    },
    handler=handle_save_artifact,
    effect="write",
)

read_artifact_spec = ToolSpec(
    name="read_artifact",
    description="读取当前元胞隔离空间中的交付物文件。文本文件返回文本片段，二进制文件返回类型与大小信息。",
    input_schema={
        "type": "object",
        "properties": {
            "filename": {"type": "string", "description": "文件名"},
            "pixel_id": {"type": "string", "description": "当前元胞标识 (跨元胞读取将被严格拒绝)"},
            "offset": {"type": "integer", "minimum": 0, "description": "读取起始字符偏移"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 8000, "description": "读取字符上限"},
        },
        "required": ["filename"],
        "additionalProperties": False,
    },
    handler=handle_read_artifact,
    effect="read",
)

list_artifacts_spec = ToolSpec(
    name="list_artifacts",
    description="列出当前元胞隔离交付物空间中的所有文件列表。",
    input_schema={
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
    handler=handle_list_artifacts,
    effect="read",
)
