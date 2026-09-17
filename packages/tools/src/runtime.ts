import { ToolResult } from "@emergentinc/protocol";
import { ToolRegistry } from "./registry.js";
import { ToolContext } from "./context.js";

export class ToolRuntime {
  constructor(public readonly registry: ToolRegistry) {}

  public async execute(
    toolName: string,
    args: Record<string, any>,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const registered = this.registry.get(toolName);

    if (!registered) {
      return {
        operation_id: ctx.operationId,
        tool: toolName,
        status: "FAILED",
        error_code: "TOOL_NOT_FOUND",
        error_message: `Tool '${toolName}' is not registered in ToolRegistry`,
        duration_ms: 0,
        truncated: false,
      };
    }

    if (!registered.definition.enabled) {
      return {
        operation_id: ctx.operationId,
        tool: toolName,
        status: "FAILED",
        error_code: "TOOL_DISABLED",
        error_message: `Tool '${toolName}' is currently disabled in tools configuration`,
        duration_ms: 0,
        truncated: false,
      };
    }

    const timeoutMs = (registered.definition.timeout_seconds || 30) * 1000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort(new Error("TOOL_EXECUTION_TIMEOUT"));
    }, timeoutMs);

    if (ctx.signal) {
      ctx.signal.addEventListener("abort", () => {
        controller.abort(ctx.signal?.reason);
      });
    }

    const wrappedCtx: ToolContext = {
      ...ctx,
      signal: controller.signal,
    };

    try {
      const result = await registered.handler(args, wrappedCtx);
      clearTimeout(timeoutId);
      result.duration_ms = Date.now() - startTime;
      return result;
    } catch (err: any) {
      clearTimeout(timeoutId);
      const durationMs = Date.now() - startTime;

      if (controller.signal.aborted) {
        if (ctx.signal?.aborted) {
          return {
            operation_id: ctx.operationId,
            tool: toolName,
            status: "FAILED",
            error_code: "USER_STOPPED",
            error_message: "Tool execution was stopped by user request",
            duration_ms: durationMs,
            truncated: false,
          };
        }
        return {
          operation_id: ctx.operationId,
          tool: toolName,
          status: "FAILED",
          error_code: "TIMEOUT",
          error_message: `Tool execution timed out after ${timeoutMs}ms`,
          duration_ms: durationMs,
          truncated: false,
        };
      }

      return {
        operation_id: ctx.operationId,
        tool: toolName,
        status: "FAILED",
        error_code: "EXECUTION_ERROR",
        error_message: err.message || String(err),
        duration_ms: durationMs,
        truncated: false,
      };
    }
  }
}
