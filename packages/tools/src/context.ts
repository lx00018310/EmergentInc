import * as path from "node:path";

export interface ToolContext {
  workspaceRoot: string;
  pixelId: string;
  runId: string;
  messageId: string;
  operationId: string;
  readonly executionScope?: Readonly<ExecutionToolScope>;
  signal?: AbortSignal;
  mockVpsHandler?: (action: string, args: any) => any;
  extra?: Record<string, any>;
}

export interface ExecutionToolScope {
  executionId: string;
  kind: "mission" | "trial_candidate";
  allowedTools: readonly string[];
  allowedRecipients: readonly string[];
  inputSnapshot: Readonly<Record<string, unknown>>;
}

export function getArtifactsRoot(context: ToolContext): string {
  if (context.executionScope) {
    return path.resolve(context.workspaceRoot, "evidence", context.executionScope.executionId, "artifacts");
  }
  return path.resolve(context.workspaceRoot, "live", "artifacts");
}

export function getPrivateRoot(context: ToolContext): string {
  if (context.executionScope) throw new Error("GLOBAL_PRIVATE_SCOPE_DISABLED_FOR_EXECUTION");
  return path.resolve(context.workspaceRoot, "private");
}
