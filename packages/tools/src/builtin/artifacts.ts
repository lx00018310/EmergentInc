import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { ToolDefinition, ToolResult } from "@emergentinc/protocol";
import { ToolContext, getArtifactsRoot } from "../context.js";

const COORD_ID_PATTERN = /^-?\d+_-?\d+_-?\d+$/;
const FORBIDDEN_CHARS = /[<>"\/\\|?*:\0]/;

function isValidCoordId(pixelId: string): boolean {
  return COORD_ID_PATTERN.test(pixelId.trim());
}

function validateArtifactFilename(filename: string): { valid: boolean; error?: string } {
  if (!filename || typeof filename !== "string") {
    return { valid: false, error: "Missing or invalid 'filename'" };
  }
  const name = filename.trim();
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes(":")) {
    return {
      valid: false,
      error: "Invalid artifact filename: directory traversal or path separators forbidden",
    };
  }
  if (FORBIDDEN_CHARS.test(name)) {
    return { valid: false, error: "Invalid artifact filename: forbidden characters detected" };
  }
  return { valid: true };
}

function getPixelArtifactsDir(artifactsRoot: string, pixelId: string): string {
  if (!isValidCoordId(pixelId)) {
    throw new Error(`Invalid pixel_id format: '${pixelId}'`);
  }
  const resolvedRoot = path.resolve(artifactsRoot);
  const targetDir = path.resolve(resolvedRoot, pixelId);
  if (!targetDir.startsWith(resolvedRoot)) {
    throw new Error(`Path escape detected for pixel_id: '${pixelId}'`);
  }
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  return targetDir;
}

export const saveArtifactDefinition: ToolDefinition = {
  name: "save_artifact",
  description: "写入当前元胞空间下的文本交付物文件",
  input_schema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "交付物文件名 (不得包含路径分隔符)" },
      content: { type: "string", description: "交付物完整文本内容" },
    },
    required: ["filename", "content"],
  },
  effect: "write",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleSaveArtifact(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const pixelId = ctx.pixelId;
  if (!isValidCoordId(pixelId)) {
    return {
      operation_id: ctx.operationId,
      tool: "save_artifact",
      status: "FAILED",
      error_code: "INVALID_PIXEL_ID",
      error_message: `Invalid pixel_id format: '${pixelId}'`,
      duration_ms: 0,
      truncated: false,
    };
  }

  const filename = String(args.filename || "").trim();
  const content = String(args.content || "");
  const check = validateArtifactFilename(filename);
  if (!check.valid) {
    return {
      operation_id: ctx.operationId,
      tool: "save_artifact",
      status: "FAILED",
      error_code: "INVALID_FILENAME",
      error_message: check.error,
      duration_ms: 0,
      truncated: false,
    };
  }

  try {
    const artifactsRoot = getArtifactsRoot(ctx);
    const pDir = getPixelArtifactsDir(artifactsRoot, pixelId);
    const targetFile = path.resolve(pDir, filename);

    if (!targetFile.startsWith(pDir)) {
      return {
        operation_id: ctx.operationId,
        tool: "save_artifact",
        status: "FAILED",
        error_code: "PATH_ESCAPE",
        error_message: "Path traversal escape detected",
        duration_ms: 0,
        truncated: false,
      };
    }

    fs.writeFileSync(targetFile, content, "utf-8");
    const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    const sizeBytes = Buffer.byteLength(content, "utf-8");

    return {
      operation_id: ctx.operationId,
      tool: "save_artifact",
      status: "SUCCESS",
      output: {
        pixel_id: pixelId,
        filename,
        size_bytes: sizeBytes,
        sha256,
      },
      duration_ms: 0,
      truncated: false,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId,
      tool: "save_artifact",
      status: "FAILED",
      error_code: "WRITE_ERROR",
      error_message: err.message || String(err),
      duration_ms: 0,
      truncated: false,
    };
  }
}

