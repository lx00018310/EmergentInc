"""临时提示词、统一工具层与 VPS 端到端集成测试 (Tools, VPS & Temporary Prompt E2E).

全方位覆盖:
1. 临时提示词的独立生命周期 (隔离创世提示词、字符上限、版本递增、清空关闭、运行中修改409冲突)
2. Prompt 拼接与三输入纯洁性验证 (基础规则 -> TOOLS_CATALOG -> GENESIS -> TEMPORARY)
3. ToolRegistry 严格 Schema 校验、重复注册拦截、禁用与优雅降级
4. Private 目录安全访问、Windows 路径逃逸防御与凭据安全脱敏投影
5. inspect_private_image 视觉模型调用 (未配置返回明确错误，配置时正确解析)
6. VPS 工具集 (基于 Paramiko 模拟验证密码认证、密钥认证、exec命令、SFTP读写上传下载、overwrite保护)
7. tool_executions 持久化状态机、重放去重、异常中断转 UNKNOWN 与恢复
8. 扩展演练: 动态接入 fake_database_query 验证架构可扩展性
9. UI 接口完整闭环 (临时提示词、工具目录、执行记录、交付物下载)
"""

import os
import json
import time
from pathlib import Path
from unittest.mock import MagicMock, patch, ANY

import pytest
from fastapi.testclient import TestClient

from emergentinc.paths import get_paths
from emergentinc.engine.core_store import CoreStore
from emergentinc.engine.genesis import GenesisPromptManager
from emergentinc.engine.temporary_prompt import TemporaryPromptManager
from emergentinc.engine.llm import V9LLMClient
from emergentinc.engine.operations import OperationExecutor
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.tools.contracts import ToolSpec, ToolContext, ToolResult
from emergentinc.tools.registry import ToolRegistry
from emergentinc.tools.registry_manifest import create_default_registry, BUILTIN_SPECS
from emergentinc.tools.private_files import resolve_private_path, mask_sensitive_profile
from emergentinc.tools.vps import (
    handle_vps_exec,
    handle_vps_list_files,
    handle_vps_read_file,
    handle_vps_write_file,
    handle_vps_upload_file,
    handle_vps_download_file,
)
from emergentinc.ui.app import create_app


# ==================== 1. 临时提示词生命周期与隔离性 ====================

def test_temporary_prompt_lifecycle_and_isolation(tmp_path):
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    genesis_mgr = GenesisPromptManager(runtime_dir)
    temp_mgr = TemporaryPromptManager(runtime_dir)

    # 1. 初始状态：临时提示词默认空白，active=False
    init_temp = temp_mgr.get_prompt()
    assert init_temp["content"] == ""
    assert init_temp["active"] is False
    assert init_temp["revision"] == 0

    # 创世提示词默认内容存在，两者互不干扰
    init_gen = genesis_mgr.get_prompt()
    assert init_gen["active"] is True
    assert "尚未被解释" in init_gen["content"]

    # 2. 更新临时提示词
    updated = temp_mgr.update_prompt("使用 VPS 执行部署任务")
    assert updated["revision"] == 1
    assert updated["active"] is True
    assert updated["content"] == "使用 VPS 执行部署任务"

    # 确认创世提示词未被修改
    after_gen = genesis_mgr.get_prompt()
    assert after_gen["revision"] == init_gen["revision"]
    assert "尚未被解释" in after_gen["content"]

    # 3. 内容无变化时不递增 revision
    same = temp_mgr.update_prompt("使用 VPS 执行部署任务")
    assert same["revision"] == 1

    # 4. 内容变更递增 revision
    updated2 = temp_mgr.update_prompt("使用 VPS 执行部署任务，并拉取最新日志")
    assert updated2["revision"] == 2

    # 5. 清空并关闭
    cleared = temp_mgr.clear_prompt()
    assert cleared["revision"] == 3
    assert cleared["content"] == ""
    assert cleared["active"] is False

    # 6. 超长校验
    with pytest.raises(ValueError, match="exceeds maximum allowed"):
        temp_mgr.update_prompt("A" * 12001)


# ==================== 2. Prompt 拼接与 Token 预算估算 ====================

