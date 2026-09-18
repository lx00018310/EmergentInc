import { PreparedModelRequest, RawModelResponse } from "@emergentinc/protocol";

export type ModelErrorPhase = "before_dispatch" | "dispatch" | "response_headers" | "response_body";

export class InfrastructureFailureError extends Error {
  public readonly summary: string;
  constructor(message: string, public readonly cause?: any,
    public readonly code = "REQUEST_NOT_SENT",
    public readonly phase: ModelErrorPhase = "before_dispatch") {
    super(message);
    this.name = "InfrastructureFailureError";
    this.summary = message;
  }
}

export class OutcomeUnknownError extends Error {
  public readonly summary: string;
  constructor(message: string, public readonly cause?: any,
    public readonly code = "CALL_OUTCOME_UNKNOWN",
    public readonly phase: ModelErrorPhase = "dispatch") {
    super(message);
    this.name = "OutcomeUnknownError";
    this.summary = message;
  }
}

export interface ModelProvider {
  call(request: PreparedModelRequest, signal?: AbortSignal): Promise<RawModelResponse>;
}
