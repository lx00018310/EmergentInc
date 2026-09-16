"""本地元胞演化与交付物主路径端到端闭环验收测试 (LOCAL_CORE_SLIMMING_PLAN 验收标准).

覆盖范围:
1. init_workspace 初始化新工作区最小骨架与创世唤醒消息
2. UI 控制器 (RunController) 启动 1 轮演化
3. 真实消费初始消息并触发 1 次模型调用 (不空转)
4. 模型返回 owner_request 时被记录为 unsupported_owner_request，不生成阻断审批单，不中断停机
5. 模型调用 save_artifact 工具将交付物写入 live/artifacts/0_0_0/
6. UI API 端点 (/api/pixels/0_0_0/artifacts 及子路径) 正常查看交付物列表与详情，防路径穿越
"""

import time
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from emergentinc.cli.init_workspace import init_workspace
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.ui.run_controller import RunController
from emergentinc.ui.app import create_app
from emergentinc.paths import get_paths


def test_init_workspace_creates_v9_bootstrap(tmp_path):
    """验证全新工作区初始化后具备完整的 V9 创世状态与唤醒队列."""
    ws = tmp_path / "workspace"
    init_workspace(ws)

    paths = get_paths(ws)
    # 1. 验证 V9 心智与状态文件存在
    pixel_dir = paths.live_root / "pixels" / "0_0_0"
    assert pixel_dir.is_dir()
    assert (pixel_dir / "pixel.md").is_file()
    assert (pixel_dir / "state.json").is_file()

    # 2. 验证环境与交付物目录存在
    assert (paths.live_root / "environment.md").is_file()
    assert (paths.live_root / "artifacts").is_dir()

    # 3. 验证创世唤醒消息已注入队列且仅有 1 条
    queue_file = paths.runtime_root / "v9_message_queue.json"
    assert queue_file.is_file()
    import json
    q_data = json.loads(queue_file.read_text(encoding="utf-8"))
    queue_list = q_data.get("queue", [])
    assert len(queue_list) == 1
    assert queue_list[0]["recipient"] == "0_0_0"
    assert queue_list[0]["sender"] == "SYSTEM"


def test_local_core_closed_loop_e2e(tmp_path, monkeypatch):
    """端到端验证: UI 启动 -> 消费消息 -> 模型决策 -> 工具保存交付物 -> API 查询交付物."""
    ws = tmp_path / "workspace"
    init_workspace(ws)
    paths = get_paths(ws)

    call_records = []

    def mock_handler(payload):
        call_records.append(payload)
        msg_md = payload.get("message_md", "")
        if "[ENGINE_FEEDBACK]" in msg_md:
            return {
                "pixel_md": "# Final Mind\nArtifact verified via engine feedback.",
                "message_md": "",
                "send_to": ["STOP"],
                "environment_read": False,
                "reproduce": None,
                "energy_transfer": [],
                "owner_request": None,
                "operations": [],
            }
        return {
            "pixel_md": "# Updated Mind\nVerified genesis awakened and created artifact.",
            "message_md": "Artifact creation complete.",
            "send_to": ["STOP"],
            "environment_read": False,
            "reproduce": None,
            "energy_transfer": [],
            "owner_request": {
                "capability": "request_host_disk_write",
                "reason": "Host disk access should be bypassed without blocking",
            },
            "operations": [
                {
                    "tool": "save_artifact",
                    "arguments": {
                        "filename": "hello_artifact.md",
                        "content": "# Hello World\nThis is a generated artifact from Genesis.",
                    },
                }
            ],
        }

    # 替换 RunController 的调度器生成逻辑以使用带 mock_handler 的 V9RoundScheduler
    def mock_get_scheduler(self):
        return V9RoundScheduler(self.paths.workspace_root, mock_handler=mock_handler)

    monkeypatch.setattr(RunController, "_get_scheduler", mock_get_scheduler)

    app = create_app(paths)
    client = TestClient(app)

    # 1. 验证初始运行状态
    status_res = client.get("/api/run/status")
    assert status_res.status_code == 200
    initial_status = status_res.json()
    assert initial_status["running"] is False
    assert initial_status["completed_rounds"] == 0

    # 2. 触发运行 1 轮
    start_res = client.post(
        "/api/run/start",
        json={
            "rounds": 1,
            "run_budget_tokens": 200000,
            "global_budget_tokens": 2000000,
        },
    )
    assert start_res.status_code == 200
    assert start_res.json()["running"] is True

    # 3. 轮询等待运行结束 (最长等待 10 秒)
    finished = False
    final_status = None
    for _ in range(100):
        time.sleep(0.05)
        st = client.get("/api/run/status").json()
        if not st["running"]:
            finished = True
            final_status = st
            break

    assert finished, "运行超时未结束"
    assert final_status["completed_rounds"] == 1
    assert final_status["model_calls_completed"] == 2
    assert final_status["messages_processed"] >= 2
    assert final_status["pending_owner_requests"] == []

    # 4. 验证模型经历创世唤醒与工具反馈调用
    assert len(call_records) == 2
    assert call_records[0]["state"]["id"] == "0_0_0"
    assert "[ENGINE_FEEDBACK]" in call_records[1]["message_md"]

    # 5. 验证审批单未被创建 (未阻塞)
    ext_req_dir = paths.workspace_root / "external_requests"
    if ext_req_dir.exists():
        assert len(list(ext_req_dir.glob("*.json"))) == 0

    # 6. 验证交付物在文件系统落地
    artifact_file = paths.live_root / "artifacts" / "0_0_0" / "hello_artifact.md"
    assert artifact_file.is_file()
    assert "This is a generated artifact" in artifact_file.read_text(encoding="utf-8")

    # 7. 验证交付物 API 查询端点
    list_res = client.get("/api/pixels/0_0_0/artifacts")
    assert list_res.status_code == 200
    artifacts_list = list_res.json().get("artifacts", [])
    assert len(artifacts_list) == 1
    assert artifacts_list[0]["filename"] == "hello_artifact.md"
    assert artifacts_list[0]["size_bytes"] > 0

    # 8. 验证交付物详情内容获取
    detail_res = client.get("/api/pixels/0_0_0/artifacts/hello_artifact.md")
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["filename"] == "hello_artifact.md"
    assert "# Hello World" in detail_data["content"]

    # 9. 验证路径穿越防御
    sneaky_res = client.get("/api/pixels/0_0_0/artifacts/../traversal.txt")
    assert sneaky_res.status_code in (400, 403, 404)