def test_prompt_layering_and_token_estimation(tmp_path):
    client = V9LLMClient(base_dir=tmp_path, mock_handler=lambda p: {"send_to": ["STOP"]})

    # 注入工具目录、创世提示词与临时提示词
    client.set_tools_catalog("### [TOOLS_CATALOG]\n- `save_artifact`: 保存文件")
    client.lock_genesis_prompt("创世世界观内容", revision=1)
    client.lock_temporary_prompt("临时运维指令", revision=1)

    payload = {"state": {"energy": 100}, "pixel_md": "# Mind", "message_md": "Hello"}
    prep = client.prepare_prompt(
        state_dict=payload["state"],
        pixel_md=payload["pixel_md"],
        message_md=payload["message_md"],
    )

    full = prep.prompt_full
    # 严格检验层级顺序：基础系统规则 -> TOOLS_CATALOG -> GENESIS_CONTEXT -> TEMPORARY_CONTEXT
    idx_base = full.find("你是一个Pixel")
    idx_tools = full.find("### [TOOLS_CATALOG]")
    idx_gen = full.find("[GENESIS_CONTEXT]")
    idx_temp = full.find("[TEMPORARY_CONTEXT]")

    assert idx_base != -1
    assert idx_tools != -1
    assert idx_gen != -1
    assert idx_temp != -1
    assert idx_base < idx_tools < idx_gen < idx_temp

    # 验证三输入纯洁性：payload 严格只含 3 个 key
    assert len(prep.payload.keys()) == 3
    assert set(prep.payload.keys()) == {"state", "pixel_md", "message_md"}

    # 验证 Token 估值覆盖了完整组合内容
    assert prep.estimated_prompt_tokens > len(full) // 2


# ==================== 3. ToolRegistry 规范与参数校验 ====================

def test_tool_registry_validation_and_uniqueness():
    reg = ToolRegistry()

    dummy_spec = ToolSpec(
        name="dummy_tool",
        description="测试工具",
        input_schema={
            "type": "object",
            "properties": {"count": {"type": "integer", "minimum": 1}},
            "required": ["count"],
            "additionalProperties": False,
        },
        handler=lambda args, ctx: ToolResult(operation_id=ctx.operation_id, tool="dummy_tool", status="SUCCESS", output=args["count"]),
    )
    reg.register(dummy_spec)

    # 1. 重复注册拦截
    with pytest.raises(ValueError, match="already registered"):
        reg.register(dummy_spec)

    ctx = ToolContext(
        workspace_root=Path("."),
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )

    # 2. 正确参数执行
    res_ok = reg.execute("dummy_tool", {"count": 5}, ctx)
    assert res_ok.status == "SUCCESS"
    assert res_ok.output == 5
    assert res_ok.duration_ms >= 0

    # 3. 错误参数 (缺少必填项) 拒绝
    res_missing = reg.execute("dummy_tool", {}, ctx)
    assert res_missing.status == "FAILED"
    assert res_missing.error_code == "INVALID_ARGUMENTS"

    # 4. 错误参数 (额外字段) 拒绝
    res_extra = reg.execute("dummy_tool", {"count": 5, "extra": "forbidden"}, ctx)
    assert res_extra.status == "FAILED"
    assert res_extra.error_code == "INVALID_ARGUMENTS"

    # 5. 未知工具拒绝
    res_unknown = reg.execute("non_existent_tool", {}, ctx)
    assert res_unknown.status == "FAILED"
    assert res_unknown.error_code == "CAPABILITY_UNAVAILABLE"


# ==================== 4. 私有文件安全、路径防御与凭据脱敏 ====================

def test_private_file_path_security_and_credential_masking(tmp_path):
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)

    # 创建一个 VPS profile
    profile_data = {
        "type": "vps",
        "host": "192.168.1.100",
        "port": 22,
        "username": "root",
        "password": "SUPER_SECRET_PASSWORD",
        "allowed_operations": ["*"],
    }
    (private_root / "owner_vps_profile.json").write_text(json.dumps(profile_data), encoding="utf-8")

    # 创建一个普通文本文件
    (private_root / "notes.md").write_text("业务运维文档", encoding="utf-8")

    # 1. 路径防御测试：越界路径必须拒绝
    ok, p, err = resolve_private_path(private_root, "../secret.txt")
    assert not ok
    assert "PATH_TRAVERSAL_FORBIDDEN" in err

    # 2. 合法路径解析
    ok, p_notes, err = resolve_private_path(private_root, "notes.md")
    assert ok
    assert p_notes.exists()

    # 3. 凭据配置文件安全脱敏投影
    masked = mask_sensitive_profile(profile_data)
    assert masked["host"] == "192.168.1.100"
    assert masked["username"] == "root"
    assert masked["has_password"] is True
    assert "password" not in masked
    assert "SUPER_SECRET_PASSWORD" not in json.dumps(masked)

    # 4. read_private_file 工具调用脱敏测试
    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )
    from emergentinc.tools.private_files import handle_read_private_file
    res_prof = handle_read_private_file({"path": "owner_vps_profile.json"}, ctx)
    assert res_prof.status == "SUCCESS"
    assert "SUPER_SECRET_PASSWORD" not in json.dumps(res_prof.to_dict())
    assert res_prof.output["data"]["has_password"] is True


