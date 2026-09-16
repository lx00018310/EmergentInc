"""VPS 远程管理与运维工具集 (VPS Tools).

基于 Paramiko 实现完整的 SSH 执行与 SFTP 文件管理:
- vps_exec: 远程执行非交互命令 (捕获 stdout/stderr/exit_code)
- vps_list_files: 远程目录列举
- vps_read_file: 远程文本读取
- vps_write_file: 远程文本写入 (默认不覆盖)
- vps_upload_file: 本地交付物/私有文件上传到 VPS (支持二进制/图片)
- vps_download_file: 从 VPS 下载文件到当前元胞交付物目录
"""

import os
import json
import time
from pathlib import Path
from contextlib import contextmanager
from typing import Dict, Any, Tuple, Optional, Generator

import paramiko
from .contracts import ToolSpec, ToolContext, ToolResult
from .artifacts import validate_artifact_filename, get_pixel_artifacts_dir
from .private_files import resolve_private_path


def load_vps_profile(private_root: Path, profile_id: str) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """读取指定 profile 配置 (默认 owner_vps_profile.json)."""
    pid = profile_id.strip() if profile_id else "owner_vps"
    # 支持 profile_id="owner_vps" 映射到 owner_vps_profile.json
    candidates = [
        private_root / f"{pid}_profile.json",
        private_root / f"{pid}.json",
    ]
    if pid == "owner_vps":
        candidates.insert(0, private_root / "owner_vps_profile.json")

    target_file = None
    for c in candidates:
        if c.exists() and c.is_file():
            target_file = c
            break

    if not target_file:
        return False, None, f"VPS profile '{pid}' not found in workspace/private."

    try:
        data = json.loads(target_file.read_text(encoding="utf-8"))
        return True, data, None
    except Exception as e:
        return False, None, f"Failed to parse profile '{target_file.name}': {str(e)}"


@contextmanager
def get_ssh_client(
    context: ToolContext,
    profile_id: str,
    connect_timeout: float = 10.0,
) -> Generator[Tuple[paramiko.SSHClient, Optional[paramiko.SFTPClient]], None, None]:
    """创建并管理 Paramiko SSHClient 及 SFTPClient 连接上下文."""
    ok, profile, err = load_vps_profile(context.private_root, profile_id)
    if not ok or profile is None:
        raise ValueError(err)

    host = profile.get("host")
    port = int(profile.get("port", 22))
    username = profile.get("username")
    password = profile.get("password")
    key_path_str = profile.get("private_key_path")

    if not host or not username:
        raise ValueError(f"Profile '{profile_id}' missing required 'host' or 'username'.")

    ssh = paramiko.SSHClient()
    known_hosts_file = context.private_root / "known_hosts"
    if known_hosts_file.exists():
        try:
            ssh.load_host_keys(str(known_hosts_file))
        except Exception:
            pass
    # 策略：缺少指纹时自动添加并落盘，指纹冲突时报错
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    # 认证方式解析
    pkey = None
    if key_path_str:
        key_path = (context.private_root / key_path_str).resolve()
        if key_path.exists() and key_path.is_file():
            try:
                pkey = paramiko.RSAKey.from_private_key_file(str(key_path))
            except Exception:
                try:
                    pkey = paramiko.Ed25519Key.from_private_key_file(str(key_path))
                except Exception:
                    pass

    try:
        ssh.connect(
            hostname=host,
            port=port,
            username=username,
            password=password if not pkey else None,
            pkey=pkey,
            timeout=connect_timeout,
            banner_timeout=15.0,
            auth_timeout=15.0,
            look_for_keys=False,
            allow_agent=False,
        )
        # 保存 host keys
        try:
            ssh.save_host_keys(str(known_hosts_file))
        except Exception:
            pass

        sftp = None
        try:
            sftp = ssh.open_sftp()
        except Exception:
            pass

        yield ssh, sftp
    finally:
        try:
            if sftp:
                sftp.close()
        except Exception:
            pass
        try:
            ssh.close()
        except Exception:
            pass


