import * as fs from "node:fs";
import * as path from "node:path";
import * as childProcess from "node:child_process";
import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext, getArtifactsRoot } from "../context.js";

export interface VpsProfile {
  host: string;
  port: number;
  username: string;
  keyPath?: string;
  password?: string;
  /** 设置后所有远端路径必须落在该目录内 */
  remoteRoot?: string;
}

const MAX_LIST_LINES = 100;
const MAX_TEXT_BYTES = 16384;
const MAX_READ_LINES = 400;
const MAX_WRITE_BYTES = 262144;
const MAX_TRANSFER_BYTES = 2097152;

export function loadVpsProfile(ctx: ToolContext): VpsProfile | null {
  // 1. 优先读取工作区 private/owner_vps_profile.json
  if (ctx.workspaceRoot) {
    const vpsProfilePath = path.resolve(ctx.workspaceRoot, "private", "owner_vps_profile.json");
    if (fs.existsSync(vpsProfilePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(vpsProfilePath, "utf-8"));
        if (raw.host) {
          let keyPath: string | undefined = raw.key_path || raw.private_key_path;
          if (!keyPath && raw.key_path_env && process.env[raw.key_path_env]) {
            keyPath = process.env[raw.key_path_env];
          }
          return {
            host: String(raw.host),
            port: Number(raw.port || 22),
            username: String(raw.username || "root"),
            keyPath,
            password: raw.password ? String(raw.password) : undefined,
            remoteRoot: raw.remote_root ? String(raw.remote_root) : undefined,
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
      remoteRoot: process.env.VPS_REMOTE_ROOT || undefined,
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

interface AccessFailure {
  code: string;
  message: string;
}

/** 检查执行所需凭据；是否允许调用由 ToolRegistry 的 enabled 唯一决定。 */
function checkVpsPrerequisites(
  profile: VpsProfile | null,
  subject: string
): AccessFailure | null {
  if (!profile) {
    return {
      code: "CAPABILITY_UNAVAILABLE",
      message: `VPS operation '${subject}' unavailable: missing owner_vps_profile.json or remote credentials`,
    };
  }

  if (!profile.keyPath) {
    if (profile.password) {
      return {
        code: "AUTH_METHOD_UNSUPPORTED",
        message:
          `VPS operation '${subject}' cannot authenticate: the non-interactive OpenSSH adapter does not support password auth. ` +
          "Replace the 'password' field with 'key_path' (or set VPS_KEY_PATH) pointing to a private key authorized on the host.",
      };
    }
    return {
      code: "AUTH_METHOD_MISSING",
      message: `VPS operation '${subject}' cannot authenticate: owner_vps_profile.json has no key_path and no credential environment variable is set`,
    };
  }

  if (!fs.existsSync(profile.keyPath)) {
    return {
      code: "AUTH_KEY_NOT_FOUND",
      message: `VPS operation '${subject}' cannot authenticate: private key '${profile.keyPath}' does not exist`,
    };
  }

  return null;
}

function quoteRemote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const SHELL_CONTROL_CHARS = /[\x00-\x1f;`|&$><\n\r]/;

/** 不依赖配置的入参形态校验：必须在凭据门之前执行，保证参数错误优先于能力错误 */
function validateRemotePathShape(rawPath: string): { valid: boolean; code?: string; error?: string } {
  if (!rawPath) {
    return { valid: false, code: "INVALID_PATH", error: "Path must not be empty" };
  }
  if (SHELL_CONTROL_CHARS.test(rawPath)) {
    return {
      valid: false,
      code: "INVALID_PATH",
      error: "Path contains prohibited shell control characters",
    };
  }
  return { valid: true };
}

function validateRemotePathScope(
  profile: VpsProfile,
  rawPath: string
): { valid: boolean; error?: string; code?: string } {
  if (profile.remoteRoot) {
    const root = path.posix.normalize(profile.remoteRoot).replace(/\/+$/, "");
    const target = path.posix.normalize(rawPath);
    if (target !== root && !target.startsWith(`${root}/`)) {
      return {
        valid: false,
        code: "PATH_OUT_OF_SCOPE",
        error: `Path is outside the configured remote_root '${root}'`,
      };
    }
  }
  return { valid: true };
}

const ARTIFACT_NAME_FORBIDDEN = /[<>"\/\\|?*:\0]/;

function validateArtifactName(filename: string): string | null {
  if (!filename || filename.includes("..") || ARTIFACT_NAME_FORBIDDEN.test(filename)) {
    return "Invalid artifact filename: directory traversal, separators or forbidden characters";
  }
  return null;
}

interface ProcessOutcome {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  aborted: boolean;
  abortReason?: string;
  timeoutMs: number;
  spawnError?: string;
}

function runSsh(
  profile: VpsProfile,
  remoteCommand: string,
  timeoutMs: number,
  signal?: AbortSignal,
  stdinData?: Buffer
): Promise<ProcessOutcome> {
  return new Promise((resolve) => {
    const args = [
      "-p", String(profile.port),
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=5",
      "-o", "IdentitiesOnly=yes",
      "-i", String(profile.keyPath),
      `${profile.username}@${profile.host}`,
      remoteCommand,
    ];

    let proc: childProcess.ChildProcess;
    try {
      proc = childProcess.spawn(getSshExecutable(), args, { windowsHide: true });
    } catch (spawnErr: any) {
      resolve({
        code: null,
        stdout: Buffer.alloc(0),
        stderr: Buffer.alloc(0),
        timedOut: false,
        aborted: false,
        abortReason: "",
        timeoutMs,
        spawnError: spawnErr?.message || String(spawnErr),
      });
      return;
    }

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let timedOut = false;
    let aborted = false;
    let abortReason = "";
    let settled = false;

    const settle = (outcome: ProcessOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    const finish = (code: number | null) => {
      settle({
        code,
        stdout: Buffer.concat(chunks),
        stderr: Buffer.concat(errChunks),
        timedOut,
        aborted,
        abortReason,
        timeoutMs,
      });
    };

    const kill = () => {
      try {
        proc.kill();
      } catch {}
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    const onAbort = () => {
      aborted = true;
      const reason = (signal as (AbortSignal & { reason?: unknown }) | undefined)?.reason;
      abortReason = reason instanceof Error ? reason.message : reason ? String(reason) : "";
      kill();
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    proc.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      errChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    proc.on("error", (err) => {
      settle({
        code: null,
        stdout: Buffer.concat(chunks),
        stderr: Buffer.concat(errChunks),
        timedOut: false,
        aborted: false,
        abortReason,
        timeoutMs,
        spawnError: err.message,
      });
    });
    proc.on("close", finish);

    if (stdinData && proc.stdin) {
      proc.stdin.on("error", () => {
        /* remote may reject early; exit code carries the real verdict */
      });
      proc.stdin.end(stdinData);
    }
  });
}

function failureResult(
  ctx: ToolContext,
  tool: string,
  startTime: number,
  code: string,
  message: string
): ToolResult {
  return {
    operation_id: ctx.operationId,
    tool,
    status: "FAILED",
    error_code: code,
    error_message: message,
    duration_ms: Date.now() - startTime,
    truncated: false,
  };
}

function transportFailure(ctx: ToolContext, tool: string, startTime: number, outcome: ProcessOutcome): ToolResult | null {
  if (outcome.spawnError) {
    return failureResult(
      ctx,
      tool,
      startTime,
      "SSH_SPAWN_ERROR",
      `Failed to spawn SSH process: ${outcome.spawnError}`
    );
  }
  if (outcome.aborted) {
    if (outcome.timedOut || outcome.abortReason?.includes("TOOL_EXECUTION_TIMEOUT")) {
      return failureResult(
        ctx,
        tool,
        startTime,
        "TIMEOUT",
        `SSH execution timed out after ${outcome.timeoutMs}ms`
      );
    }
    return failureResult(ctx, tool, startTime, "USER_STOPPED", "SSH execution was stopped by user request");
  }
  if (outcome.timedOut) {
    return failureResult(
      ctx,
      tool,
      startTime,
      "TIMEOUT",
      `SSH execution timed out after ${outcome.timeoutMs}ms`
    );
  }
  return null;
}

function mockResult(
  ctx: ToolContext,
  tool: string,
  args: Record<string, any>,
  startTime: number
): ToolResult {
  return {
    operation_id: ctx.operationId,
    tool,
    status: "SUCCESS",
    output: ctx.mockVpsHandler!(tool, args),
    duration_ms: Date.now() - startTime,
    truncated: false,
  };
}

function truncateText(text: string, maxLines: number, maxBytes: number): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length > maxLines) {
    return {
      text: lines.slice(0, maxLines).join("\n") + `\n... [truncated ${lines.length - maxLines} lines]`,
      truncated: true,
    };
  }
  if (text.length > maxBytes) {
    return { text: text.substring(0, maxBytes) + "\n... [truncated bytes]", truncated: true };
  }
  return { text, truncated: false };
}

/** 通用读取型远端命令执行：静态准入 -> 传输 -> 文本截断 */
async function runRemoteRead(
  tool: string,
  remoteCommand: string,
  ctx: ToolContext,
  timeoutMs: number,
  maxLines: number
): Promise<ToolResult> {
  const startTime = Date.now();
  const profile = loadVpsProfile(ctx);
  const accessDenied = checkVpsPrerequisites(profile, tool);
  if (accessDenied || !profile) {
    return failureResult(ctx, tool, startTime, accessDenied?.code || "CAPABILITY_UNAVAILABLE", accessDenied?.message || "");
  }

  const outcome = await runSsh(profile, remoteCommand, timeoutMs, ctx.signal);
  const transportError = transportFailure(ctx, tool, startTime, outcome);
  if (transportError) return transportError;

  if (outcome.code !== 0) {
    return failureResult(
      ctx,
      tool,
      startTime,
      "SSH_EXECUTION_FAILED",
      outcome.stderr.toString("utf-8").trim() || `SSH exited with code ${outcome.code}`
    );
  }

  const { text, truncated } = truncateText(
    outcome.stdout.toString("utf-8").trim(),
    maxLines,
    MAX_TEXT_BYTES
  );
  return {
    operation_id: ctx.operationId,
    tool,
    status: "SUCCESS",
    output: text,
    duration_ms: Date.now() - startTime,
    truncated,
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
  enabled: false,
  timeout_seconds: 60,
};

export async function handleVpsExec(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const command = String(args.command || "").trim();
  if (!command) {
    return failureResult(ctx, "vps_exec", startTime, "INVALID_COMMAND", "Command must not be empty");
  }
  if (ctx.mockVpsHandler) {
    return mockResult(ctx, "vps_exec", args, startTime);
  }

  const profile = loadVpsProfile(ctx);
  const accessDenied = checkVpsPrerequisites(profile, "vps_exec");
  if (accessDenied || !profile) {
    return failureResult(
      ctx,
      "vps_exec",
      startTime,
      accessDenied?.code || "CAPABILITY_UNAVAILABLE",
      accessDenied?.message || ""
    );
  }

  const timeoutMs = (vpsExecDefinition.timeout_seconds || 60) * 1000;
  const outcome = await runSsh(profile, command, timeoutMs, ctx.signal);
  const transportError = transportFailure(ctx, "vps_exec", startTime, outcome);
  if (transportError) return transportError;

  const stdout = truncateText(outcome.stdout.toString("utf-8"), MAX_LIST_LINES, MAX_TEXT_BYTES);
  const stderr = truncateText(outcome.stderr.toString("utf-8"), MAX_LIST_LINES, MAX_TEXT_BYTES);
  return {
    operation_id: ctx.operationId,
    tool: "vps_exec",
    // 非零退出码是命令自身的结果，不是工具失败：如实回执 exit_code 交由模型判断
    status: "SUCCESS",
    output: {
      exit_code: outcome.code,
      stdout: stdout.text,
      stderr: stderr.text,
    },
    duration_ms: Date.now() - startTime,
    truncated: stdout.truncated || stderr.truncated,
  };
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
  enabled: false,
  timeout_seconds: 5,
};

export async function handleVpsListFiles(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const rawPath = String(args.path || "").trim();
  const shapeCheck = validateRemotePathShape(rawPath);
  if (!shapeCheck.valid) {
    return failureResult(ctx, "vps_list_files", startTime, shapeCheck.code!, shapeCheck.error!);
  }
  if (ctx.mockVpsHandler) {
    return mockResult(ctx, "vps_list_files", args, startTime);
  }

  const profile = loadVpsProfile(ctx);
  const accessDenied = checkVpsPrerequisites(profile, "vps_list_files");
  if (accessDenied || !profile) {
    return failureResult(
      ctx,
      "vps_list_files",
      startTime,
      accessDenied?.code || "CAPABILITY_UNAVAILABLE",
      accessDenied?.message || ""
    );
  }

  const scopeCheck = validateRemotePathScope(profile, rawPath);
  if (!scopeCheck.valid) {
    return failureResult(ctx, "vps_list_files", startTime, scopeCheck.code!, scopeCheck.error!);
  }

  const timeoutMs = (vpsListFilesDefinition.timeout_seconds || 5) * 1000;
  return runRemoteRead(
    "vps_list_files",
    `ls -la -- ${quoteRemote(path.posix.normalize(rawPath))}`,
    ctx,
    timeoutMs,
    MAX_LIST_LINES
  );
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
  enabled: false,
  timeout_seconds: 30,
};

export async function handleVpsReadFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const rawPath = String(args.path || "").trim();
  const shapeCheck = validateRemotePathShape(rawPath);
  if (!shapeCheck.valid) {
    return failureResult(ctx, "vps_read_file", startTime, shapeCheck.code!, shapeCheck.error!);
  }
  if (ctx.mockVpsHandler) {
    return mockResult(ctx, "vps_read_file", args, startTime);
  }

  const profile = loadVpsProfile(ctx);
  const accessDenied = checkVpsPrerequisites(profile, "vps_read_file");
  if (accessDenied || !profile) {
    return failureResult(
      ctx,
      "vps_read_file",
      startTime,
      accessDenied?.code || "CAPABILITY_UNAVAILABLE",
      accessDenied?.message || ""
    );
  }

  const scopeCheck = validateRemotePathScope(profile, rawPath);
  if (!scopeCheck.valid) {
    return failureResult(ctx, "vps_read_file", startTime, scopeCheck.code!, scopeCheck.error!);
  }

  const timeoutMs = (vpsReadFileDefinition.timeout_seconds || 30) * 1000;
  return runRemoteRead(
    "vps_read_file",
    `cat -- ${quoteRemote(path.posix.normalize(rawPath))}`,
    ctx,
    timeoutMs,
    MAX_READ_LINES
  );
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
  enabled: false,
  timeout_seconds: 30,
};

export async function handleVpsWriteFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const rawPath = String(args.path || "").trim();
  const content = typeof args.content === "string" ? args.content : "";
  const shapeCheck = validateRemotePathShape(rawPath);
  if (!shapeCheck.valid) {
    return failureResult(ctx, "vps_write_file", startTime, shapeCheck.code!, shapeCheck.error!);
  }
  if (ctx.mockVpsHandler) {
    return mockResult(ctx, "vps_write_file", args, startTime);
  }

  const profile = loadVpsProfile(ctx);
  const accessDenied = checkVpsPrerequisites(profile, "vps_write_file");
  if (accessDenied || !profile) {
    return failureResult(
      ctx,
      "vps_write_file",
      startTime,
      accessDenied?.code || "CAPABILITY_UNAVAILABLE",
      accessDenied?.message || ""
    );
  }

  const pathCheck = validateRemotePathScope(profile, rawPath);
  if (!pathCheck.valid) {
    return failureResult(ctx, "vps_write_file", startTime, pathCheck.code!, pathCheck.error!);
  }

  const payload = Buffer.from(content, "utf-8");
  if (payload.byteLength > MAX_WRITE_BYTES) {
    return failureResult(
      ctx,
      "vps_write_file",
      startTime,
      "CONTENT_TOO_LARGE",
      `Content exceeds the ${MAX_WRITE_BYTES} bytes write limit`
    );
  }

  // 内容经 stdin 传输，绝不拼进命令行，避免任何远端注入
  const remote = path.posix.normalize(rawPath);
  const overwrite = args.overwrite === true;
  const command = overwrite
    ? `cat > ${quoteRemote(remote)}`
    : `if [ -e ${quoteRemote(remote)} ]; then echo 'refusing to overwrite existing file' >&2; exit 17; fi; cat > ${quoteRemote(remote)}`;

  const timeoutMs = (vpsWriteFileDefinition.timeout_seconds || 30) * 1000;
  const outcome = await runSsh(profile, command, timeoutMs, ctx.signal, payload);
  const transportError = transportFailure(ctx, "vps_write_file", startTime, outcome);
  if (transportError) return transportError;

  if (outcome.code !== 0) {
    return failureResult(
      ctx,
      "vps_write_file",
      startTime,
      "SSH_EXECUTION_FAILED",
      outcome.stderr.toString("utf-8").trim() || `SSH exited with code ${outcome.code}`
    );
  }

  return {
    operation_id: ctx.operationId,
    tool: "vps_write_file",
    status: "SUCCESS",
    output: { path: remote, bytes_written: payload.byteLength, overwritten: overwrite },
    duration_ms: Date.now() - startTime,
    truncated: false,
  };
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
  enabled: false,
  timeout_seconds: 30,
};

export async function handleVpsUploadFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const artifactFilename = String(args.artifact_filename || "").trim();
  const rawPath = String(args.remote_path || "").trim();
  if (!artifactFilename || !rawPath) {
    return failureResult(
      ctx,
      "vps_upload_file",
      startTime,
      "INVALID_ARGS",
      "Both artifact_filename and remote_path are required"
    );
  }
  if (ctx.mockVpsHandler) {
    return mockResult(ctx, "vps_upload_file", args, startTime);
  }

  const profile = loadVpsProfile(ctx);
  const accessDenied = checkVpsPrerequisites(profile, "vps_upload_file");
  if (accessDenied || !profile) {
    return failureResult(
      ctx,
      "vps_upload_file",
      startTime,
      accessDenied?.code || "CAPABILITY_UNAVAILABLE",
      accessDenied?.message || ""
    );
  }

  const nameError = validateArtifactName(artifactFilename);
  if (nameError) {
    return failureResult(ctx, "vps_upload_file", startTime, "INVALID_ARGS", nameError);
  }

  const pathCheck = validateRemotePathScope(profile, rawPath);
  if (!pathCheck.valid) {
    return failureResult(ctx, "vps_upload_file", startTime, pathCheck.code!, pathCheck.error!);
  }

  const localFile = path.resolve(getArtifactsRoot(ctx), ctx.pixelId, artifactFilename);
  if (!fs.existsSync(localFile) || !fs.statSync(localFile).isFile()) {
    return failureResult(
      ctx,
      "vps_upload_file",
      startTime,
      "ARTIFACT_NOT_FOUND",
      `Artifact '${artifactFilename}' does not exist in this pixel's artifact directory`
    );
  }

  const size = fs.statSync(localFile).size;
  if (size > MAX_TRANSFER_BYTES) {
    return failureResult(
      ctx,
      "vps_upload_file",
      startTime,
      "FILE_TOO_LARGE",
      `Artifact is ${size} bytes, exceeding the ${MAX_TRANSFER_BYTES} bytes transfer limit`
    );
  }

  const remote = path.posix.normalize(rawPath);
  const timeoutMs = (vpsUploadFileDefinition.timeout_seconds || 30) * 1000;
  const outcome = await runSsh(
    profile,
    `cat > ${quoteRemote(remote)}`,
    timeoutMs,
    ctx.signal,
    fs.readFileSync(localFile)
  );
  const transportError = transportFailure(ctx, "vps_upload_file", startTime, outcome);
  if (transportError) return transportError;

  if (outcome.code !== 0) {
    return failureResult(
      ctx,
      "vps_upload_file",
      startTime,
      "SSH_EXECUTION_FAILED",
      outcome.stderr.toString("utf-8").trim() || `SSH exited with code ${outcome.code}`
    );
  }

  return {
    operation_id: ctx.operationId,
    tool: "vps_upload_file",
    status: "SUCCESS",
    output: { artifact_filename: artifactFilename, remote_path: remote, bytes_sent: size },
    duration_ms: Date.now() - startTime,
    truncated: false,
  };
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
  enabled: false,
  timeout_seconds: 30,
};

export async function handleVpsDownloadFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const rawPath = String(args.remote_path || "").trim();
  const artifactFilename = String(args.artifact_filename || "").trim();
  if (!rawPath || !artifactFilename) {
    return failureResult(
      ctx,
      "vps_download_file",
      startTime,
      "INVALID_ARGS",
      "Both remote_path and artifact_filename are required"
    );
  }
  if (ctx.mockVpsHandler) {
    return mockResult(ctx, "vps_download_file", args, startTime);
  }

  const profile = loadVpsProfile(ctx);
  const accessDenied = checkVpsPrerequisites(profile, "vps_download_file");
  if (accessDenied || !profile) {
    return failureResult(
      ctx,
      "vps_download_file",
      startTime,
      accessDenied?.code || "CAPABILITY_UNAVAILABLE",
      accessDenied?.message || ""
    );
  }

  const nameError = validateArtifactName(artifactFilename);
  if (nameError) {
    return failureResult(ctx, "vps_download_file", startTime, "INVALID_ARGS", nameError);
  }

  const pathCheck = validateRemotePathScope(profile, rawPath);
  if (!pathCheck.valid) {
    return failureResult(ctx, "vps_download_file", startTime, pathCheck.code!, pathCheck.error!);
  }

  const remote = path.posix.normalize(rawPath);
  const timeoutMs = (vpsDownloadFileDefinition.timeout_seconds || 30) * 1000;
  const outcome = await runSsh(profile, `cat -- ${quoteRemote(remote)}`, timeoutMs, ctx.signal);
  const transportError = transportFailure(ctx, "vps_download_file", startTime, outcome);
  if (transportError) return transportError;

  if (outcome.code !== 0) {
    return failureResult(
      ctx,
      "vps_download_file",
      startTime,
      "SSH_EXECUTION_FAILED",
      outcome.stderr.toString("utf-8").trim() || `SSH exited with code ${outcome.code}`
    );
  }

  if (outcome.stdout.byteLength > MAX_TRANSFER_BYTES) {
    return failureResult(
      ctx,
      "vps_download_file",
      startTime,
      "FILE_TOO_LARGE",
      `Remote file is ${outcome.stdout.byteLength} bytes, exceeding the ${MAX_TRANSFER_BYTES} bytes transfer limit`
    );
  }

  const artifactDir = path.resolve(getArtifactsRoot(ctx), ctx.pixelId);
  fs.mkdirSync(artifactDir, { recursive: true });
  const localFile = path.resolve(artifactDir, artifactFilename);
  fs.writeFileSync(localFile, outcome.stdout);

  return {
    operation_id: ctx.operationId,
    tool: "vps_download_file",
    status: "SUCCESS",
    output: {
      remote_path: remote,
      artifact_filename: artifactFilename,
      bytes_received: outcome.stdout.byteLength,
    },
    duration_ms: Date.now() - startTime,
    truncated: false,
  };
}