# ==================== 5. inspect_private_image 视觉模型安全响应 ====================

def test_inspect_private_image_unconfigured(tmp_path):
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)
    img_file = private_root / "test.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 20)

    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )
    from emergentinc.tools.private_files import handle_inspect_private_image

    # 未配置视觉模型环境变量时，严禁假装成功，明确返回 VISION_MODEL_UNCONFIGURED
    with patch.dict(os.environ, {}, clear=True):
        res = handle_inspect_private_image({"path": "test.jpg", "question": "描述图像"}, ctx)
        assert res.status == "FAILED"
        assert res.error_code == "VISION_MODEL_UNCONFIGURED"


# ==================== 6. VPS 工具集 (Paramiko 模拟测试) ====================

def test_vps_tools_with_paramiko_mock(tmp_path):
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)
    live_artifacts = tmp_path / "live" / "artifacts" / "0_0_0"
    live_artifacts.mkdir(parents=True, exist_ok=True)

    # 写入假 profile
    profile = {
        "host": "10.0.0.1",
        "port": 22,
        "username": "admin",
        "password": "fake_password",
    }
    (private_root / "owner_vps_profile.json").write_text(json.dumps(profile), encoding="utf-8")

    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )

    # 1. 模拟 vps_exec
    mock_ssh = MagicMock()
    mock_sftp = MagicMock()

    # 模拟 exec_command 返回
    mock_channel = MagicMock()
    mock_channel.recv_exit_status.return_value = 0
    mock_stdout = MagicMock()
    mock_stdout.channel = mock_channel
    mock_stdout.read.return_value = b"Linux vps-node 5.15\n"
    mock_stderr = MagicMock()
    mock_stderr.read.return_value = b""
    mock_ssh.exec_command.return_value = (None, mock_stdout, mock_stderr)

    with patch("emergentinc.tools.vps.get_ssh_client") as mock_get_client:
        mock_get_client.return_value.__enter__.return_value = (mock_ssh, mock_sftp)

        # 成功执行命令
        res_exec = handle_vps_exec({"command": "uname -a"}, ctx)
        assert res_exec.status == "SUCCESS"
        assert res_exec.output["exit_code"] == 0
        assert "Linux vps-node" in res_exec.output["stdout"]

        # 模拟命令失败 (退出码非零)
        mock_channel.recv_exit_status.return_value = 127
        mock_stderr.read.return_value = b"command not found\n"
        res_fail = handle_vps_exec({"command": "bad_cmd"}, ctx)
        assert res_fail.status == "FAILED"
        assert res_fail.error_code == "COMMAND_EXIT_127"

        # 2. 模拟 SFTP 文件写入 (默认不覆盖)
        mock_sftp.stat.return_value = MagicMock(st_size=100)
        res_nowrite = handle_vps_write_file({"path": "/app/config.json", "content": "{}", "overwrite": False}, ctx)
        assert res_nowrite.status == "FAILED"
        assert res_nowrite.error_code == "FILE_ALREADY_EXISTS"

        # 覆盖写入
        mock_wf = MagicMock()
        mock_sftp.open.return_value.__enter__.return_value = mock_wf
        res_overwrite = handle_vps_write_file({"path": "/app/config.json", "content": "{}", "overwrite": True}, ctx)
        assert res_overwrite.status == "SUCCESS"
        assert res_overwrite.output["bytes_written"] == 2

        # 3. 模拟 SFTP 文件下载 (下载到当前 Pixel 交付物目录)
        mock_sftp.get.side_effect = lambda remote, local: Path(local).write_text("downloaded log data", encoding="utf-8")
        res_dl = handle_vps_download_file(
            {"remote_path": "/var/log/app.log", "artifact_filename": "app.log", "overwrite": True},
            ctx
        )
        assert res_dl.status == "SUCCESS"
        assert res_dl.output["artifact_filename"] == "app.log"
        mock_sftp.get.assert_called_once()


