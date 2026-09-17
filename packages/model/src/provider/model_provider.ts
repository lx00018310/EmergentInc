import { PreparedModelRequest, RawModelResponse } from "@emergentinc/protocol";

export class InfrastructureFailureError extends Error {
  constructor(message: string, public readonly cause?: any) {
    super(message);
    this.name = "InfrastructureFailureError";
  }
}

export class OutcomeUnknownError extends Error {
  constructor(message: string, public readonly cause?: any) {
    super(message);
    this.name = "OutcomeUnknownError";
  }
}

export interface ModelProvider {
  call(
    request: PreparedModelRequest,
    signal?: AbortSignal
  ): Promise<RawModelResponse>;
}
