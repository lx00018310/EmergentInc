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
    this.timeoutMs = config.timeoutMs || 45000;
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
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError") {
        // 超时属于结果不明（CALL_OUTCOME_UNKNOWN），不能确知远程是否已计费
        throw new OutcomeUnknownError(
          `Model call timed out after ${this.timeoutMs}ms: ${err.message}`,
          err
        );
      }
      // 网络拒绝连接、DNS 解析失败等属于基础设施硬失败
      throw new InfrastructureFailureError(
        `Infrastructure failure connecting to model endpoint: ${err.message}`,
        err
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // 处理 HTTP 状态码
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      if (response.status === 401 || response.status === 403) {
        throw new InfrastructureFailureError(
          `Authentication failed (${response.status}): ${errorText}`
        );
      }
      if (response.status >= 500) {
        throw new InfrastructureFailureError(
          `Remote server error (${response.status}): ${errorText}`
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
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            cachedTokens:
              usage.prompt_tokens_details?.cached_tokens ||
              usage.cached_tokens ||
              0,
          }
        : undefined,
    };
  }
}
