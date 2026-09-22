import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/provider/openai_compatible.js";
import { InfrastructureFailureError, OutcomeUnknownError } from "../src/provider/model_provider.js";

const request: any = { model: "fixture", messages: [] };
const provider = () => new OpenAICompatibleProvider({ baseUrl: "https://fixture.invalid", apiKey: "fixture-only", timeoutMs: 10 });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Optional streaming transport", () => {
  const streamed = () => new OpenAICompatibleProvider({ baseUrl: "https://fixture.invalid", apiKey: "fixture-only", stream: true });
  function response(events: string) {
    // One byte per chunk exercises split UTF-8 characters and event boundaries.
    const bytes = new TextEncoder().encode(events);
    return new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
  }
  it("assembles content, ignores reasoning, and requests final measured usage", async () => {
    const fetch = vi.fn().mockResolvedValue(response(
      ': keepalive\r\n\r\ndata: {"choices":[{"index":0,"delta":{"reasoning_content":"private reasoning"}}]}\r\n\r\n' +
      'data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":5,"total_tokens":8,"prompt_tokens_details":{"cached_tokens":0}}}\n\n' +
      'data: [DONE]\n\n'));
    vi.stubGlobal("fetch", fetch);
    expect(await streamed().call(request)).toEqual({ rawText: "你好", usage: { promptTokens: 3, completionTokens: 5, actualTokens: 8, cachedTokens: 0 } });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });
  it.each([
    'data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n',
    'data: {"error":{"message":"private upstream details"}}\n\n',
    'data: invalid-json\n\n',
  ])("keeps incomplete or failed streams outcome-unknown", async (events) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(events)));
    await expect(streamed().call(request)).rejects.toMatchObject({ name: "OutcomeUnknownError", phase: "response_body" });
  });
  it("does not invent usage for a completed stream without billing data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response('data: [DONE]\n\n')));
    expect(await streamed().call(request)).toEqual({ rawText: "", usage: undefined });
  });
  it("allows an explicit config to override the environment", async () => {
    vi.stubEnv("MCL_STREAM", "1");
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) });
    vi.stubGlobal("fetch", fetch);
    await new OpenAICompatibleProvider({ baseUrl: "https://fixture.invalid", apiKey: "fixture", stream: false }).call(request);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("stream");
  });
});

describe("Model transport outcome classification", () => {
  it.each(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"])("proves non-dispatch only for %s", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), { cause: { code } })));
    await expect(provider().call(request)).rejects.toMatchObject({ name: "InfrastructureFailureError", code, phase: "before_dispatch" });
  });
  it.each(["UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "UNKNOWN"])("keeps %s uncertain", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("fetch failed"), { cause: { code } })));
    await expect(provider().call(request)).rejects.toMatchObject({ name: "OutcomeUnknownError", code, phase: "dispatch" });
  });
  it("retains truncation code and body phase", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.reject(Object.assign(new Error("terminated"), { cause: { code: "UND_ERR_SOCKET" } })) }));
    await expect(provider().call(request)).rejects.toMatchObject({ code: "UND_ERR_SOCKET", phase: "response_body" });
  });
  it.each([401, 429, 500, 504])("does not refund dispatched HTTP %s", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(provider().call(request)).rejects.toMatchObject({ name: "OutcomeUnknownError", code: `HTTP_${status}`, phase: "response_headers" });
  });
  it("never dispatches already-aborted requests", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController(); controller.abort();
    await expect(provider().call(request, controller.signal)).rejects.toBeInstanceOf(InfrastructureFailureError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps timeout after dispatch unknown", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))))));
    await expect(provider().call(request)).rejects.toMatchObject({ name: "OutcomeUnknownError", code: "REQUEST_TIMEOUT" });
  });
  it("keeps user abort after dispatch unknown", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      controller.abort();
    })));
    await expect(provider().call(request, controller.signal)).rejects.toBeInstanceOf(OutcomeUnknownError);
  });
});
