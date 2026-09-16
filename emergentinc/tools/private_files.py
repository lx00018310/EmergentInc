"""私有文件与素材读取工具 (Private Files Tools).

支持:
- list_private_files: 安全分页列出 workspace/private 目录下的文件
- read_private_file: 安全分页读取私有文本文件，对已知凭据做严格脱敏投影保护
- inspect_private_image: 调用已配置的视觉模型真实观察分析私有图片内容
"""

import os
import re
import json
import base64
from pathlib import Path
from typing import Dict, Any, Tuple, Optional

from .contracts import ToolSpec, ToolContext, ToolResult

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
BINARY_EXTENSIONS = IMAGE_EXTENSIONS | {".pdf", ".zip", ".tar", ".gz", ".bin", ".ico"}

SENSITIVE_FILENAME_PATTERNS = [
    re.compile(r".*_profile\.json$", re.IGNORECASE),
    re.compile(r".*credential.*", re.IGNORECASE),
    re.compile(r".*secret.*", re.IGNORECASE),
    re.compile(r"^id_rsa.*", re.IGNORECASE),
    re.compile(r"^id_ed25519.*", re.IGNORECASE),
    re.compile(r"^id_dsa.*", re.IGNORECASE),
    re.compile(r"^id_ecdsa.*", re.IGNORECASE),
    re.compile(r".*\.pem$", re.IGNORECASE),
    re.compile(r".*\.key$", re.IGNORECASE),
    re.compile(r".*\.ppk$", re.IGNORECASE),
]

SENSITIVE_CONTENT_SNIPPETS = [
    b"-----BEGIN RSA PRIVATE KEY-----",
    b"-----BEGIN OPENSSH PRIVATE KEY-----",
    b"-----BEGIN PRIVATE KEY-----",
    b"-----BEGIN EC PRIVATE KEY-----",
    b"-----BEGIN DSA PRIVATE KEY-----",
    b"\"password\":",
    b"\"private_key_path\":",
    b"\"api_key\":",
]


def is_sensitive_credential_path(path: Path) -> bool:
    """判断指定文件是否属于敏感凭据/私钥/密钥文件."""
    name = path.name.lower()
    for pattern in SENSITIVE_FILENAME_PATTERNS:
        if pattern.match(name):
            return True

    # 尝试内容头部嗅探 (防御命名不规范的私钥/凭据文件)
    if path.exists() and path.is_file():
        try:
            size = path.stat().st_size
            if 0 < size <= 256 * 1024:
                header = path.read_bytes()[:2048]
                for snippet in SENSITIVE_CONTENT_SNIPPETS:
                    if snippet in header:
                        return True
        except Exception:
            pass

    return False


def resolve_private_path(private_root: Path, target_path_str: str) -> Tuple[bool, Optional[Path], Optional[str]]:
    """安全解析 private 目录下的文件路径，防御 Windows 盘符逃逸、大小写差异与符号链接越界."""
    if not target_path_str:
        return True, private_root.resolve(), None

    raw_path = Path(target_path_str)
    root_resolved = private_root.resolve()

    if raw_path.is_absolute():
        resolved = raw_path.resolve()
    else:
        resolved = (private_root / raw_path).resolve()

    # 严格检验前缀与目录包含关系
    try:
        resolved.relative_to(root_resolved)
        return True, resolved, None
    except ValueError:
        return False, None, "PATH_TRAVERSAL_FORBIDDEN: Target path must be strictly located within workspace/private."


