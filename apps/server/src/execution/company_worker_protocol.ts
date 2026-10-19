import type { PreparedModelRequest, RawModelResponse, ToolDefinition, ToolResult } from '@emergentinc/protocol';
export const COMPANY_WORKER_MAX_OUTPUT_TOKENS=8192;

/** A worker receives a task snapshot, never a company database connection. */
export interface CompanyWorkerSpec {
  schema: 1; attemptId: string; taskId: string; runId: string; fence: number;
  agent: {id: string; name: string; role: string}; instruction: string;
  model: string; maxSteps: number; maxOutputTokens: number; notSentRetries: 0 | 1; tools: ToolDefinition[];
  systemPrompt?: string;
  responseFormat?:'json_object';
  progress?:{schema:1;scopeId:string;deadlineAt:number};
  formatCorrections?:0|1;
}
export interface CompanyWorkerEvent {
  id: string; attemptId: string; fence: number; sequence: number;
  kind: 'started' | 'model' | 'tool' | 'checkpoint' | 'completed' | 'blocked' | 'failed' | 'interrupted';
  payload: Record<string, any>;
}
export interface CompanyWorkerBroker {
  authorizeModel(operationId: string, request: PreparedModelRequest, transportAttempt?:number): Promise<{permitId: string;deadlineAt?:number}>;
  authorizeTool(operationId: string, tool: string, args: Record<string, any>, progress?:{gapId:string;method:string}): Promise<void|{deadlineAt:number}>;
  controllerTool(operationId: string, tool: string, args: Record<string, any>): Promise<ToolResult>;
  controllerToolReceipt(operationId:string):Promise<ToolResult|null>;
  receipt(event: CompanyWorkerEvent): Promise<void>;
}
export interface StoredWorkerModel { state: string; attempts: number; request: PreparedModelRequest; permitId: string | null; response: RawModelResponse | null }
