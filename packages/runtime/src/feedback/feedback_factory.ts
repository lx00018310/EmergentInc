import { EnqueueMessageParams } from "@emergentinc/protocol";

export class FeedbackFactory {
  public static createMindValidationFeedback(
    pixelId: string,
    round: number,
    runId: string | null,
    actualLength: number
  ): EnqueueMessageParams {
    return {
      runId,
      roundNum: round,
      sender: "system",
      recipient: pixelId,
      content: `[ENGINE_FEEDBACK] MIND_VALIDATION_FAILED: pixel.md exceeds 2000 code points limit (got ${actualLength}). Mind update was rejected.`,
      isFeedback: true,
      sourceType: "feedback",
    };
  }

  public static createCapabilityUnavailableFeedback(
    pixelId: string,
    round: number,
    runId: string | null,
    capability: string
  ): EnqueueMessageParams {
    return {
      runId,
      roundNum: round,
      sender: "system",
      recipient: pixelId,
      content: `[ENGINE_FEEDBACK] CAPABILITY_UNAVAILABLE: External owner approval/request capability '${capability}' is currently disabled in V10 runtime.`,
      isFeedback: true,
      sourceType: "feedback",
    };
  }

  public static createToolExecutionFeedback(
    pixelId: string,
    round: number,
    runId: string | null,
    toolName: string,
    status: string,
    outputOrError: any
  ): EnqueueMessageParams {
    const formatted =
      typeof outputOrError === "object"
        ? JSON.stringify(outputOrError)
        : String(outputOrError);
    return {
      runId,
      roundNum: round,
      sender: "system",
      recipient: pixelId,
      content: `[ENGINE_FEEDBACK] TOOL_${toolName.toUpperCase()}_${status}: ${formatted}`,
      isFeedback: true,
      sourceType: "feedback",
    };
  }

  public static createBatchToolExecutionFeedback(
    pixelId: string,
    round: number,
    runId: string | null,
    executions: Array<{ tool: string; status: string; outputOrError: any }>
  ): EnqueueMessageParams {
    if (executions.length === 1) {
      return this.createToolExecutionFeedback(
        pixelId,
        round,
        runId,
        executions[0].tool,
        executions[0].status,
        executions[0].outputOrError
      );
    }
    const lines = [`[ENGINE_FEEDBACK] BATCH_TOOL_EXECUTIONS (Total: ${executions.length}):`];
    for (let i = 0; i < executions.length; i++) {
      const e = executions[i];
      const formatted =
        typeof e.outputOrError === "object"
          ? JSON.stringify(e.outputOrError)
          : String(e.outputOrError);
      lines.push(`${i + 1}. ${e.tool} -> ${e.status}: ${formatted}`);
    }
    return {
      runId,
      roundNum: round,
      sender: "system",
      recipient: pixelId,
      content: lines.join("\n"),
      isFeedback: true,
      sourceType: "feedback",
    };
  }

  public static createTransferFailureFeedback(
    pixelId: string,
    round: number,
    runId: string | null,
    target: string,
    errorCode: string,
    errorMessage: string
  ): EnqueueMessageParams {
    return {
      runId,
      roundNum: round,
      sender: "system",
      recipient: pixelId,
      content: `[ENGINE_FEEDBACK] ENERGY_TRANSFER_FAILED: Target '${target}' rejected (${errorCode}): ${errorMessage}`,
      isFeedback: true,
      sourceType: "feedback",
    };
  }

  public static createReproductionFailureFeedback(
    pixelId: string,
    round: number,
    runId: string | null,
    errorCode: string,
    errorMessage: string
  ): EnqueueMessageParams {
    return {
      runId,
      roundNum: round,
      sender: "system",
      recipient: pixelId,
      content: `[ENGINE_FEEDBACK] REPRODUCTION_FAILED (${errorCode}): ${errorMessage}`,
      isFeedback: true,
      sourceType: "feedback",
    };
  }

  public static createRoutingFailureFeedback(
    pixelId: string,
    round: number,
    runId: string | null,
    recipient: string,
    errorCode: string,
    errorMessage: string
  ): EnqueueMessageParams {
    return {
      runId,
      roundNum: round,
      sender: "system",
      recipient: pixelId,
      content: `[ENGINE_FEEDBACK] MESSAGE_ROUTING_FAILED: Recipient '${recipient}' rejected (${errorCode}): ${errorMessage}`,
      isFeedback: true,
      sourceType: "feedback",
    };
  }
}