def handle_vps_exec(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    profile_id = str(args.get("profile_id", "owner_vps")).strip()
    command = str(args.get("command", "")).strip()
    if not command:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_exec",
            status="FAILED",
            error_code="INVALID_ARGUMENTS",
            error_message="Missing required parameter 'command'.",
        )

    cwd = args.get("cwd")
    if cwd:
        command = f"cd {cwd} && {command}"

    timeout_sec = min(float(args.get("timeout_seconds", 60.0)), 600.0)

    try:
        with get_ssh_client(context, profile_id, connect_timeout=10.0) as (ssh, _):
            # 检查停止信号
            if context.stop_requested and context.stop_requested():
                return ToolResult(
                    operation_id=context.operation_id,
                    tool="vps_exec",
                    status="FAILED",
                    error_code="USER_STOPPED",
                    error_message="User requested stop before command execution.",
                )

            stdin, stdout, stderr = ssh.exec_command(command, timeout=timeout_sec, get_pty=False)
            exit_code = stdout.channel.recv_exit_status()
            out_str = stdout.read().decode("utf-8", errors="replace")
            err_str = stderr.read().decode("utf-8", errors="replace")

            # 限制返回长度
            max_len = 8000
            truncated = len(out_str) > max_len or len(err_str) > max_len

            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_exec",
                status="SUCCESS" if exit_code == 0 else "FAILED",
                error_code=None if exit_code == 0 else f"COMMAND_EXIT_{exit_code}",
                error_message=None if exit_code == 0 else f"Command exited with non-zero code {exit_code}",
                output={
                    "profile_id": profile_id,
                    "command": command,
                    "exit_code": exit_code,
                    "stdout": out_str[:max_len],
                    "stderr": err_str[:max_len],
                    "truncated": truncated,
                },
                truncated=truncated,
            )
    except paramiko.AuthenticationException:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_exec",
            status="FAILED",
            error_code="AUTHENTICATION_FAILED",
            error_message=f"SSH authentication failed for profile '{profile_id}'. Please check credentials.",
        )
    except TimeoutError:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_exec",
            status="FAILED",
            error_code="TIMEOUT",
            error_message=f"Command execution timed out after {timeout_sec} seconds.",
        )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_exec",
            status="FAILED",
            error_code="EXEC_ERROR",
            error_message=f"VPS connection or execution error: {str(e)}",
        )


def handle_vps_list_files(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    profile_id = str(args.get("profile_id", "owner_vps")).strip()
    remote_path = str(args.get("path", ".")).strip() or "."
    offset = int(args.get("offset", 0))
    limit = int(args.get("limit", 100))

    try:
        with get_ssh_client(context, profile_id) as (_, sftp):
            if not sftp:
                return ToolResult(
                    operation_id=context.operation_id,
                    tool="vps_list_files",
                    status="FAILED",
                    error_code="SFTP_UNAVAILABLE",
                    error_message="SFTP subsystem could not be opened on remote host.",
                )

            file_attrs = sftp.listdir_attr(remote_path)
            items = []
            for attr in sorted(file_attrs, key=lambda x: x.filename):
                is_dir = (attr.st_mode & 0o040000) != 0
                items.append({
                    "name": attr.filename,
                    "type": "directory" if is_dir else "file",
                    "size_bytes": attr.st_size if not is_dir else 0,
                    "mtime": attr.st_mtime,
                })

            total = len(items)
            sliced = items[offset:offset + limit]
            truncated = (offset + limit) < total

            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_list_files",
                status="SUCCESS",
                output={
                    "remote_path": remote_path,
                    "files": sliced,
                    "total_count": total,
                    "offset": offset,
                    "limit": limit,
                    "truncated": truncated,
                },
                truncated=truncated,
            )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_list_files",
            status="FAILED",
            error_code="SFTP_LIST_ERROR",
            error_message=f"Failed to list remote directory '{remote_path}': {str(e)}",
        )


