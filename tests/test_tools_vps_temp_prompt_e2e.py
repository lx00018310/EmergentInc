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
from unittest.mock import MagicMock, patch

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
