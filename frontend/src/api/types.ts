/**
 * 严格前端 API DTO 与联合类型定义
 */

export interface PixelActivityDto {
  round: number;
  action: string;
  intent: string;
  result: string;
  work_output?: unknown;
}

export interface PixelSummaryDto {
  id: string;
  position: [number, number, number];
  active: boolean;
  energy: number;
  resource?: number;
  parent: string | null;
  born_round: number;
  last_active_round?: number;
  generation: number;
  neighbors: string[];
  capabilities?: string[];
  pixel_md: string;
  pixel_md_length: number;
  tips_md: string;
  tips_version: string;
  artifacts_count: number;
  latest_activity?: PixelActivityDto | null;
}

export interface MessageFlowDto {
  source?: string;
  target?: string;
  from?: string;
  to?: string;
  message_id?: string;
  round?: number;
}

export interface MandateDto {
  pixel_id: string;
  mandate: string | null;
}

export interface ExternalRewardDto {
  event_id: string;
  pixel_id: string;
  round: number;
  amount: number;
  source: string;
  reason: string;
  created_at: number;
}

export interface StepCostDto {
  pixelId: string;
  round: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  actualTokens?: number | null;
  modelCost: number | null;
  toolCost: number | null;
  callId?: string;
  runId?: string;
  outcome?: string;
}

export interface WorldMetricsDto {
  alive_pixels?: number;
  total_pixels?: number;
  total_energy?: number;
  total_spent_tokens?: number | null;
  total_spent_cny?: number | null;
  system_status?: string;
  [key: string]: unknown;
}

export interface WorldDto {
  round: number;
  pixels: PixelSummaryDto[];
  environment_md: string;
  metrics: WorldMetricsDto;
  latest_message_flow: MessageFlowDto[];
  problems?: unknown[];
  owner_requests?: unknown[];
}

export interface RunStatusDto {
  running: boolean;
  requested_rounds: number;
  completed_rounds: number;
  messages_processed: number;
  model_calls_completed: number;
  idle_rounds: number;
  current_round: number;
  stop_requested: boolean;
  stop_reason: string | null;
  run_id: string | null;
  current_run?: string | null;
  last_error: string | null;
  error_code?: string | null;
  error_summary?: string | null;
  error_phase?: string | null;
  result_status: string | null;
  unfinalized_operations?: {
    hasUnfinalized?: boolean;
    unsettledReservations?: Array<{ callId: string; runId: string; pixelId: string; amount: number; createdAt: number }>;
    unknownCalls?: Array<{ callId: string; messageId: string; outcome: string; createdAt: number }>;
    callingMessages?: Array<{ messageId: string; status: string; updatedAt: number }>;
    pendingRuns?: string[];
    startedToolExecutions?: string[];
  } | null;
}

export interface RunStartRequest {
  rounds: number;
  command?: string; // Deprecated; controls do not dispatch messages.
  run_budget_tokens: number;
  global_budget_tokens: number;
}

export interface PromptDto {
  active: boolean;
  content: string;
  revision: number;
  hash?: string;
  updated_at?: string;
}

export interface ToolSpecDto {
  name: string;
  description: string;
  effect: 'read' | 'modify' | 'external' | string;
  enabled: boolean;
  timeout_seconds: number;
  input_schema: Record<string, unknown>;
}

export interface ToolExecutionDto {
  operation_id: string;
  run_id: string;
  message_id: string;
  pixel_id: string;
  op_index: number;
  tool: string;
  args_hash: string;
  status: 'STARTED' | 'SUCCESS' | 'FAILED' | 'UNKNOWN' | string;
  started_at: number;
  finished_at?: number | null;
  result?: {
    status?: string;
    output?: unknown;
    error_code?: string;
    error_message?: string;
    [key: string]: unknown;
  } | null;
}

export interface PrivateFileItemDto {
  name: string;
  type: 'file' | 'directory';
  size_bytes: number;
  path: string;
  is_sensitive: boolean;
}

export interface PrivateFilesResponseDto {
  files: PrivateFileItemDto[];
  base_path: string;
}

export interface ArtifactItemDto {
  filename: string;
  size_bytes: number;
  mtime?: number;
}

export interface PixelArtifactsResponseDto {
  pixel_id: string;
  artifacts: (string | { filename: string; size_bytes: number })[];
}

export interface PixelArtifactResponseDto {
  pixel_id: string;
  filename: string;
  content: string;
}

export interface PixelDocumentResponseDto {
  pixel_id: string;
  document: string;
  content: string;
}

export interface EnvironmentResponseDto {
  content: string;
}

export interface WorkspaceAuditDto {
  audit_status: string;
  allowed_to_start: boolean;
  recovery_required: boolean;
  block_reasons: string[];
  [key: string]: unknown;
}
