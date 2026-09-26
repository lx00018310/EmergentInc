import { describe, it, expect, vi } from "vitest";
import {
  PromptBuilder,
  CognitiveIsolationViolation,
  repairMissingJsonClosers,
  parseAndNormalizeResponse,
  UsageMeter,
  OpenAICompatibleProvider,
} from "../src/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

describe("Model: Prompt Assembly & Hashing", () => {
  const hashFixturePath = path.resolve(
    __dirname,
    "../../../tests/fixtures/golden/prompt_hash_vector.json"
  );
  const hashFixture = JSON.parse(fs.readFileSync(hashFixturePath, "utf-8"));
  const qianjiHashFixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../tests/fixtures/golden/qianji_prompt_hash_vectors.json"), "utf-8"));

  it("should match SHA-256 hash vector from Python baseline", () => {
    const text = hashFixture.genesis_initial_content;
    const computedHash = crypto.createHash("sha256").update(text, "utf8").digest("hex");
    expect(computedHash).toBe(hashFixture.genesis_initial_sha256);
  });

  it("should enforce strict 3-input cognitive isolation", () => {
    const builder = new PromptBuilder();
    const validInputs = {
      state: { energy: 100 },
      pixelMd: "mind",
      messageMd: "msg",
    };

    const { request, promptHash, estimatedTokens } = builder.prepare(validInputs);
    expect(request.promptHash).toBe(promptHash);
    expect(estimatedTokens).toBeGreaterThan(0);

    // 违规传入第 4 项
    const invalidInputs: any = {
      ...validInputs,
      worldState: { global: "leak" },
    };
    expect(() => builder.prepare(invalidInputs)).toThrow(CognitiveIsolationViolation);
  });

  it("adds only the bound Qianji identity layer and keeps it before external input", () => {
    const builder = new PromptBuilder({ baseSystemPrompt: "constitution" });
    const base = { state: { energy: 10 }, pixelMd: "mind", messageMd: "local", external: { humanInstructions: "question" } };
    const unbound = builder.prepare(base);
    expect(unbound.promptHash).toBe(qianjiHashFixture.unboundPromptHash);
    expect(unbound.request.messages[1].content).not.toContain("=== IDENTITY ===");
    expect(unbound.request.messages[1].content.indexOf("=== EXTERNAL ===")).toBe(0);
    const identity = {
      qianjiId: "qj_golden", bindingId: "binding_golden", narrativeRevision: 2,
      displayName: "守序者", title: "校验师", roleLabel: "研究员", traits: { patience: 0.8 },
      behaviorProfile: ["先核对证据"], flaw: "谨慎过度", careerStatus: "active" as const,
    };
    const input = { ...base, identity };
    const first = builder.prepare(input);
    expect(first.promptHash).toBe(qianjiHashFixture.boundPromptHash);
    const second = builder.prepare(input);
    const content = first.request.messages[1].content;
    expect(content.indexOf("=== IDENTITY ===")).toBeLessThan(content.indexOf("=== EXTERNAL ==="));
    expect(content).toContain("Qianji ID: qj_golden");
    expect(content).not.toContain("shortBio");
    expect(content).not.toContain("appearanceSpec");
    expect(content).toContain("does not grant permissions");
    expect(second.promptHash).toBe(first.promptHash);
    expect(() => builder.prepare({ ...input, identity: { ...identity, hidden: "leak" } as any }))
      .toThrow(CognitiveIsolationViolation);
  });
});

