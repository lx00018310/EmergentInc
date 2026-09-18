import * as fs from "node:fs";
import * as path from "node:path";
import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext, getPrivateRoot } from "../context.js";

const SENSITIVE_FILENAME_PATTERNS = [
  /.*_profile\.json$/i,
  /.*credential.*/i,
  /.*secret.*/i,
  /^id_rsa.*/i,
  /^id_ed25519.*/i,
  /^id_dsa.*/i,
  /^id_ecdsa.*/i,
  /.*\.pem$/i,
  /.*\.key$/i,
  /.*\.ppk$/i,
];

function isSensitiveCredentialPath(filePath: string): boolean {
  const baseName = path.basename(filePath).toLowerCase();
  for (const pattern of SENSITIVE_FILENAME_PATTERNS) {
    if (pattern.test(baseName)) {
      return true;
    }
  }
  return false;
}

function resolvePrivatePath(
  privateRoot: string,
  targetPathStr: string
): { valid: boolean; resolved?: string; error?: string } {
  const rootResolved = path.resolve(privateRoot);
  const target = targetPathStr ? path.resolve(rootResolved, targetPathStr) : rootResolved;

  if (!target.startsWith(rootResolved)) {
    return {
      valid: false,
      error: "PATH_TRAVERSAL_FORBIDDEN: Target path must be strictly located within workspace/private.",
    };
  }

  return { valid: true, resolved: target };
}

export const listPrivateFilesDefinition: ToolDefinition = {
  name: "list_private_files",
  description: "安全列出 workspace/private 目录下的文件或子目录清单",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "子路径 (缺省为根目录)" },
    },
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleListPrivateFiles(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const privateRoot = getPrivateRoot(ctx);
  const subPath = String(args.path || "").trim();
  const pathCheck = resolvePrivatePath(privateRoot, subPath);

  if (!pathCheck.valid || !pathCheck.resolved) {
    return {
      operation_id: ctx.operationId,
      tool: "list_private_files",
      status: "FAILED",
      error_code: "PATH_TRAVERSAL_FORBIDDEN",
      error_message: pathCheck.error,
      duration_ms: 0,
      truncated: false,
    };
  }

  const targetDir = pathCheck.resolved;
  if (!fs.existsSync(targetDir)) {
    return {
      operation_id: ctx.operationId,
      tool: "list_private_files",
      status: "FAILED",
      error_code: "PATH_NOT_FOUND",
      error_message: `Directory '${subPath}' does not exist in workspace/private`,
      duration_ms: 0,
      truncated: false,
    };
  }

  try {
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = [];

    for (const ent of entries) {
      const full = path.resolve(targetDir, ent.name);
      const isSensitive = isSensitiveCredentialPath(full);
      const stat = fs.statSync(full);

      items.push({
        name: ent.name,
        is_dir: ent.isDirectory(),
        size_bytes: ent.isDirectory() ? 0 : stat.size,
        is_sensitive: isSensitive,
      });
    }

    return {
      operation_id: ctx.operationId,
      tool: "list_private_files",
      status: "SUCCESS",
      output: {
        path: subPath || "/",
        items,
      },
      duration_ms: 0,
      truncated: false,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId,
      tool: "list_private_files",
      status: "FAILED",
      error_code: "LIST_ERROR",
      error_message: err.message || String(err),
      duration_ms: 0,
      truncated: false,
    };
  }
}

