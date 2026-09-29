import { describe, expect, it } from "vitest";
import { deriveBirthIdentity } from "../src/qianji/birth.js";

describe("birth hexagram", () => {
  it("uses lower bits for lower trigram and flips the moving line from bottom", () => {
    const birth = deriveBirthIdentity("20"); // 水山蹇, moving line 1
    expect(birth.primaryHexagram).toBe("水山蹇");
    expect(birth.movingLine).toBe(1);
    expect(birth.changedHexagram).toBe("水火既济");
    expect(birth.primaryBits ^ (1 << (birth.movingLine - 1))).toBe(birth.changedBits);
  });

  it("is deterministic, reversible and keeps birth text within 50-100 characters", () => {
    for (let seed = 0; seed < 384; seed++) {
      const first = deriveBirthIdentity(String(seed));
      expect(deriveBirthIdentity(String(seed))).toEqual(first);
      expect(first.changedBits ^ (1 << (first.movingLine - 1))).toBe(first.primaryBits);
      expect(Array.from(first.birthText).length).toBeGreaterThanOrEqual(50);
      expect(Array.from(first.birthText).length).toBeLessThanOrEqual(100);
    }
  });
});
