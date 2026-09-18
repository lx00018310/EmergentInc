import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../src/provider/openai_compatible.js";
import { InfrastructureFailureError, OutcomeUnknownError } from "../src/provider/model_provider.js";

const request: any = { model: "fixture", messages: [] };
const provider = () => new OpenAICompatibleProvider({ baseUrl: "https://fixture.invalid", apiKey: "fixture-only", timeoutMs: 10 });
afterEach(() => vi.unstubAllGlobals());

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