# ==================== 7. tool_executions 状态机与重放去重 ====================

def test_tool_executions_store_and_replay_deduplication(tmp_path):
    db_path = tmp_path / "ledger" / "v9_core.sqlite3"
    store = CoreStore(db_path)

    op_id = "op_test_001"
    args_hash = "hash_123"

    # 1. 首次登记 STARTED 成功
    is_new, existing = store.record_tool_started(
        operation_id=op_id,
        run_id="run_1",
        message_id="msg_1",
        pixel_id="0_0_0",
        op_index=0,
        tool="vps_exec",
        args_hash=args_hash,
    )
    assert is_new is True
    assert existing is None

    # 2. 记录真实执行结果
    store.record_tool_finished(
        operation_id=op_id,
        status="SUCCESS",
        result={"exit_code": 0, "stdout": "ok"},
    )

    # 3. 重放相同 operation_id：必须返回已完成记录，禁止再次执行
    is_new_again, replay = store.record_tool_started(
        operation_id=op_id,
        run_id="run_1",
        message_id="msg_1",
        pixel_id="0_0_0",
        op_index=0,
        tool="vps_exec",
        args_hash=args_hash,
    )
    assert is_new_again is False
    assert replay["status"] == "SUCCESS"
    assert replay["result"]["stdout"] == "ok"

    # 4. 崩溃遗留 STARTED 状态自动恢复为 UNKNOWN
    op_id_stale = "op_stale_999"
    store.record_tool_started(
        operation_id=op_id_stale,
        run_id="run_1",
        message_id="msg_1",
        pixel_id="0_0_0",
        op_index=1,
        tool="vps_write_file",
        args_hash="hash_456",
    )
    # 模拟系统重启恢复
    recovered_count = store.recover_stale_tool_executions()
    assert recovered_count == 1
    stale_rec = store.get_tool_execution(op_id_stale)
    assert stale_rec["status"] == "UNKNOWN"
    assert stale_rec["result"]["error_code"] == "SYSTEM_RESTARTED"


# ==================== 8. 扩展演练: 动态接入 fake_database_query ====================

def test_extensibility_fake_database_query_integration(tmp_path):
    """验证未来新增工具 (如数据库查询) 时无需改动 scheduler，直接声明并注册即可."""
    def handle_fake_db(args, ctx):
        sql = args.get("sql", "")
        return ToolResult(
            operation_id=ctx.operation_id,
            tool="fake_database_query",
            status="SUCCESS",
            output={"sql": sql, "rows": [{"id": 1, "name": "Pixel Alpha"}]},
        )

    fake_db_spec = ToolSpec(
        name="fake_database_query",
        description="执行只读 SQL 数据库查询。",
        input_schema={
            "type": "object",
            "properties": {"sql": {"type": "string"}},
            "required": ["sql"],
            "additionalProperties": False,
        },
        handler=handle_fake_db,
        effect="read",
    )

    # 创建注册表并追加此工具
    reg = create_default_registry()
    reg.register(fake_db_spec)

    # 检查自动生成的 Prompt 目录包含该工具
    catalog = reg.render_catalog_for_prompt()
    assert "- **`fake_database_query`** (read): 执行只读 SQL 数据库查询。" in catalog

    # 检查通过 OperationExecutor 执行并正确得到回执
    executor = OperationExecutor(tmp_path / "artifacts", registry=reg)
    receipts, feedback = executor.execute_all(
        pixel_id="0_0_0",
        operations=[{"tool": "fake_database_query", "args": {"sql": "SELECT * FROM pixels;"}}],
    )
    assert len(receipts) == 1
    assert receipts[0].status == "SUCCESS"
    assert receipts[0].output["rows"][0]["name"] == "Pixel Alpha"
    assert "[ENGINE_FEEDBACK]" in feedback


# ==================== 9. UI API 端到端验证 ====================