def handle_vps_read_file(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    profile_id = str(args.get("profile_id", "owner_vps")).strip()
    remote_path = str(args.get("path", "")).strip()
    if not remote_path:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_read_file",
            status="FAILED",
            error_code="INVALID_ARGUMENTS",
            error_message="Missing required parameter 'path'.",
        )

    offset = int(args.get("offset", 0))
    limit = int(args.get("limit", 4000))

    try:
        with get_ssh_client(context, profile_id) as (_, sftp):
            if not sftp:
                raise RuntimeError("SFTP client not available")

            with sftp.open(remote_path, "r") as rf:
                raw_data = rf.read()

            try:
                content = raw_data.decode("utf-8")
                sliced = content[offset:offset + limit]
                truncated = (offset + limit) < len(content)
                return ToolResult(
                    operation_id=context.operation_id,
                    tool="vps_read_file",
                    status="SUCCESS",
                    output={
                        "remote_path": remote_path,
                        "type": "text",
                        "content": sliced,
                        "total_chars": len(content),
                        "offset": offset,
                        "limit": limit,
                        "truncated": truncated,
                    },
                    truncated=truncated,
                )
            except UnicodeDecodeError:
                return ToolResult(
                    operation_id=context.operation_id,
                    tool="vps_read_file",
                    status="SUCCESS",
                    output={
                        "remote_path": remote_path,
                        "type": "binary",
                        "size_bytes": len(raw_data),
                        "message": "Remote file is binary. Use vps_download_file to download it to local artifacts.",
                    },
                )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_read_file",
            status="FAILED",
            error_code="SFTP_READ_ERROR",
            error_message=f"Failed to read remote file '{remote_path}': {str(e)}",
        )


def handle_vps_write_file(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    profile_id = str(args.get("profile_id", "owner_vps")).strip()
    remote_path = str(args.get("path", "")).strip()
    content = str(args.get("content", ""))
    overwrite = bool(args.get("overwrite", False))

    if not remote_path:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_write_file",
            status="FAILED",
            error_code="INVALID_ARGUMENTS",
            error_message="Missing required parameter 'path'.",
        )

    try:
        with get_ssh_client(context, profile_id) as (_, sftp):
            if not sftp:
                raise RuntimeError("SFTP client not available")

            # 默认不覆盖检查
            if not overwrite:
                try:
                    sftp.stat(remote_path)
                    return ToolResult(
                        operation_id=context.operation_id,
                        tool="vps_write_file",
                        status="FAILED",
                        error_code="FILE_ALREADY_EXISTS",
                        error_message=f"Remote file '{remote_path}' already exists and overwrite is False.",
                    )
                except FileNotFoundError:
                    pass

            with sftp.open(remote_path, "w") as wf:
                wf.write(content.encode("utf-8"))

            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_write_file",
                status="SUCCESS",
                output={
                    "remote_path": remote_path,
                    "bytes_written": len(content.encode("utf-8")),
                    "status": "WRITTEN",
                },
            )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_write_file",
            status="FAILED",
            error_code="SFTP_WRITE_ERROR",
            error_message=f"Failed to write remote file '{remote_path}': {str(e)}",
        )