export const readArtifactDefinition: ToolDefinition = {
  name: "read_artifact",
  description: "读取当前元胞空间下的交付物文件内容",
  input_schema: {
    type: "object",
    properties: {
      filename: { type: "string", description: "交付物文件名" },
      pixel_id: { type: "string", description: "元胞ID (仅允许读取当前元胞自身产物)" },
    },
    required: ["filename"],
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleReadArtifact(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const pixelId = ctx.pixelId;
  const targetPixelId = String(args.pixel_id || pixelId).trim();

  if (targetPixelId !== pixelId) {
    return {
      operation_id: ctx.operationId,
      tool: "read_artifact",
      status: "FAILED",
      error_code: "CROSS_PIXEL_FORBIDDEN",
      error_message: "CROSS_PIXEL_READ_FORBIDDEN: Cross-pixel artifact reading is strictly disabled.",
      duration_ms: 0,
      truncated: false,
    };
  }

  const filename = String(args.filename || "").trim();
  const check = validateArtifactFilename(filename);
  if (!check.valid) {
    return {
      operation_id: ctx.operationId,
      tool: "read_artifact",
      status: "FAILED",
      error_code: "INVALID_FILENAME",
      error_message: check.error,
      duration_ms: 0,
      truncated: false,
    };
  }

  try {
    const artifactsRoot = getArtifactsRoot(ctx);
    const pDir = getPixelArtifactsDir(artifactsRoot, pixelId);
    const targetFile = path.resolve(pDir, filename);

    if (!fs.existsSync(targetFile)) {
      return {
        operation_id: ctx.operationId,
        tool: "read_artifact",
        status: "FAILED",
        error_code: "FILE_NOT_FOUND",
        error_message: `Artifact '${filename}' does not exist in pixel '${pixelId}' workspace`,
        duration_ms: 0,
        truncated: false,
      };
    }

    const content = fs.readFileSync(targetFile, "utf-8");
    const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");

    return {
      operation_id: ctx.operationId,
      tool: "read_artifact",
      status: "SUCCESS",
      output: {
        pixel_id: pixelId,
        filename,
        content,
        size_bytes: Buffer.byteLength(content, "utf-8"),
        sha256,
      },
      duration_ms: 0,
      truncated: false,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId,
      tool: "read_artifact",
      status: "FAILED",
      error_code: "READ_ERROR",
      error_message: err.message || String(err),
      duration_ms: 0,
      truncated: false,
    };
  }
}

export const listArtifactsDefinition: ToolDefinition = {
  name: "list_artifacts",
  description: "列出当前元胞空间下的全部交付物文件清单",
  input_schema: {
    type: "object",
    properties: {
      pixel_id: { type: "string", description: "元胞ID (仅允许读取当前元胞自身产物)" },
    },
  },
  effect: "read",
  enabled: true,
  timeout_seconds: 30,
};

export async function handleListArtifacts(
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> {
  const pixelId = ctx.pixelId;
  const targetPixelId = String(args.pixel_id || pixelId).trim();

  if (targetPixelId !== pixelId) {
    return {
      operation_id: ctx.operationId,
      tool: "list_artifacts",
      status: "FAILED",
      error_code: "CROSS_PIXEL_FORBIDDEN",
      error_message: "CROSS_PIXEL_READ_FORBIDDEN: Cross-pixel artifact reading is strictly disabled.",
      duration_ms: 0,
      truncated: false,
    };
  }

  try {
    const artifactsRoot = getArtifactsRoot(ctx);
    const pDir = path.resolve(artifactsRoot, pixelId);

    if (!fs.existsSync(pDir)) {
      return {
        operation_id: ctx.operationId,
        tool: "list_artifacts",
        status: "SUCCESS",
        output: { pixel_id: pixelId, artifacts: [] },
        duration_ms: 0,
        truncated: false,
      };
    }

    const files = fs.readdirSync(pDir);
    const artifactsList = [];

    for (const file of files) {
      const fullPath = path.resolve(pDir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        artifactsList.push({
          filename: file,
          size_bytes: stat.size,
          updated_at: stat.mtimeMs / 1000,
        });
      }
    }

    return {
      operation_id: ctx.operationId,
      tool: "list_artifacts",
      status: "SUCCESS",
      output: { pixel_id: pixelId, artifacts: artifactsList },
      duration_ms: 0,
      truncated: false,
    };
  } catch (err: any) {
    return {
      operation_id: ctx.operationId,
      tool: "list_artifacts",
      status: "FAILED",
      error_code: "LIST_ERROR",
      error_message: err.message || String(err),
      duration_ms: 0,
      truncated: false,
    };
  }
}
