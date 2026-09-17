import { ToolExecutionStatus } from "../enums.js";

/**
 * 工具调用参数
 */
export interface ToolCall {
  tool: string;
  args: Record<string, any>;
}

/**
 * 工具执行回执
 */
export interface ToolResult {
  operation_id: string;
  tool: string;
  status: ToolExecutionStatus;
  output?: any;
  error_code?: string | null;
  error_message?: string | null;
  duration_ms: number;
  truncated: boolean;
  details?: Record<string, any>;
}

/**
 * 工具规范定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, any>;
  effect: "read" | "write";
  enabled: boolean;
  timeout_seconds: number;
}
