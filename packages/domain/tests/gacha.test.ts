import { describe, expect, it } from "vitest";
import { GACHA_ATTRIBUTE_KEYS } from "@emergentinc/protocol";
import { nextGachaPity, randomQianjiNarrative, rarityFromAttributes, rollGacha, topGachaAttributes } from "../src/qianji/gacha.js";

describe("gacha roll", () => {
  it("gives random characters deterministic and varied visual details", () => {
    const first = randomQianjiNarrative(0);
    expect(randomQianjiNarrative(0).appearanceSpec).toBe(first.appearanceSpec);
    expect(first.appearanceSpec).toContain("，");
    expect(randomQianjiNarrative(1 << 18).appearanceSpec).not.toBe(first.appearanceSpec);
  });
  it("keeps a versioned golden result for cross-platform replay", () => {
    expect(rollGacha(42, "owner", 0)).toMatchObject({ algorithmVersion: 1, rarity: "R", guaranteed: false,
      attributes: { 谋: 1.2, 察: 0.9, 决: 1.1, 行: 1.3, 言: 1.7, 创: 1.3, 韧: 0.9, 学: 1.2 }, traitTags: [] });
  });

  it("replays every value from seed and keeps the saved mean inside its rarity", () => {
    for (let seed = 0; seed < 1000; seed++) {
      const draw = rollGacha(seed, "owner", 0);
      expect(rollGacha(seed, "owner", 0)).toEqual(draw);
      expect(rarityFromAttributes(draw.attributes)).toBe(draw.rarity);
      expect(Object.keys(draw.attributes)).toEqual([...GACHA_ATTRIBUTE_KEYS]);
      for (const key of GACHA_ATTRIBUTE_KEYS) {
        const value = draw.attributes[key];
        expect(value).toBeGreaterThanOrEqual(0.5);
        expect(value).toBeLessThanOrEqual(2);
        expect(Number.isInteger(value * 10)).toBe(true);
      }
    }
  });

  it("uses the owner pity on the tenth miss and excludes reproduction", () => {
    const seed = Array.from({ length: 100 }, (_, value) => value).find(value => ["N", "R"].includes(rollGacha(value, "owner", 0).rarity))!;
    const guaranteed = rollGacha(seed, "owner", 9);
    expect(guaranteed.rarity).toBe("SR");
    expect(guaranteed.guaranteed).toBe(true);
    expect(nextGachaPity(9, guaranteed.rarity)).toBe(0);
    expect(rollGacha(seed, "reproduction").guaranteed).toBe(false);
  });

  it("has deterministic tie order and validates inputs", () => {
    const attributes = Object.fromEntries(GACHA_ATTRIBUTE_KEYS.map(key => [key, 1])) as any;
    expect(topGachaAttributes(attributes)).toEqual(["谋", "察"]);
    expect(() => rollGacha(-1, "owner", 0)).toThrow("GACHA_SEED_INVALID");
    expect(() => rollGacha(1, "owner", null)).toThrow("GACHA_PITY_INVALID");
  });

  it("keeps the pre-pity rarity mix near the configured distribution", () => {
    const counts = { N: 0, R: 0, SR: 0, SSR: 0 };
    for (let seed = 0; seed < 10_000; seed++) counts[rollGacha(seed, "owner", 0).rarity]++;
    expect(counts.N / 10_000).toBeGreaterThan(0.33);
    expect(counts.N / 10_000).toBeLessThan(0.37);
    expect(counts.R / 10_000).toBeGreaterThan(0.43);
    expect(counts.R / 10_000).toBeLessThan(0.47);
    expect(counts.SR / 10_000).toBeGreaterThan(0.13);
    expect(counts.SR / 10_000).toBeLessThan(0.17);
    expect(counts.SSR / 10_000).toBeGreaterThan(0.03);
    expect(counts.SSR / 10_000).toBeLessThan(0.07);
  });
});