export const readPrivateFileDefinition: ToolDefinition = {
  name: "read_private_file",
  description: "安全读取 workspace/private 下的私有文件，对敏感凭据做严格脱敏投影保护",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对 workspace/private 的文件路径" },
    },
    required: ["path"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleReadPrivateFile(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const privateRoot = getPrivateRoot(ctx);
  const filePath = String(args.path || "").trim();
  const pathCheck = resolvePrivatePath(privateRoot, filePath);

  if (!pathCheck.valid || !pathCheck.resolved) {
    return {
      operation_id: ctx.operationId,
      tool: "read_private_file",
      status: "FAILED",
      error_code: "PATH_TRAVERSAL_FORBIDDEN",
      error_message: pathCheck.error,
      duration_ms: 0,
      truncated: false,
    };
  }

  const targetFile = pathCheck.resolved;
  if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
    return {
      operation_id: ctx.operationId,
      tool: "read_private_file",
      status: "FAILED",
      error_code: "FILE_NOT_FOUND",
      error_message: `File '${filePath}' does not exist in workspace/private`,
      duration_ms: 0,
      truncated: false,
    };
  }

  // 敏感凭据保护：VPS 配置文件脱敏投影
  if (isSensitiveCredentialPath(targetFile)) {
    try {
      const rawText = fs.readFileSync(targetFile, "utf-8");
      const data = JSON.parse(rawText);
      const masked = {
        profile_id: "owner_vps",
        host: data.host,
        port: data.port || 22,
        username: data.username,
        has_password: Boolean(data.password),
        has_private_key: Boolean(data.key_path || data.private_key_path || data.key_path_env),
        allowed_operations: Array.isArray(data.allowed_operations) ? data.allowed_operations : [],
        remote_root: data.remote_root || null,
        note: "[CREDENTIAL_MASKED] Raw credentials and keys are protected and not readable.",
      };
      return {
        operation_id: ctx.operationId,
        tool: "read_private_file",
        status: "SUCCESS",
        output: {
          path: filePath,
          is_masked: true,
          content: JSON.stringify(masked, null, 2),
        },
        duration_ms: 0,
        truncated: false,
      };
    } catch {
      return {
        operation_id: ctx.operationId,
        tool: "read_private_file",
        status: "FAILED",
        error_code: "SENSITIVE_FILE_PROTECTED",
        error_message: "Access to raw private key or credential file is strictly denied.",
        duration_ms: 0,
        truncated: false,
      };
    }
  }

  try {
    const content = fs.readFileSync(targetFile, "utf-8");
    return {
      operation_id: ctx.operationId,
      tool: "read_private_file",
      status: "SUCCESS",
      output: {
        path: filePath,
        is_masked: false,
        content,
      },
      duration_ms: 0,
      truncated: false,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId,
      tool: "read_private_file",
      status: "FAILED",
      error_code: "READ_ERROR",
      error_message: err.message || String(err),
      duration_ms: 0,
      truncated: false,
    };
  }
}

export const inspectPrivateImageDefinition: ToolDefinition = {
  name: "inspect_private_image",
  description: "检查或分析 workspace/private 目录下的图片文件元数据与基本信息",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "相对 workspace/private 的图片文件路径" },
    },
    required: ["path"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleInspectPrivateImage(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const privateRoot = getPrivateRoot(ctx);
  const filePath = String(args.path || "").trim();
  const pathCheck = resolvePrivatePath(privateRoot, filePath);

  if (!pathCheck.valid || !pathCheck.resolved) {
    return {
      operation_id: ctx.operationId,
      tool: "inspect_private_image",
      status: "FAILED",
      error_code: "PATH_TRAVERSAL_FORBIDDEN",
      error_message: pathCheck.error,
      duration_ms: 0,
      truncated: false,
    };
  }

  const targetFile = pathCheck.resolved;
  if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
    return {
      operation_id: ctx.operationId,
      tool: "inspect_private_image",
      status: "FAILED",
      error_code: "FILE_NOT_FOUND",
      error_message: `Image file '${filePath}' does not exist in workspace/private`,
      duration_ms: 0,
      truncated: false,
    };
  }

  try {
    const stat = fs.statSync(targetFile);
    const ext = path.extname(targetFile).toLowerCase();

    return {
      operation_id: ctx.operationId,
      tool: "inspect_private_image",
      status: "SUCCESS",
      output: {
        path: filePath,
        format: ext.replace(".", ""),
        size_bytes: stat.size,
        description: `Inspected image asset '${filePath}' (${stat.size} bytes)`,
      },
      duration_ms: 0,
      truncated: false,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId,
      tool: "inspect_private_image",
      status: "FAILED",
      error_code: "INSPECT_ERROR",
      error_message: err.message || String(err),
      duration_ms: 0,
      truncated: false,
    };
  }
}
