# EmergentInc 工具层设计与开发者扩展指南

本项目在 V9 架构中建立了统一受控的工具层 (`emergentinc/tools/`)，以取代之前零散且硬编码的调用逻辑。所有工具调用统一走 operations 调度、受控参数校验、统一回执状态机及 SQLite `tool_executions` 记录。

---

## 1. 架构总览

```text
模型决策生成 operations: [{"tool": "...", "args": {...}}]
  │
  ▼
ToolRegistry 统一参数校验 (JSON Schema) 与停止信号检测
  │
  ▼
ToolSpec.handler(args, ToolContext) 执行
  │
  ▼
生成结构化 ToolResult (SUCCESS / FAILED / UNKNOWN)
  │
  ▼
SQLite tool_executions 记录与重放去重
  │
  ▼
ENGINE_FEEDBACK 回馈给下一轮决策
```

### 核心契约 (`contracts.py`)

- **`ToolSpec`**: 工具规范定义，包含名称、描述、JSON Schema、读写效应分类（`read` / `write`）、超时秒数与执行处理函数。
- **`ToolContext`**: 引擎注入的安全上下文，包含当前 `workspace_root`、`pixel_id`、`run_id`、`message_id`、`operation_id` 以及 `stop_requested` 钩子。模型无法篡改上下文。
- **`ToolResult`**: 统一回执数据结构，包含 `operation_id`、`tool`、`status`、`output`、`error_code`、`error_message`、`duration_ms` 与 `truncated`。

---

## 2. 内置工具清单

| 工具名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `save_artifact` | write | 在当前元胞隔离交付物目录下保存文本交付物 |
| `read_artifact` | read | 安全读取当前元胞的交付物 (支持文本分页与二进制类型识别) |
| `list_artifacts` | read | 列举当前元胞目录下的所有交付物文件 |
| `list_private_files` | read | 安全分页列出 `workspace/private/` 目录中的文件及目录 |
| `read_private_file` | read | 安全读取私有文本；自动拦截已知凭据文件并做只读元数据脱敏投影 |
| `inspect_private_image` | read | 调用已配置的多模态视觉模型观察并解析私有图片内容 |
| `vps_exec` | write | 通过 SSH 在配置的 VPS 上非交互执行 Linux Shell 命令 |
| `vps_list_files` | read | 通过 SFTP 查看 VPS 远程目录文件 |
| `vps_read_file` | read | 通过 SFTP 读取 VPS 远程文本文件内容 |
| `vps_write_file` | write | 通过 SFTP 写入 VPS 远程文本文件 (默认不覆盖) |
| `vps_upload_file` | write | 将本地交付物或 private 业务文件上传至 VPS (支持二进制) |
| `vps_download_file` | write | 从 VPS 下载文件并存入当前元胞交付物目录 |

---

## 3. 开发者扩展新能力的标准步骤 (如新增数据库或社交工具)

当需要新增外部工具（例如数据库查询、社交账号发帖）时，**严禁修改调度核心**，遵循以下 5 步即可完成安全接入：

### 第 1 步：在 `emergentinc/tools/` 下新建模块文件

例如创建 `emergentinc/tools/database.py`：

```python
from typing import Dict, Any
from .contracts import ToolSpec, ToolContext, ToolResult

def handle_database_query(args: Dict[str, Any], context: ToolContext) -> ToolResult:
    sql = args.get("sql", "").strip()
    # 执行受控查询...
    return ToolResult(
        operation_id=context.operation_id,
        tool="database_query",
        status="SUCCESS",
        output={"rows": [], "row_count": 0},
    )

database_query_spec = ToolSpec(
    name="database_query",
    description="对已配置的业务数据库执行只读 SQL 查询。",
    input_schema={
        "type": "object",
        "properties": {
            "sql": {"type": "string", "description": "要执行的只读 SQL 查询语句"},
        },
        "required": ["sql"],
        "additionalProperties": False,
    },
    handler=handle_database_query,
    effect="read",
    timeout_seconds=15.0,
)
```

### 第 2 步：在 `registry_manifest.py` 中显式注册

在 `BUILTIN_SPECS` 数组中引入并追加 `database_query_spec`。

### 第 3 步：在 `workspace/private/tools.json` 或独立 profile 中配置

如果需要数据库连接凭据，在 `workspace/private/` 中存放配置（如 `database_profile.json`），工具处理函数从 `context.private_root` 读取，并做脱敏保护，**严禁明文凭据注入 System Prompt 或日志**。

### 第 4 步：编写单元测试与回执校验测试

在 `tests/` 下增加针对该工具的输入校验、错误分类、超时处理与重放逻辑测试。

### 第 5 步：端到端验证

无需修改 `scheduler.py` 或 `llm.py`，模型提示词会自动更新工具目录，并通过标准 operations 路径完成调度与持久化。
