import * as path from "node:path";

export interface ToolContext {
  workspaceRoot: string;
  pixelId: string;
  runId: string;
  messageId: string;
  operationId: string;
  signal?: AbortSignal;
  mockVpsHandler?: (action: string, args: any) => any;
  extra?: Record<string, any>;
}

export function getArtifactsRoot(context: ToolContext): string {
  return path.resolve(context.workspaceRoot, "live", "artifacts");
}

export function getPrivateRoot(context: ToolContext): string {
  return path.resolve(context.workspaceRoot, "private");
}