def handle_vps_upload_file(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    profile_id = str(args.get("profile_id", "owner_vps")).strip()
    source_kind = str(args.get("source_kind", "artifact")).strip()
    source_path = str(args.get("source_path", "")).strip()
    remote_path = str(args.get("remote_path", "")).strip()
    overwrite = bool(args.get("overwrite", False))

    if not source_path or not remote_path:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_upload_file",
            status="FAILED",
            error_code="INVALID_ARGUMENTS",
            error_message="Both 'source_path' and 'remote_path' are required.",
        )

    # 安全解析本地源文件
    local_file: Optional[Path] = None
    if source_kind == "artifact":
        p_dir = get_pixel_artifacts_dir(context.artifacts_root, context.pixel_id)
        candidate = (p_dir / source_path).resolve()
        if not str(candidate).startswith(str(p_dir.resolve())):
            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_upload_file",
                status="FAILED",
                error_code="PATH_ESCAPE",
                error_message="Artifact path escape detected",
            )
        local_file = candidate
    elif source_kind == "private":
        ok, res_p, err = resolve_private_path(context.private_root, source_path)
        if not ok or res_p is None:
            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_upload_file",
                status="FAILED",
                error_code="PATH_ACCESS_DENIED",
                error_message=err,
            )
        local_file = res_p
    else:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_upload_file",
            status="FAILED",
            error_code="INVALID_SOURCE_KIND",
            error_message="source_kind must be either 'artifact' or 'private'.",
        )

    if not local_file.exists() or not local_file.is_file():
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_upload_file",
            status="FAILED",
            error_code="SOURCE_FILE_NOT_FOUND",
            error_message=f"Local source file '{source_path}' does not exist.",
        )

    try:
        with get_ssh_client(context, profile_id) as (_, sftp):
            if not sftp:
                raise RuntimeError("SFTP client not available")

            if not overwrite:
                try:
                    sftp.stat(remote_path)
                    return ToolResult(
                        operation_id=context.operation_id,
                        tool="vps_upload_file",
                        status="FAILED",
                        error_code="FILE_ALREADY_EXISTS",
                        error_message=f"Remote file '{remote_path}' exists and overwrite is False.",
                    )
                except FileNotFoundError:
                    pass

            sftp.put(str(local_file), remote_path)
            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_upload_file",
                status="SUCCESS",
                output={
                    "source_kind": source_kind,
                    "source_path": source_path,
                    "remote_path": remote_path,
                    "size_bytes": local_file.stat().st_size,
                    "status": "UPLOADED",
                },
            )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_upload_file",
            status="FAILED",
            error_code="SFTP_UPLOAD_ERROR",
            error_message=f"Failed to upload file to '{remote_path}': {str(e)}",
        )


def handle_vps_download_file(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    profile_id = str(args.get("profile_id", "owner_vps")).strip()
    remote_path = str(args.get("remote_path", "")).strip()
    artifact_filename = str(args.get("artifact_filename", "")).strip()
    overwrite = bool(args.get("overwrite", False))

    if not remote_path or not artifact_filename:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_download_file",
            status="FAILED",
            error_code="INVALID_ARGUMENTS",
            error_message="Both 'remote_path' and 'artifact_filename' are required.",
        )

    ok, err = validate_artifact_filename(artifact_filename)
    if not ok:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_download_file",
            status="FAILED",
            error_code="INVALID_FILENAME",
            error_message=err,
        )

    try:
        p_dir = get_pixel_artifacts_dir(context.artifacts_root, context.pixel_id)
        local_target = (p_dir / artifact_filename).resolve()
        if not str(local_target).startswith(str(p_dir.resolve())):
            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_download_file",
                status="FAILED",
                error_code="PATH_ESCAPE",
                error_message="Target filename escape detected.",
            )

        if local_target.exists() and not overwrite:
            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_download_file",
                status="FAILED",
                error_code="ARTIFACT_ALREADY_EXISTS",
                error_message=f"Artifact '{artifact_filename}' already exists and overwrite is False.",
            )

        with get_ssh_client(context, profile_id) as (_, sftp):
            if not sftp:
                raise RuntimeError("SFTP client not available")

            sftp.get(remote_path, str(local_target))

            return ToolResult(
                operation_id=context.operation_id,
                tool="vps_download_file",
                status="SUCCESS",
                output={
                    "remote_path": remote_path,
                    "artifact_filename": artifact_filename,
                    "size_bytes": local_target.stat().st_size,
                    "status": "DOWNLOADED",
                },
            )
    except Exception as e:
        return ToolResult(
            operation_id=context.operation_id,
            tool="vps_download_file",
            status="FAILED",
            error_code="SFTP_DOWNLOAD_ERROR",
            error_message=f"Failed to download remote file '{remote_path}': {str(e)}",
        )


vps_exec_spec = ToolSpec(
    name="vps_exec",
    description="在已配置的 VPS 服务器上非交互执行 Linux Shell 命令，捕获 stdout/stderr/exit_code。可用于安装环境、部署和启停服务等。",
    input_schema={
        "type": "object",
        "properties": {
            "profile_id": {"type": "string", "description": "VPS 配置标识，默认 'owner_vps'"},
            "command": {"type": "string", "description": "要执行的 Shell 命令行"},
            "cwd": {"type": "string", "description": "远程工作目录"},
            "timeout_seconds": {"type": "number", "minimum": 1, "maximum": 600, "description": "执行超时时间 (秒)"},
        },
        "required": ["command"],
        "additionalProperties": False,
    },
    handler=handle_vps_exec,
    effect="write",
    timeout_seconds=60.0,
)

