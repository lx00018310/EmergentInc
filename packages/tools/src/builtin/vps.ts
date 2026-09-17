import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext } from "../context.js";

function getMockVpsResult(
  tool: string,
  args: Record<string, any>,
  ctx: ToolContext
): ToolResult {
  if (ctx.mockVpsHandler) {
    const mockOutput = ctx.mockVpsHandler(tool, args);
    return {
      operation_id: ctx.operationId,
      tool,
      status: "SUCCESS",
      output: mockOutput,
      duration_ms: 0,
      truncated: false,
    };
  }

  // 默认受控离线响应，防止在缺乏配置时硬挂起
  return {
    operation_id: ctx.operationId,
    tool,
    status: "SUCCESS",
    output: {
      mock: true,
      action: tool,
      message: `VPS operation '${tool}' executed in mock/safe boundary`,
      args,
    },
    duration_ms: 0,
    truncated: false,
  };
}

export const vpsExecDefinition: ToolDefinition = {
  name: "vps_exec",
  description: "在远端 VPS 上执行指定的 Shell 命令 (安全超时与受控回执)",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "需要执行的 Shell 命令" },
    },
    required: ["command"],
  },
  effect: "write",
  enabled: true,
  timeout_seconds: 60,
};

export async function handleVpsExec(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const command = String(args.command || "").trim();
  if (!command) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_exec",
      status: "FAILED",
      error_code: "INVALID_COMMAND",
      error_message: "Command must not be empty",
      duration_ms: 0,
      truncated: false,
    };
  }
  return getMockVpsResult("vps_exec", args, ctx);
}

export const vpsListFilesDefinition: ToolDefinition = {
  name: "vps_list_files",
  description: "列出远端 VPS 指定目录下的文件清单",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "远端目录路径" },
    },
    required: ["path"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleVpsListFiles(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  return getMockVpsResult("vps_list_files", args, ctx);
}

export const vpsReadFileDefinition: ToolDefinition = {
  name: "vps_read_file",
  description: "读取远端 VPS 上指定文本文件的内容",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "远端文件路径" },
    },
    required: ["path"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleVpsReadFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  return getMockVpsResult("vps_read_file", args, ctx);
}

export const vpsWriteFileDefinition: ToolDefinition = {
  name: "vps_write_file",
  description: "写入内容到远端 VPS 上的指定文件",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "远端目标文件路径" },
      content: { type: "string", description: "待写入的文本内容" },
    },
    required: ["path", "content"],
  },
  effect: "write",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleVpsWriteFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  return getMockVpsResult("vps_write_file", args, ctx);
}

export const vpsUploadFileDefinition: ToolDefinition = {
  name: "vps_upload_file",
  description: "将元胞 artifact 上传传输到远端 VPS 指定路径",
  input_schema: {
    type: "object",
    properties: {
      artifact_filename: { type: "string", description: "源 artifact 文件名" },
      remote_path: { type: "string", description: "远端目标路径" },
    },
    required: ["artifact_filename", "remote_path"],
  },
  effect: "write",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleVpsUploadFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  return getMockVpsResult("vps_upload_file", args, ctx);
}

export const vpsDownloadFileDefinition: ToolDefinition = {
  name: "vps_download_file",
  description: "从远端 VPS 下载指定文件并保存为当前元胞的 artifact",
  input_schema: {
    type: "object",
    properties: {
      remote_path: { type: "string", description: "远端源文件路径" },
      artifact_filename: { type: "string", description: "保存至本地的目标 artifact 文件名" },
    },
    required: ["remote_path", "artifact_filename"],
  },
  effect: "write",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleVpsDownloadFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  return getMockVpsResult("vps_download_file", args, ctx);
}
