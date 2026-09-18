import {
  ModelProvider,
  InfrastructureFailureError,
  OutcomeUnknownError,
} from "./model_provider.js";
import { PreparedModelRequest, RawModelResponse } from "@emergentinc/protocol";

export interface OpenAICompatibleProviderConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export class OpenAICompatibleProvider implements ModelProvider {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    const envTimeout = process.env.MCL_TIMEOUT_MS ? Number(process.env.MCL_TIMEOUT_MS) : undefined;
    this.timeoutMs = config.timeoutMs || (envTimeout && !isNaN(envTimeout) ? envTimeout : 120000);
  }

  public async call(
    request: PreparedModelRequest,
    signal?: AbortSignal
  ): Promise<RawModelResponse> {
    if (signal?.aborted) {
      throw new InfrastructureFailureError("Model call cancelled before dispatch", undefined, "ABORTED_BEFORE_DISPATCH");
    }
    const url = `${this.baseUrl}/chat/completions`;
    const controller = new AbortController();
    let phase: "dispatch" | "response_headers" | "response_body" = "dispatch";
    const onAbort = () => controller.abort(signal?.reason);

    const timeoutId = setTimeout(() => {
      controller.abort(new Error("REQUEST_TIMEOUT"));
    }, this.timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        // Do not confuse a redirected connection failure with initial non-dispatch.
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 2000,
        }),
        signal: controller.signal,
      });

      phase = "response_headers";
      if (!response.ok) {
        // A dispatched request is not evidence of non-billing, even for a rejection.
        // Do not expose arbitrary endpoint response bodies in UI diagnostics.
        throw new OutcomeUnknownError(
          `Model endpoint returned HTTP ${response.status}; billing outcome requires review`,
          undefined, `HTTP_${response.status}`, phase
        );
      }

      phase = "response_body";
      const data: any = await response.json();

      const choice = data?.choices?.[0];
      const rawText = typeof choice?.message?.content === "string" ? choice.message.content : "";
      const usage = data?.usage;
      const token = (value: unknown): number | null =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

      return {
        rawText,
        usage: usage
          ? {
              promptTokens: token(usage.prompt_tokens),
              completionTokens: token(usage.completion_tokens),
              cachedTokens: token(usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens),
              actualTokens: token(usage.total_tokens),
            }
          : undefined,
      };
    } catch (err: any) {
      if (err instanceof OutcomeUnknownError || err instanceof InfrastructureFailureError) {
        throw err;
      }
      const isAbort = controller.signal.aborted || err?.name === "AbortError";
      const underlyingCode = err?.cause?.code ?? err?.code;
      const code = isAbort
        ? (controller.signal.reason?.message === "REQUEST_TIMEOUT" ? "REQUEST_TIMEOUT" : "ABORTED_AFTER_DISPATCH")
        : (typeof underlyingCode === "string" ? underlyingCode : "MODEL_TRANSPORT_ERROR");
      // Only these connection-establishment failures prove no request was sent.
      if (!isAbort && phase === "dispatch" && ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(code)) {
        throw new InfrastructureFailureError(`Model connection failed before dispatch (${code})`, err, code, "before_dispatch");
      }
      throw new OutcomeUnknownError(
        `Model request outcome unknown (${code}, ${phase})`, err, code, phase
      );
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