vps_list_files_spec = ToolSpec(
    name="vps_list_files",
    description="通过 SFTP 查看已配置 VPS 服务器上的远程目录文件列表。",
    input_schema={
        "type": "object",
        "properties": {
            "profile_id": {"type": "string", "description": "VPS 配置标识，默认 'owner_vps'"},
            "path": {"type": "string", "description": "远程目录路径，默认为当前登录目录"},
            "offset": {"type": "integer", "minimum": 0, "description": "分页偏移"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 200, "description": "返回条目上限"},
        },
        "additionalProperties": False,
    },
    handler=handle_vps_list_files,
    effect="read",
)

vps_read_file_spec = ToolSpec(
    name="vps_read_file",
    description="通过 SFTP 读取已配置 VPS 服务器上的远程文件内容。",
    input_schema={
        "type": "object",
        "properties": {
            "profile_id": {"type": "string", "description": "VPS 配置标识，默认 'owner_vps'"},
            "path": {"type": "string", "description": "远程文件绝对或相对路径"},
            "offset": {"type": "integer", "minimum": 0, "description": "字符起始偏移"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 8000, "description": "读取字符上限"},
        },
        "required": ["path"],
        "additionalProperties": False,
    },
    handler=handle_vps_read_file,
    effect="read",
)

vps_write_file_spec = ToolSpec(
    name="vps_write_file",
    description="通过 SFTP 写入远程文本文件到已配置的 VPS 服务器。默认不覆盖现有文件。",
    input_schema={
        "type": "object",
        "properties": {
            "profile_id": {"type": "string", "description": "VPS 配置标识，默认 'owner_vps'"},
            "path": {"type": "string", "description": "远程文件路径"},
            "content": {"type": "string", "description": "要写入的文本内容"},
            "overwrite": {"type": "boolean", "description": "若文件已存在是否覆盖，默认 false"},
        },
        "required": ["path", "content"],
        "additionalProperties": False,
    },
    handler=handle_vps_write_file,
    effect="write",
)

vps_upload_file_spec = ToolSpec(
    name="vps_upload_file",
    description="通过 SFTP 将本地交付物或 private 私有文件直接上传至 VPS 服务器 (支持文本与二进制图片等)。",
    input_schema={
        "type": "object",
        "properties": {
            "profile_id": {"type": "string", "description": "VPS 配置标识，默认 'owner_vps'"},
            "source_kind": {"type": "string", "enum": ["artifact", "private"], "description": "源文件来源空间"},
            "source_path": {"type": "string", "description": "本地源相对路径"},
            "remote_path": {"type": "string", "description": "远程目标路径"},
            "overwrite": {"type": "boolean", "description": "若远程文件已存在是否覆盖，默认 false"},
        },
        "required": ["source_kind", "source_path", "remote_path"],
        "additionalProperties": False,
    },
    handler=handle_vps_upload_file,
    effect="write",
)

vps_download_file_spec = ToolSpec(
    name="vps_download_file",
    description="通过 SFTP 从 VPS 服务器下载文件并保存到当前元胞隔离交付物空间中。",
    input_schema={
        "type": "object",
        "properties": {
            "profile_id": {"type": "string", "description": "VPS 配置标识，默认 'owner_vps'"},
            "remote_path": {"type": "string", "description": "远程源文件路径"},
            "artifact_filename": {"type": "string", "description": "保存到本地交付物空间的文件名 (禁止路径分隔符)"},
            "overwrite": {"type": "boolean", "description": "若本地交付物已存在是否覆盖，默认 false"},
        },
        "required": ["remote_path", "artifact_filename"],
        "additionalProperties": False,
    },
    handler=handle_vps_download_file,
    effect="write",
)
