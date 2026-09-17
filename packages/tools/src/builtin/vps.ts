import * as fs from "node:fs";
import * as path from "node:path";
import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext } from "../context.js";

function resolveVpsExecution(
  tool: string,
  args: Record<string, any>,
  ctx: ToolContext
): ToolResult {
  // 1. 优先使用显式注入的测试 Mock Handler
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

  // 2. 检查工作区与私有凭据是否存在有效 VPS 配置
  const vpsProfilePath = path.resolve(ctx.workspaceRoot, "private", "owner_vps_profile.json");
  const hasEnvConfig = Boolean(process.env.VPS_HOST && (process.env.VPS_PASSWORD || process.env.VPS_KEY));
  const hasFileConfig = fs.existsSync(vpsProfilePath);

  if (!hasEnvConfig && !hasFileConfig) {
    return {
      operation_id: ctx.operationId,
      tool,
      status: "FAILED",
      error_code: "CAPABILITY_UNAVAILABLE",
      error_message: `VPS operation '${tool}' unavailable: missing owner_vps_profile.json or remote credentials`,
      duration_ms: 0,
      truncated: false,
    };
  }

  // 3. 具备配置但未装配远端 SSH Client 时，明确报告能力未就绪
  return {
    operation_id: ctx.operationId,
    tool,
    status: "FAILED",
    error_code: "CAPABILITY_UNAVAILABLE",
    error_message: `VPS operation '${tool}' failed: remote SSH connection client is not configured`,
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
  return resolveVpsExecution("vps_exec", args, ctx);
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
  const targetPath = String(args.path || "").trim();
  if (!targetPath) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_list_files",
      status: "FAILED",
      error_code: "INVALID_PATH",
      error_message: "Path must not be empty",
      duration_ms: 0,
      truncated: false,
    };
  }
  return resolveVpsExecution("vps_list_files", args, ctx);
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
  const targetPath = String(args.path || "").trim();
  if (!targetPath) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_read_file",
      status: "FAILED",
      error_code: "INVALID_PATH",
      error_message: "Path must not be empty",
      duration_ms: 0,
      truncated: false,
    };
  }
  return resolveVpsExecution("vps_read_file", args, ctx);
}

export const vpsWriteFileDefinition: ToolDefinition = {
  name: "vps_write_file",
  description: "写入内容到远端 VPS 上的指定文件",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "远端目标文件路径" },
      content: { type: "string", description: "待写入的文本内容" },
      overwrite: { type: "boolean", description: "是否允许覆盖已有文件" },
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
  const targetPath = String(args.path || "").trim();
  if (!targetPath) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_write_file",
      status: "FAILED",
      error_code: "INVALID_PATH",
      error_message: "Path must not be empty",
      duration_ms: 0,
      truncated: false,
    };
  }
  return resolveVpsExecution("vps_write_file", args, ctx);
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
  const artifactFilename = String(args.artifact_filename || "").trim();
  const remotePath = String(args.remote_path || "").trim();
  if (!artifactFilename || !remotePath) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_upload_file",
      status: "FAILED",
      error_code: "INVALID_ARGS",
      error_message: "Both artifact_filename and remote_path are required",
      duration_ms: 0,
      truncated: false,
    };
  }
  return resolveVpsExecution("vps_upload_file", args, ctx);
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
  const remotePath = String(args.remote_path || "").trim();
  const artifactFilename = String(args.artifact_filename || "").trim();
  if (!remotePath || !artifactFilename) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_download_file",
      status: "FAILED",
      error_code: "INVALID_ARGS",
      error_message: "Both remote_path and artifact_filename are required",
      duration_ms: 0,
      truncated: false,
    };
  }
  return resolveVpsExecution("vps_download_file", args, ctx);
}