describe("Model: JSON Repair & Response Parser", () => {
  it("should deterministically repair missing closing braces and brackets", () => {
    const broken = '{"pixel_md": "mind", "operations": [{"tool": "read_artifact", "args": {}';
    const repaired = repairMissingJsonClosers(broken);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!);
    expect(parsed.pixel_md).toBe("mind");
    expect(parsed.operations[0].tool).toBe("read_artifact");
  });

  it("should parse markdown block formatted json", () => {
    const raw = `
Here is my decision:
\`\`\`json
{
  "pixel_md": "Updated mind",
  "environment_read": true,
  "operations": [
    { "tool": "save_artifact", "args": { "filename": "test.txt", "content": "hi" } }
  ],
  "energy_transfer": [
    { "target": "1_0_0", "amount": 50 }
  ],
  "reproduce": { "direction": "UP", "initial_energy": 200 },
  "send_to": ["1_0_0"],
  "message_md": "Hello neighbor"
}
\`\`\`
Have a great day!
    `;

    const decision = parseAndNormalizeResponse(raw, "fallback");
    expect(decision.pixel_md).toBe("Updated mind");
    expect(decision.environment_read).toBe(true);
    expect(decision.operations).toHaveLength(1);
    expect(decision.operations![0].tool).toBe("save_artifact");
    expect(decision.energy_transfer).toHaveLength(1);
    expect(decision.energy_transfer![0]).toEqual({ target: "1_0_0", amount: 50 });
    expect(decision.reproduce).toEqual({ direction: "UP", initial_energy: 200 });
    expect(decision.send_to).toBe("1_0_0");
    expect(decision.message_md).toBe("Hello neighbor");
  });

  it("should truncate operations to maximum 3", () => {
    const raw = JSON.stringify({
      operations: [
        { tool: "tool_1" },
        { tool: "tool_2" },
        { tool: "tool_3" },
        { tool: "tool_4" },
      ],
    });

    const decision = parseAndNormalizeResponse(raw, "fallback");
    expect(decision.operations).toHaveLength(3);
    expect(decision.operations!.map((o) => o.tool)).toEqual(["tool_1", "tool_2", "tool_3"]);
  });

  it("should fallback to default pixel_md when missing or empty", () => {
    const raw = JSON.stringify({ message_md: "ping" });
    const decision = parseAndNormalizeResponse(raw, "fallback_content");
    expect(decision.pixel_md).toBe("fallback_content");
    expect(decision.send_to).toBe("SELF");
  });

  it("tips_md: explicit string wins (empty means clear), missing keeps fallback", () => {
    // 缺失 tips_md → 保留原 tips
    const missing = parseAndNormalizeResponse(JSON.stringify({ pixel_md: "m1" }), "old_mind", "old_tips");
    expect(missing.tips_md).toBe("old_tips");

    // 显式空字符串 = 清空 tips（不能当作缺失）
    const cleared = parseAndNormalizeResponse(JSON.stringify({ pixel_md: "m2", tips_md: "" }), "old_mind", "old_tips");
    expect(cleared.tips_md).toBe("");

    // 显式新内容 = 覆盖
    const updated = parseAndNormalizeResponse(JSON.stringify({ pixel_md: "m3", tips_md: "new tip" }), "old_mind", "old_tips");
    expect(updated.tips_md).toBe("new tip");
  });

  it("validates owner_reply length in Unicode code points and keeps old responses compatible", () => {
    expect(parseAndNormalizeResponse(JSON.stringify({ pixel_md: "mind" }), "fallback").owner_reply).toBeNull();
    expect(parseAndNormalizeResponse(JSON.stringify({ pixel_md: "mind", owner_reply: "答复" }), "fallback").owner_reply).toBe("答复");
    expect(() => parseAndNormalizeResponse(JSON.stringify({ owner_reply: "😀".repeat(2001) }), "fallback"))
      .toThrow("owner_reply exceeds 2000 Unicode code points");
  });
});

describe("Model: Usage Meter & Pricing", () => {
  it("provider preserves unknown token fields and billing usage on invalid content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: null } }], usage: { prompt_tokens: 12, total_tokens: 20 },
    }), { status: 200 })));
    try {
      const provider = new OpenAICompatibleProvider({ baseUrl: "https://model.invalid", apiKey: "test" });
      const response = await provider.call({ model: "m", messages: [], promptHash: "h" });
      expect(response.rawText).toBe("");
      expect(response.usage).toEqual({ promptTokens: 12, completionTokens: null, cachedTokens: null, actualTokens: 20 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps reasoning-only truncation out of rawText", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: { content: "", reasoning_content: "让我先梳理一下当前目标……" },
        finish_reason: "length",
      }],
      usage: { prompt_tokens: 2067, completion_tokens: 16384, total_tokens: 18451 },
    }), { status: 200 })));
    try {
      const provider = new OpenAICompatibleProvider({ baseUrl: "https://model.invalid", apiKey: "test" });
      const response = await provider.call({ model: "glm-5.3-flash", messages: [], promptHash: "h" });
      expect(response.rawText).toBe("");
      expect(response.usage?.completionTokens).toBe(16384);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("keeps missing usage/pricing unknown and honors explicit zero cache pricing", () => {
    const unknown = new UsageMeter({ models: {} });
    expect(unknown.calculateUsage({ model: "unpriced", promptTokens: 10, completionTokens: 5 }).costCny).toBeNull();
    expect(unknown.calculateUsage({ model: "unpriced" })).toEqual({
      promptTokens: null, completionTokens: null, cachedTokens: null, actualTokens: null, costCny: null,
    });
    const meter = new UsageMeter({ models: { priced: {
      input_cost_per_million: 2, output_cost_per_million: 6, cached_cost_per_million: 0,
    } } });
    expect(meter.calculateUsage({ model: "priced", promptTokens: 100, completionTokens: 0, cachedTokens: 100 }).costCny).toBe(0);
    expect(meter.calculateUsage({ model: "priced", promptTokens: 100, completionTokens: 0 }).costCny).toBeNull();
  });
  it("should accurately compute token cost in CNY", () => {
    const meter = new UsageMeter({
      models: {
        "gpt-4o-mini": {
          input_cost_per_million: 1.5,
          output_cost_per_million: 6.0,
          cached_cost_per_million: 0.75,
        },
      },
    });

    const usage = meter.calculateUsage({
      model: "gpt-4o-mini",
      promptTokens: 1000,
      cachedTokens: 200,
      completionTokens: 500,
    });

    // nonCached = 800 -> 800 * 1.5 / 1e6 = 0.0012
    // cached = 200 -> 200 * 0.75 / 1e6 = 0.00015
    // output = 500 -> 500 * 6.0 / 1e6 = 0.003
    // total = 0.00435
    expect(usage.promptTokens).toBe(1000);
    expect(usage.completionTokens).toBe(500);
    expect(usage.cachedTokens).toBe(200);
    expect(usage.actualTokens).toBe(1500);
    expect(usage.costCny).toBe(0.00435);
  });
});