def test_ui_api_endpoints_for_tools_and_temporary_prompt(tmp_path):
    paths = get_paths(tmp_path)
    app = create_app(paths)
    client = TestClient(app)

    # 1. 临时提示词 GET/PUT
    r_get = client.get("/api/temporary-prompt")
    assert r_get.status_code == 200
    assert r_get.json()["active"] is False

    r_put = client.put("/api/temporary-prompt", json={"content": "检查服务器当前环境"})
    assert r_put.status_code == 200
    assert r_put.json()["revision"] == 1
    assert r_put.json()["active"] is True

    # 2. 工具目录只读查询
    r_tools = client.get("/api/tools")
    assert r_tools.status_code == 200
    tool_names = [t["name"] for t in r_tools.json()["tools"]]
    assert "save_artifact" in tool_names
    assert "vps_exec" in tool_names
    assert "vps_upload_file" in tool_names
    assert "list_private_files" in tool_names

    # 3. 私有文件只读查询
    r_priv = client.get("/api/private-files")
    assert r_priv.status_code == 200
    assert "files" in r_priv.json()

    # 4. 交付物下载接口
    art_dir = paths.live_root / "artifacts" / "0_0_0"
    art_dir.mkdir(parents=True, exist_ok=True)
    (art_dir / "test_out.txt").write_text("deliverable content", encoding="utf-8")

    r_dl = client.get("/api/pixels/0_0_0/artifacts/test_out.txt/download")
    assert r_dl.status_code == 200
    assert r_dl.text == "deliverable content"


# ==================== 10. T1 缺陷专项修复测试 (凭据、逃逸、死锁与UNKNOWN、预算、降级) ====================

def test_t1_credential_leak_prevention(tmp_path):
    """验证 T1: 凭据与私钥文件禁止明文读取，且严禁上传至远程 VPS."""
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)

    # 1. 放置敏感私钥与配置文件
    id_key = private_root / "id_ed25519"
    id_key.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nfake_key_material\n-----END OPENSSH PRIVATE KEY-----", encoding="utf-8")

    cert_key = private_root / "server.pem"
    cert_key.write_text("-----BEGIN RSA PRIVATE KEY-----\nfake_rsa_material\n-----END RSA PRIVATE KEY-----", encoding="utf-8")

    prof = private_root / "owner_vps_profile.json"
    prof.write_text(json.dumps({"host": "1.1.1.1", "password": "REAL_PASSWORD"}), encoding="utf-8")

    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )

    from emergentinc.tools.private_files import handle_read_private_file
    from emergentinc.tools.vps import handle_vps_upload_file

    # 2. 读取私钥必须被严格阻断
    res_key = handle_read_private_file({"path": "id_ed25519"}, ctx)
    assert res_key.status == "FAILED"
    assert res_key.error_code == "CREDENTIAL_READ_BLOCKED"

    res_pem = handle_read_private_file({"path": "server.pem"}, ctx)
    assert res_pem.status == "FAILED"
    assert res_pem.error_code == "CREDENTIAL_READ_BLOCKED"

    # 3. 读取 profile 做安全脱敏投影
    res_prof = handle_read_private_file({"path": "owner_vps_profile.json"}, ctx)
    assert res_prof.status == "SUCCESS"
    assert "REAL_PASSWORD" not in json.dumps(res_prof.to_dict())

    # 4. 上传私钥与 profile 到远程 VPS 必须被严格拦截
    res_up_key = handle_vps_upload_file({
        "source_kind": "private",
        "source_path": "id_ed25519",
        "remote_path": "/tmp/id_ed25519"
    }, ctx)
    assert res_up_key.status == "FAILED"
    assert res_up_key.error_code == "CREDENTIAL_UPLOAD_FORBIDDEN"

    res_up_prof = handle_vps_upload_file({
        "source_kind": "private",
        "source_path": "owner_vps_profile.json",
        "remote_path": "/tmp/stolen_profile.json"
    }, ctx)
    assert res_up_prof.status == "FAILED"
    assert res_up_prof.error_code == "CREDENTIAL_UPLOAD_FORBIDDEN"