def mask_sensitive_profile(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    """对 VPS profile 等敏感凭据配置做安全投影，绝不向模型回显明文密码或私钥."""
    return {
        "profile_id": "owner_vps",
        "type": profile_data.get("type", "vps"),
        "driver": profile_data.get("driver", "ssh"),
        "host": profile_data.get("host"),
        "port": profile_data.get("port", 22),
        "username": profile_data.get("username"),
        "has_password": bool(profile_data.get("password")),
        "has_private_key": bool(profile_data.get("private_key_path")),
        "allowed_operations": profile_data.get("allowed_operations", ["*"]),
        "public_metadata": profile_data.get("public_metadata", {}),
        "status": "CONFIGURED",
        "notice": "Credentials masked. Use tool 'vps_exec' or other vps tools with profile_id='owner_vps'.",
    }


def handle_list_private_files(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    path_arg = str(args.get("path", "")).strip()
    ok, target_path, err = resolve_private_path(context.private_root, path_arg)
    if not ok or target_path is None:
        return ToolResult(
            operation_id=context.operation_id,
            tool="list_private_files",
            status="FAILED",
            error_code="PATH_ACCESS_DENIED",
            error_message=err,
        )

    if not target_path.exists():
        return ToolResult(
            operation_id=context.operation_id,
            tool="list_private_files",
            status="FAILED",
            error_code="DIRECTORY_NOT_FOUND",
            error_message=f"Directory '{path_arg}' does not exist in workspace/private.",
        )

    if not target_path.is_dir():
        return ToolResult(
            operation_id=context.operation_id,
            tool="list_private_files",
            status="FAILED",
            error_code="NOT_A_DIRECTORY",
            error_message=f"Target path '{path_arg}' is a file, not a directory.",
        )

    offset = int(args.get("offset", 0))
    limit = int(args.get("limit", 50))

    try:
        items = []
        for p in sorted(target_path.iterdir()):
            rel_p = str(p.relative_to(context.private_root.resolve())).replace("\\", "/")
            is_file = p.is_file()
            items.append({
                "path": rel_p,
                "name": p.name,
                "type": "file" if is_file else "directory",
                "size_bytes": p.stat().st_size if is_file else 0,
            })

        total = len(items)
        sliced = items[offset:offset + limit]
        truncated = (offset + limit) < total

        return ToolResult(
            operation_id=context.operation_id,
            tool="list_private_files",
            status="SUCCESS",
            output={
                "base_path": str(target_path.relative_to(context.private_root.resolve())).replace("\\", "/"),
                "files": sliced,
                "offset": offset,
                "limit": limit,
                "total_count": total,
                "truncated": truncated,
            },
            truncated=truncated,
        )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="list_private_files",
            status="FAILED",
            error_code="LIST_ERROR",
            error_message=str(e),
        )


def handle_read_private_file(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    path_arg = str(args.get("path", "")).strip()
    if not path_arg:
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_private_file",
            status="FAILED",
            error_code="INVALID_ARGUMENTS",
            error_message="Missing required parameter 'path'.",
        )

    ok, target_path, err = resolve_private_path(context.private_root, path_arg)
    if not ok or target_path is None:
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_private_file",
            status="FAILED",
            error_code="PATH_ACCESS_DENIED",
            error_message=err,
        )

    if not target_path.exists() or not target_path.is_file():
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_private_file",
            status="FAILED",
            error_code="FILE_NOT_FOUND",
            error_message=f"File '{path_arg}' not found in workspace/private.",
        )

    # 1. 凭据文件安全拦截与脱敏投影
    if is_sensitive_credential_path(target_path):
        # 尝试作为 profile JSON 脱敏读取
        if target_path.suffix.lower() == ".json":
            try:
                raw_data = json.loads(target_path.read_text(encoding="utf-8"))
                masked = mask_sensitive_profile(raw_data)
                return ToolResult(
                    operation_id=context.operation_id,
                    tool="read_private_file",
                    status="SUCCESS",
                    output={
                        "type": "vps_profile",
                        "path": str(target_path.relative_to(context.private_root.resolve())).replace("\\", "/"),
                        "data": masked,
                    },
                )
            except Exception as e:
                return ToolResult(
                    operation_id=context.operation_id,
                    tool="read_private_file",
                    status="FAILED",
                    error_code="PROFILE_PARSE_ERROR",
                    error_message=f"Failed to parse vps profile: {str(e)}",
                )
        # 非 profile JSON (如 id_ed25519、id_rsa、.pem、.key 等私钥文件)，严禁读取明文内容
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_private_file",
            status="FAILED",
            error_code="CREDENTIAL_READ_BLOCKED",
            error_message=(
                f"Direct reading of credential or private key file '{target_path.name}' is strictly blocked for security. "
                "Credentials must only be consumed by configured authentication drivers."
            ),
        )

    # 2. 检查扩展名是否为二进制
    suffix = target_path.suffix.lower()
    if suffix in BINARY_EXTENSIONS:
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_private_file",
            status="SUCCESS",
            output={
                "type": "binary",
                "path": str(target_path.relative_to(context.private_root.resolve())).replace("\\", "/"),
                "size_bytes": target_path.stat().st_size,
                "message": "Binary or image file detected. Content cannot be read directly as text. Use inspect_private_image or vps_upload_file.",
            },
        )

    # 3. 正常文本读取 (分页与截断支持)
    try:
        content = target_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return ToolResult(
            operation_id=context.operation_id,
            tool="read_private_file",
            status="SUCCESS",
            output={
                "type": "binary",
                "path": str(target_path.relative_to(context.private_root.resolve())).replace("\\", "/"),
                "size_bytes": target_path.stat().st_size,
                "message": "File is not valid UTF-8 text.",
            },
        )

    offset = int(args.get("offset", 0))
    limit = int(args.get("limit", 4000))
    sliced = content[offset:offset + limit]
    truncated = (offset + limit) < len(content)

    return ToolResult(
        operation_id=context.operation_id,
        tool="read_private_file",
        status="SUCCESS",
        output={
            "type": "text",
            "path": str(target_path.relative_to(context.private_root.resolve())).replace("\\", "/"),
            "content": sliced,
            "offset": offset,
            "limit": limit,
            "total_chars": len(content),
            "truncated": truncated,
        },
        truncated=truncated,
    )


