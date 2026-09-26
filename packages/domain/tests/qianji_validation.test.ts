import { describe, expect, it } from "vitest";
import { validateQianjiNarrative } from "../src/index.js";

const validNarrative = () => ({
  displayName: "千机",
  title: null,
  roleLabel: null,
  traits: { care: 0.5 },
  behaviorProfile: ["先核对证据"],
  flaw: null,
  shortBio: null,
  appearanceSpec: null,
  portraitAsset: null,
  contentRevision: "muse-v1",
});

describe("Domain: Qianji narrative validation", () => {
  it("accepts the fixed narrative contract and counts Unicode code points", () => {
    const result = validateQianjiNarrative({ ...validNarrative(), displayName: "🪷".repeat(80) });
    expect(result.valid).toBe(true);
    if (result.valid) expect(Array.from(result.value.displayName)).toHaveLength(80);
  });

  it("rejects unknown fields, non-finite traits, and over-limit collections", () => {
    const narrative = validNarrative() as ReturnType<typeof validNarrative> & Record<string, unknown>;
    narrative.extra = true;
    narrative.traits = { confidence: Number.NaN };
    narrative.behaviorProfile = Array.from({ length: 13 }, () => "行为");
    const result = validateQianjiNarrative(narrative);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map(error => error.path)).toContain("narrative.extra");
      expect(result.errors.map(error => error.path)).toContain("narrative.traits.confidence");
      expect(result.errors.map(error => error.path)).toContain("narrative.behaviorProfile");
    }
  });

  it("rejects incorrect types and names containing only whitespace", () => {
    expect(validateQianjiNarrative({ ...validNarrative(), displayName: "   " }).valid).toBe(false);
    expect(validateQianjiNarrative({ ...validNarrative(), title: 17 }).valid).toBe(false);
    expect(validateQianjiNarrative({ ...validNarrative(), traits: [] }).valid).toBe(false);
  });
});