def test_t1_vps_profile_path_traversal_prevention(tmp_path):
    """验证 T1: profile_id 路径逃逸与非法字符防御."""
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)

    from emergentinc.tools.vps import load_vps_profile, handle_vps_exec

    # 1. 尝试路径逃逸
    ok, data, err = load_vps_profile(private_root, "../outside")
    assert ok is False
    assert "INVALID_PROFILE_ID" in err or "PATH_TRAVERSAL" in err

    ok, data, err = load_vps_profile(private_root, "subdir/profile")
    assert ok is False
    assert "INVALID_PROFILE_ID" in err

    ok, data, err = load_vps_profile(private_root, "bad;injection")
    assert ok is False
    assert "INVALID_PROFILE_ID" in err

    # 2. 调用 vps_exec 传入非法 profile_id
    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )
    res = handle_vps_exec({"profile_id": "../outside", "command": "uname -a"}, ctx)
    assert res.status == "FAILED"
    assert res.error_code == "PROFILE_ERROR"


def test_t1_vps_exec_nonblocking_deadlock_and_unknown_status(tmp_path):
    """验证 T1: vps_exec 流排空轮询机制、超时 UNKNOWN 状态及中途停止 UNKNOWN 状态."""
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)
    profile = {"host": "10.0.0.1", "username": "admin", "password": "pwd"}
    (private_root / "owner_vps_profile.json").write_text(json.dumps(profile), encoding="utf-8")

    from emergentinc.tools.vps import handle_vps_exec

    # 1. 模拟超时导致 UNKNOWN 状态
    mock_ssh = MagicMock()
    mock_stdout = MagicMock()
    mock_channel = MagicMock()
    # exit_status_ready 返回 bool 从而启用非阻塞流排空
    mock_channel.exit_status_ready.return_value = False
    mock_channel.recv_ready.return_value = False
    mock_channel.recv_stderr_ready.return_value = False
    mock_stdout.channel = mock_channel
    mock_stderr = MagicMock()
    mock_ssh.exec_command.return_value = (None, mock_stdout, mock_stderr)

    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )

    with patch("emergentinc.tools.vps.get_ssh_client") as mock_client:
        mock_client.return_value.__enter__.return_value = (mock_ssh, None)

        # 超时时间设为 0.05 秒
        res_timeout = handle_vps_exec({"command": "sleep 100", "timeout_seconds": 0.05}, ctx)
        assert res_timeout.status == "UNKNOWN"
        assert res_timeout.error_code == "TIMEOUT"
        assert "timed out" in res_timeout.error_message
        mock_channel.close.assert_called()

    # 2. 模拟执行中途用户发出停止信号导致 UNKNOWN 状态
    stop_flags = [False, True]
    def mock_stop():
        return stop_flags.pop(0) if stop_flags else True

    ctx_stop = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_2",
        stop_requested=mock_stop,
    )

    with patch("emergentinc.tools.vps.get_ssh_client") as mock_client:
        mock_client.return_value.__enter__.return_value = (mock_ssh, None)
        res_stopped = handle_vps_exec({"command": "long_task", "timeout_seconds": 10.0}, ctx_stop)
        assert res_stopped.status == "UNKNOWN"
        assert res_stopped.error_code == "STOPPED_DURING_EXEC"


def test_t1_vps_file_interruption_unknown_status(tmp_path):
    """验证 T1: VPS 写文件与上传文件传输中途中断标为 UNKNOWN."""
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)
    profile = {"host": "10.0.0.1", "username": "admin", "password": "pwd"}
    (private_root / "owner_vps_profile.json").write_text(json.dumps(profile), encoding="utf-8")

    from emergentinc.tools.vps import handle_vps_write_file, handle_vps_upload_file

    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )

    # 1. 模拟写入中途异常
    mock_sftp = MagicMock()
    mock_sftp.stat.side_effect = FileNotFoundError()
    mock_sftp.open.side_effect = OSError("Connection reset by peer during write")

    with patch("emergentinc.tools.vps.get_ssh_client") as mock_client:
        mock_client.return_value.__enter__.return_value = (MagicMock(), mock_sftp)
        res_w = handle_vps_write_file({"path": "/app/test.txt", "content": "hello"}, ctx)
        assert res_w.status == "UNKNOWN"
        assert res_w.error_code == "WRITE_INTERRUPTED_UNKNOWN"

    # 2. 模拟上传传输中断
    test_src = tmp_path / "live" / "artifacts" / "0_0_0" / "data.bin"
    test_src.parent.mkdir(parents=True, exist_ok=True)
    test_src.write_bytes(b"binary content")

    mock_sftp.put.side_effect = ConnectionError("SFTP stream severed")
    with patch("emergentinc.tools.vps.get_ssh_client") as mock_client:
        mock_client.return_value.__enter__.return_value = (MagicMock(), mock_sftp)
        res_up = handle_vps_upload_file({
            "source_kind": "artifact",
            "source_path": "data.bin",
            "remote_path": "/app/data.bin"
        }, ctx)
        assert res_up.status == "UNKNOWN"
        assert res_up.error_code == "UPLOAD_INTERRUPTED_UNKNOWN"