def handle_inspect_private_image(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    """真实调用多模态视觉模型解析 private 图片内容 (受预算硬约束控制)."""
    path_arg = str(args.get("path", "")).strip()
    question = str(args.get("question", "请详细描述这张图片的内容。")).strip()

    ok, target_path, err = resolve_private_path(context.private_root, path_arg)
    if not ok or target_path is None:
        return ToolResult(
            operation_id=context.operation_id,
            tool="inspect_private_image",
            status="FAILED",
            error_code="PATH_ACCESS_DENIED",
            error_message=err,
        )

    if not target_path.exists() or not target_path.is_file():
        return ToolResult(
            operation_id=context.operation_id,
            tool="inspect_private_image",
            status="FAILED",
            error_code="FILE_NOT_FOUND",
            error_message=f"Image file '{path_arg}' not found in workspace/private.",
        )

    if target_path.suffix.lower() not in IMAGE_EXTENSIONS:
        return ToolResult(
            operation_id=context.operation_id,
            tool="inspect_private_image",
            status="FAILED",
            error_code="INVALID_IMAGE_TYPE",
            error_message=f"File '{target_path.name}' is not a supported image format (supports {IMAGE_EXTENSIONS}).",
        )

    # 读取环境变量或配置中的视觉模型
    vision_model = (
        os.environ.get("MCL_VISION_MODEL")
        or os.environ.get("VISION_MODEL")
        or context.extra.get("vision_model")
    )
    api_key = os.environ.get("MCL_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("MCL_BASE_URL") or os.environ.get("OPENAI_BASE_URL")

    # 如果没有配置视觉模型，按规范明确返回未配置，不能虚构内容
    if not vision_model or not api_key:
        return ToolResult(
            operation_id=context.operation_id,
            tool="inspect_private_image",
            status="FAILED",
            error_code="VISION_MODEL_UNCONFIGURED",
            error_message="Vision model is not configured. Please set MCL_VISION_MODEL in .env to enable image content inspection.",
        )

    # 预算预留 (若 context 中有 core_store)
    call_id: Optional[str] = None
    estimated_tokens = 1500
    if context.core_store is not None and hasattr(context.core_store, "reserve_call_budget") and context.pixel_id:
        ok_res, cid, err_msg = context.core_store.reserve_call_budget(
            run_id=context.run_id,
            pixel_id=context.pixel_id,
            estimated_tokens=estimated_tokens,
        )
        if not ok_res:
            return ToolResult(
                operation_id=context.operation_id,
                tool="inspect_private_image",
                status="FAILED",
                error_code="BUDGET_EXCEEDED",
                error_message=f"Vision model call budget reserve failed: {err_msg}",
            )
        call_id = cid

    try:
        img_bytes = target_path.read_bytes()
        b64_data = base64.b64encode(img_bytes).decode("utf-8")
        mime = "image/jpeg" if target_path.suffix.lower() in (".jpg", ".jpeg") else "image/png"

        import httpx
        req_body = {
            "model": vision_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": question},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{b64_data}"},
                        },
                    ],
                }
            ],
            "max_tokens": 800,
        }

        url = f"{base_url.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json=req_body, headers=headers)
            if resp.status_code != 200:
                if context.core_store and call_id and hasattr(context.core_store, "settle_call_budget"):
                    try:
                        context.core_store.settle_call_budget(
                            call_id=call_id,
                            actual_tokens=0,
                            outcome="FAILED",
                            details={"error": resp.text[:200]},
                        )
                    except Exception:
                        pass
                return ToolResult(
                    operation_id=context.operation_id,
                    tool="inspect_private_image",
                    status="FAILED",
                    error_code="API_ERROR",
                    error_message=f"Vision model API responded with status {resp.status_code}: {resp.text[:300]}",
                )
            res_json = resp.json()
            description = res_json["choices"][0]["message"]["content"]
            usage = res_json.get("usage", {})
            actual_tokens = int(usage.get("total_tokens") or estimated_tokens)

            if context.core_store and call_id and hasattr(context.core_store, "settle_call_budget"):
                try:
                    context.core_store.settle_call_budget(
                        call_id=call_id,
                        actual_tokens=actual_tokens,
                        outcome="SUCCESS",
                        details={"model": vision_model, "image": str(target_path)},
                    )
                except Exception:
                    pass

            return ToolResult(
                operation_id=context.operation_id,
                tool="inspect_private_image",
                status="SUCCESS",
                output={
                    "image_path": str(target_path.relative_to(context.private_root.resolve())).replace("\\", "/"),
                    "question": question,
                    "description": description,
                    "tokens_used": actual_tokens,
                },
                details={"usage": usage, "model": vision_model},
            )
    except Exception as e:
        is_timeout_or_net = False
        try:
            import httpx
            if isinstance(e, (httpx.TimeoutException, httpx.NetworkError)):
                is_timeout_or_net = True
        except Exception:
            pass

        if is_timeout_or_net:
            if context.core_store and call_id and hasattr(context.core_store, "mark_call_unknown"):
                try:
                    context.core_store.mark_call_unknown(
                        call_id=call_id,
                        run_id=context.run_id,
                        pixel_id=context.pixel_id,
                        message_id=context.message_id or "direct",
                        error_msg=str(e),
                        model=vision_model,
                    )
                except Exception:
                    pass
            return ToolResult(
                operation_id=context.operation_id,
                tool="inspect_private_image",
                status="UNKNOWN",
                error_code="VISION_API_TIMEOUT",
                error_message=f"Vision model request timed out or network broken: {str(e)}",
            )

        if context.core_store and call_id and hasattr(context.core_store, "settle_call_budget"):
            try:
                context.core_store.settle_call_budget(
                    call_id=call_id,
                    actual_tokens=0,
                    outcome="FAILED",
                    details={"error": str(e)},
                )
            except Exception:
                pass

        return ToolResult(
            operation_id=context.operation_id,
            tool="inspect_private_image",
            status="FAILED",
            error_code="INSPECTION_FAILED",
            error_message=f"Failed to inspect image via vision model: {str(e)}",
        )


