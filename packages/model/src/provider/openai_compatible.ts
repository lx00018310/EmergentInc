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
  stream?: boolean;
  /** Milliseconds to wait before retrying the same request. Default 30000. */
  retryDelayMs?: number;
  /** Maximum consecutive retries after the initial attempt. Default 5. */
  maxRetries?: number;
}

// Consume SSE through its terminal marker before exposing any model decision.
// A disconnected stream remains outcome-unknown, even if it contains partial JSON.
async function readStream(response: Response, signal?: AbortSignal): Promise<any> {
  if (!response.body) throw new Error("MODEL_STREAM_BODY_MISSING");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "";
  let usage: any, model: string | undefined, finishReason: string | null = null;

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (signal?.aborted) {
        throw new Error(signal.reason?.message || "ABORTED");
      }
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          return { model, usage, choices: [{ message: { content }, finish_reason: finishReason }] };
        }
        const value = JSON.parse(data);
        if (value.error) throw new Error("MODEL_STREAM_ERROR");
        if (value.model) model = value.model;
        if (value.usage) usage = value.usage;
        const choice = value.choices?.find((entry: any) => entry.index === 0);
        if (typeof choice?.delta?.content === "string") content += choice.delta.content;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
      if (chunk.done) throw new Error("MODEL_STREAM_TRUNCATED");
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Console trace of every real LLM interaction (request/response/usage/error).
// Enabled by EMERGENT_LLM_TRACE=1 (default off to keep test output clean).
const llmTraceEnabled = (): boolean => process.env.EMERGENT_LLM_TRACE === "1";

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}… (+${flat.length - max} chars)`;
}

function logTrace(direction: "REQUEST" | "RESPONSE" | "ERROR" | "RETRY", payload: Record<string, unknown>): void {
  if (!llmTraceEnabled()) return;
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[LLM ${ts} ${direction}] ${JSON.stringify(payload)}`);
}

// Owner-directed retry policy for connection-class failures.
// A connection-class failure leaves the outcome unknown: the model may or may not
// have received (and billed) the attempt. The SAME request is retried after a fixed
// delay, at most N consecutive retries after the initial attempt; only when every
// retry fails does the final error propagate. Failed attempts never return usage,
// so their token consumption (invisible here even if the provider billed it) is
// ignored and never counted in any pixel usage statistics.
const DEFAULT_RETRY_DELAY_MS = 30_000;
const DEFAULT_MAX_RETRIES = 5;

// Retriable = outcome unknown or provably not sent. Caller-initiated aborts are
// never retried: the caller no longer wants the result.
function isRetryableFailure(err: any): boolean {
  if (err instanceof InfrastructureFailureError) {
    return err.phase === "before_dispatch" && err.code !== "ABORTED_BEFORE_DISPATCH";
  }
  if (err instanceof OutcomeUnknownError) {
    return err.code !== "ABORTED_AFTER_DISPATCH";
  }
  return false;
}

// Wait that rejects immediately if the caller aborts during the retry delay.
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error(signal.reason?.message || "ABORTED"));
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer !== undefined) clearTimeout(timer);
      reject(new Error(signal?.reason?.message || "ABORTED"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class OpenAICompatibleProvider implements ModelProvider {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private stream: boolean;
  private retryDelayMs: number;
  private maxRetries: number;

  constructor(config: OpenAICompatibleProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.stream = config.stream ?? process.env.MCL_STREAM === "1";
    const envTimeout = process.env.MCL_TIMEOUT_MS ? Number(process.env.MCL_TIMEOUT_MS) : undefined;
    this.timeoutMs = config.timeoutMs || (envTimeout && !isNaN(envTimeout) ? envTimeout : 120000);
    const envRetryDelay = process.env.MCL_RETRY_DELAY_MS ? Number(process.env.MCL_RETRY_DELAY_MS) : undefined;
    const envMaxRetries = process.env.MCL_MAX_RETRIES ? Number(process.env.MCL_MAX_RETRIES) : undefined;
    this.retryDelayMs = config.retryDelayMs ?? (envRetryDelay && !isNaN(envRetryDelay) && envRetryDelay >= 0 ? envRetryDelay : DEFAULT_RETRY_DELAY_MS);
    this.maxRetries = config.maxRetries ?? (envMaxRetries !== undefined && !isNaN(envMaxRetries) && envMaxRetries >= 0 && Number.isSafeInteger(envMaxRetries) ? envMaxRetries : DEFAULT_MAX_RETRIES);
  }

  // Retry wrapper: connection-class (outcome-unknown) failures wait retryDelayMs
  // and retry the SAME request, at most maxRetries consecutive retries; only
  // after every retry fails does the last error reach the caller.
  public async call(
    request: PreparedModelRequest,
    signal?: AbortSignal
  ): Promise<RawModelResponse> {
    let retries = 0;
    while (true) {
      try {
        return await this.callOnce(request, signal);
      } catch (err: any) {
        if (!isRetryableFailure(err) || retries >= this.maxRetries) throw err;
        retries += 1;
        logTrace("RETRY", {
          attempt: retries,
          maxRetries: this.maxRetries,
          delayMs: this.retryDelayMs,
          code: typeof err?.code === "string" ? err.code : "UNKNOWN",
        });
        try {
          await delay(this.retryDelayMs, signal);
        } catch (abortErr: any) {
          throw new InfrastructureFailureError(
            "Model call cancelled during retry wait",
            abortErr,
            "ABORTED_BEFORE_DISPATCH",
            "before_dispatch"
          );
        }
      }
    }
  }

  private async callOnce(
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

    logTrace("REQUEST", {
      model: request.model,
      promptHash: request.promptHash,
      messages: request.messages.map((m) => ({ role: m.role, content: truncate(m.content, 400) })),
      temperature: request.temperature ?? 0.2,
      maxTokens: request.maxTokens ?? 2000,
    });

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
          ...(this.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
        }),
        signal: controller.signal,
      });

      phase = "response_headers";
      if (!response.ok) {
        // A dispatched request is not evidence of non-billing, even for a rejection.
        // Do not expose arbitrary endpoint response bodies in UI diagnostics.
        logTrace("ERROR", { phase, httpStatus: response.status, code: `HTTP_${response.status}` });
        throw new OutcomeUnknownError(
          `Model endpoint returned HTTP ${response.status}; billing outcome requires review`,
          undefined, `HTTP_${response.status}`, phase
        );
      }

      phase = "response_body";
      const data: any = this.stream ? await readStream(response, controller.signal) : await response.json();

      const choice = data?.choices?.[0];
      const rawText = typeof choice?.message?.content === "string" ? choice.message.content : "";
      // 推理模型的思考文本不进入 rawText：它不是可解析的决策 JSON
      const reasoningText =
        typeof choice?.message?.reasoning_content === "string" ? choice.message.reasoning_content : "";
      const usage = data?.usage;
      const token = (value: unknown): number | null =>
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

      logTrace("RESPONSE", {
        model: data?.model ?? request.model,
        promptTokens: token(usage?.prompt_tokens),
        completionTokens: token(usage?.completion_tokens),
        totalTokens: token(usage?.total_tokens),
        finishReason: choice?.finish_reason ?? null,
        content: truncate(rawText, 1200),
        ...(rawText || !reasoningText
          ? {}
          : {
              empty_content_cause: "reasoning_only",
              reasoning: truncate(reasoningText, 400),
            }),
      });

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
      logTrace("ERROR", { phase, code, message: truncate(String(err?.message ?? err), 300) });
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
