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
    const url = `${this.baseUrl}/chat/completions`;
    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort(new Error("REQUEST_TIMEOUT"));
    }, this.timeoutMs);

    if (signal) {
      signal.addEventListener("abort", () => {
        controller.abort(signal.reason);
      });
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
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

      // 处理 HTTP 状态码
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          throw new InfrastructureFailureError(
            `Authentication failed (${response.status}): ${errorText}`
          );
        }
        if (response.status >= 500) {
          // 5xx 网关超时等场景，请求已被网关接收，结果无法确知是否计费
          throw new OutcomeUnknownError(
            `Remote server error / gateway timeout (${response.status}): ${errorText}`
          );
        }
        throw new InfrastructureFailureError(
          `Model API request rejected (${response.status}): ${errorText}`
        );
      }

      const data: any = await response.json().catch((err) => {
        throw new OutcomeUnknownError(
          `Failed to parse JSON response from model endpoint: ${err.message}`,
          err
        );
      });

      const choice = data.choices?.[0];
      const rawText = choice?.message?.content || "";
      const usage = data.usage;

      return {
        rawText,
        usage: usage
          ? {
              promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
              completionTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
              cachedTokens:
                typeof usage.prompt_tokens_details?.cached_tokens === "number"
                  ? usage.prompt_tokens_details.cached_tokens
                  : (typeof usage.cached_tokens === "number" ? usage.cached_tokens : 0),
            }
          : undefined,
      };
    } catch (err: any) {
      if (err instanceof OutcomeUnknownError || err instanceof InfrastructureFailureError) {
        throw err;
      }
      const isAbort = controller.signal.aborted || err?.name === "AbortError" || String(err?.message || "").includes("aborted");
      const reasonMsg = controller.signal.reason?.message || err?.message || "";
      if (isAbort) {
        throw new OutcomeUnknownError(
          `Model call aborted or timed out during request/stream (${this.timeoutMs}ms): ${reasonMsg}`,
          err
        );
      }
      // 连接拒绝、DNS 未能解析等明确未发出/未连接错误
      throw new InfrastructureFailureError(
        `Infrastructure failure connecting to model endpoint: ${err.message}`,
        err
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