list_private_files_spec = ToolSpec(
    name="list_private_files",
    description="安全列出 workspace/private 私有目录中的文件及目录列表 (不包含文件内容)。",
    input_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "私有目录内的相对子路径，默认根目录"},
            "offset": {"type": "integer", "minimum": 0, "description": "分页偏移"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 100, "description": "返回数量上限"},
        },
        "additionalProperties": False,
    },
    handler=handle_list_private_files,
    effect="read",
)

read_private_file_spec = ToolSpec(
    name="read_private_file",
    description="安全读取 workspace/private 私有目录中的文本文件。对已知 VPS 凭据配置文件会自动脱敏投影，绝不回显密码或私钥。",
    input_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "私有文件路径"},
            "offset": {"type": "integer", "minimum": 0, "description": "字符起始偏移"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 8000, "description": "读取字符上限"},
        },
        "required": ["path"],
        "additionalProperties": False,
    },
    handler=handle_read_private_file,
    effect="read",
)

inspect_private_image_spec = ToolSpec(
    name="inspect_private_image",
    description="调用视觉多模态模型观察并理解 workspace/private 目录中的图片文件，返回实际分析文本。",
    input_schema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "私有图片文件路径 (jpg, png, webp 等)"},
            "question": {"type": "string", "description": "针对该图片的问题或观察要求"},
        },
        "required": ["path"],
        "additionalProperties": False,
    },
    handler=handle_inspect_private_image,
    effect="read",
)