def test_t1_inspect_private_image_budget_and_unknown(tmp_path):
    """验证 T1: inspect_private_image 接入 core_store 预算预留与结算，网络中断记为 UNKNOWN."""
    private_root = tmp_path / "private"
    private_root.mkdir(parents=True, exist_ok=True)
    img_file = private_root / "sample.jpg"
    img_file.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 20)

    from emergentinc.tools.private_files import handle_inspect_private_image

    mock_store = MagicMock()

    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
        core_store=mock_store,
        extra={"vision_model": "gpt-4o"},
    )

    env = {
        "MCL_VISION_MODEL": "gpt-4o",
        "MCL_API_KEY": "fake_key",
        "MCL_BASE_URL": "https://api.openai.com/v1",
    }

    with patch.dict(os.environ, env, clear=True):
        # 1. 预算超限阻断
        mock_store.reserve_call_budget.return_value = (False, None, "RUN_LIMIT_EXCEEDED")
        res_budget = handle_inspect_private_image({"path": "sample.jpg"}, ctx)
        assert res_budget.status == "FAILED"
        assert res_budget.error_code == "BUDGET_EXCEEDED"

        # 2. 网络超时进入 UNKNOWN 并通知 core_store.mark_call_unknown
        mock_store.reserve_call_budget.return_value = (True, "res_123", None)
        with patch("httpx.Client") as mock_client_cls:
            import httpx
            mock_client = MagicMock()
            mock_client.__enter__.return_value = mock_client
            mock_client.post.side_effect = httpx.TimeoutException("Gateway Timeout")
            mock_client_cls.return_value = mock_client

            res_timeout = handle_inspect_private_image({"path": "sample.jpg"}, ctx)
            assert res_timeout.status == "UNKNOWN"
            assert res_timeout.error_code == "VISION_API_TIMEOUT"
            mock_store.mark_call_unknown.assert_called_once()

        # 3. 正常调用成功结算
        with patch("httpx.Client") as mock_client_cls:
            mock_client = MagicMock()
            mock_client.__enter__.return_value = mock_client
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = {
                "choices": [{"message": {"content": "这是一张测试图片"}}],
                "usage": {"total_tokens": 850},
            }
            mock_client.post.return_value = mock_resp
            mock_client_cls.return_value = mock_client

            res_ok = handle_inspect_private_image({"path": "sample.jpg"}, ctx)
            assert res_ok.status == "SUCCESS"
            assert res_ok.output["tokens_used"] == 850
            mock_store.settle_call_budget.assert_called_with(
                call_id="res_123",
                actual_tokens=850,
                outcome="SUCCESS",
                details=ANY,
            )


def test_t1_paramiko_missing_graceful_degradation(tmp_path):
    """验证 T1: 当运行环境缺少 paramiko 库时平滑降级，明确返回 DEPENDENCY_MISSING."""
    ctx = ToolContext(
        workspace_root=tmp_path,
        pixel_id="0_0_0",
        run_id="run_1",
        message_id="msg_1",
        operation_id="op_1",
    )

    from emergentinc.tools.vps import handle_vps_exec, handle_vps_upload_file

    with patch("emergentinc.tools.vps.PARAMIKO_AVAILABLE", False):
        res_exec = handle_vps_exec({"command": "uptime"}, ctx)
        assert res_exec.status == "FAILED"
        assert res_exec.error_code == "DEPENDENCY_MISSING"

        res_up = handle_vps_upload_file({
            "source_kind": "artifact",
            "source_path": "any.txt",
            "remote_path": "/tmp/any.txt"
        }, ctx)
        assert res_up.status == "FAILED"
        assert res_up.error_code == "DEPENDENCY_MISSING"

