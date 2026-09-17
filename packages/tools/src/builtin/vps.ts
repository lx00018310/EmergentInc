import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext } from "../context.js";

export interface VpsProfile {
  host: string;
  port: number;
  username: string;
  keyPath?: string;
  password?: string;
}

export function loadVpsProfile(ctx: ToolContext): VpsProfile | null {
  // 1. 优先读取工作区 private/owner_vps_profile.json
  if (ctx.workspaceRoot) {
    const vpsProfilePath = path.resolve(ctx.workspaceRoot, "private", "owner_vps_profile.json");
    if (fs.existsSync(vpsProfilePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(vpsProfilePath, "utf-8"));
        if (raw.host) {
          let keyPath: string | undefined = raw.key_path;
          if (!keyPath && raw.key_path_env && process.env[raw.key_path_env]) {
            keyPath = process.env[raw.key_path_env];
          }
          return {
            host: String(raw.host),
            port: Number(raw.port || 22),
            username: String(raw.username || "root"),
            keyPath,
            password: raw.password ? String(raw.password) : undefined,
          };
        }
      } catch {}
    }
  }

  // 2. 备选环境变量
  if (process.env.VPS_HOST) {
    return {
      host: process.env.VPS_HOST,
      port: Number(process.env.VPS_PORT || 22),
      username: process.env.VPS_USER || "root",
      keyPath: process.env.VPS_KEY_PATH || process.env.VPS_KEY,
      password: process.env.VPS_PASSWORD,
    };
  }

  return null;
}

function getSshExecutable(): string {
  if (process.platform === "win32") {
    const winSsh = "C:\\WINDOWS\\System32\\OpenSSH\\ssh.exe";
    if (fs.existsSync(winSsh)) {
      return winSsh;
    }
  }
  return "ssh";
}

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

  // 2. 检查是否存在有效 VPS 配置
  const profile = loadVpsProfile(ctx);
  if (!profile) {
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

  // 3. 具备配置但其余操作暂未生产原生落地，明确报告 CAPABILITY_UNAVAILABLE，坚决不静默假装成功
  return {
    operation_id: ctx.operationId,
    tool,
    status: "FAILED",
    error_code: "CAPABILITY_UNAVAILABLE",
    error_message: `VPS operation '${tool}' is currently unavailable: native implementation pending (only 'vps_list_files' is natively supported)`,
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
  description: "列出远端 VPS 指定目录下的文件清单 (原生 OpenSSH 适配器)",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "远端目录路径 (例如: /root 或 /var/log)" },
    },
    required: ["path"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 5,
};

export async function handleVpsListFiles(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const rawPath = String(args.path || "").trim();
  if (!rawPath) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_list_files",
      status: "FAILED",
      error_code: "INVALID_PATH",
      error_message: "Path must not be empty",
      duration_ms: Date.now() - startTime,
      truncated: false,
    };
  }

  // 严格安全防御：禁止 Shell 控制字符，防御注入
  if (/[\x00-\x1f;`|&$><\n\r]/.test(rawPath)) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_list_files",
      status: "FAILED",
      error_code: "INVALID_PATH",
      error_message: "Path contains prohibited shell control characters",
      duration_ms: Date.now() - startTime,
      truncated: false,
    };
  }

  // 1. 优先使用显式注入的测试 Mock Handler
  if (ctx.mockVpsHandler) {
    const mockOutput = ctx.mockVpsHandler("vps_list_files", args);
    return {
      operation_id: ctx.operationId,
      tool: "vps_list_files",
      status: "SUCCESS",
      output: mockOutput,
      duration_ms: Date.now() - startTime,
      truncated: false,
    };
  }

  // 2. 加载 VPS 凭据
  const profile = loadVpsProfile(ctx);
  if (!profile) {
    return {
      operation_id: ctx.operationId,
      tool: "vps_list_files",
      status: "FAILED",
      error_code: "CAPABILITY_UNAVAILABLE",
      error_message: "VPS operation 'vps_list_files' unavailable: missing owner_vps_profile.json or remote credentials",
      duration_ms: Date.now() - startTime,
      truncated: false,
    };
  }

  // 3. 执行原生 OpenSSH 探测
  const sshBin = getSshExecutable();
  const timeoutMs = (vpsListFilesDefinition.timeout_seconds || 5) * 1000;
  const safePath = rawPath.replace(/'/g, "'\\''");

  const sshArgs: string[] = [
    "-p", String(profile.port),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=5",
  ];

  if (profile.keyPath) {
    sshArgs.push("-i", profile.keyPath);
  }

  sshArgs.push(`${profile.username}@${profile.host}`);
  sshArgs.push(`ls -la -- '${safePath}'`);

  return new Promise((resolve) => {
    let stdoutData = "";
    let stderrData = "";
    let isTimedOut = false;

    let proc: childProcess.ChildProcess;
    try {
      proc = childProcess.spawn(sshBin, sshArgs, {
        windowsHide: true,
      });
    } catch (spawnErr: any) {
      resolve({
        operation_id: ctx.operationId,
        tool: "vps_list_files",
        status: "FAILED",
        error_code: "SSH_SPAWN_ERROR",
        error_message: `Failed to spawn SSH process: ${spawnErr.message}`,
        duration_ms: Date.now() - startTime,
        truncated: false,
      });
      return;
    }

    const timer = setTimeout(() => {
      isTimedOut = true;
      try {
        proc.kill();
      } catch {}
    }, timeoutMs);

    proc.stdout?.on("data", (chunk) => {
      stdoutData += chunk.toString();
    });

    proc.stderr?.on("data", (chunk) => {
      stderrData += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        operation_id: ctx.operationId,
        tool: "vps_list_files",
        status: "FAILED",
        error_code: "SSH_SPAWN_ERROR",
        error_message: `SSH process error: ${err.message}`,
        duration_ms: Date.now() - startTime,
        truncated: false,
      });
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (isTimedOut) {
        resolve({
          operation_id: ctx.operationId,
          tool: "vps_list_files",
          status: "FAILED",
          error_code: "TIMEOUT",
          error_message: `SSH connection timed out after ${timeoutMs}ms`,
          duration_ms: durationMs,
          truncated: false,
        });
        return;
      }

      if (code !== 0) {
        resolve({
          operation_id: ctx.operationId,
          tool: "vps_list_files",
          status: "FAILED",
          error_code: "SSH_EXECUTION_FAILED",
          error_message: stderrData.trim() || `SSH exited with code ${code}`,
          duration_ms: durationMs,
          truncated: false,
        });
        return;
      }

      // 截断控制：最多 100 行或 16KB
      const lines = stdoutData.split("\n");
      let output = stdoutData;
      let truncated = false;

      if (lines.length > 100) {
        output = lines.slice(0, 100).join("\n") + `\n... [truncated ${lines.length - 100} lines]`;
        truncated = true;
      } else if (output.length > 16384) {
        output = output.substring(0, 16384) + "\n... [truncated bytes]";
        truncated = true;
      }

      resolve({
        operation_id: ctx.operationId,
        tool: "vps_list_files",
        status: "SUCCESS",
        output: output.trim(),
        duration_ms: durationMs,
        truncated,
      });
    });
  });
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
