import { describe, expect, it, vi } from "vitest";
import { CoreStore } from "@emergentinc/persistence";
import { GachaService } from "../src/services/gacha_service.js";
import { GachaImageService } from "../src/services/gacha_image.js";
import { buildGachaPrompt, gachaMotifCount } from "@emergentinc/domain";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import fastify from "fastify";
import { registerGachaRoutes } from "../src/routes/gacha_routes.js";

const generated = JSON.stringify({ title: "明察", shortBio: "曾远行四方，今入阁修行。", flaw: "过于谨慎",
  behaviorProfile: ["先核实资料再行动"], appearanceSpec: "青年，沉静" , skillTags: ["research", "typescript", "automation"] });

describe("GachaService", () => {
  it("persists ten random cards atomically and replays an idempotent request", () => {
    const store = new CoreStore();
    try {
      const service = new GachaService({ store });
      const input = { mode: "random" as const, count: 10 as const, idempotencyKey: "ten-once" };
      const first = service.draw(input);
      const second = service.draw(input);
      expect(first).toHaveLength(10);
      expect(second.map(item => item.profile?.qianjiId)).toEqual(first.map(item => item.profile?.qianjiId));
      expect(store.db.prepare("SELECT COUNT(*) AS count FROM qianji_draws").get()).toEqual({ count: 10 });
      expect(store.gacha.getPity()).toBeLessThanOrEqual(9);
      expect(() => service.draw({ ...input, count: 1 })).toThrow(/Idempotency key/);
    } finally { store.close(); }
  });

  it("rolls back a ten-pull and pity counter when one insert fails", () => {
    const store = new CoreStore();
    try {
      store.db.exec(`CREATE TRIGGER fail_second_draw BEFORE INSERT ON qianji_draws
        WHEN (SELECT COUNT(*) FROM qianji_draws) >= 1 BEGIN SELECT RAISE(ABORT, 'SIMULATED_DRAW_FAILURE'); END;`);
      const service = new GachaService({ store });
      expect(() => service.draw({ mode: "random", count: 10, idempotencyKey: "ten-rollback" })).toThrow("SIMULATED_DRAW_FAILURE");
      expect(store.db.prepare("SELECT COUNT(*) AS count FROM qianji_draws").get()).toEqual({ count: 0 });
      expect(store.qianji.listProfiles({ limit: 200 })).toHaveLength(0);
      expect(store.gacha.getPity()).toBe(0);
    } finally { store.close(); }
  });

  it("finishes appointed narrative without changing rolled facts", async () => {
    const store = new CoreStore();
    try {
      const provider = { call: vi.fn(async () => ({ rawText: generated, usage: { promptTokens: 10, completionTokens: 20 } })) };
      const service = new GachaService({ store, provider, modelName: "test-model" });
      const card = service.draw({ mode: "appointed", count: 1, name: "观星", role: "军师", concept: "沉默谋士", idempotencyKey: "appoint-once" })[0]!;
      const id = card.profile!.qianjiId;
      const attributes = card.profile!.draw!.attributes;
      await vi.waitFor(() => expect(service.get(id).profile?.draw?.generationStatus).toBe("ready"));
      expect(service.get(id).profile?.narrative.displayName).toBe("观星");
      expect(service.get(id).profile?.draw?.attributes).toEqual(attributes);
      expect(store.db.prepare("SELECT COUNT(*) AS count FROM gacha_model_calls").get()).toEqual({ count: 1 });
    } finally { store.close(); }
  });

  it("marks invalid model output and retries narrative without rerolling", async () => {
    const store = new CoreStore();
    try {
      const provider = { call: vi.fn().mockResolvedValueOnce({ rawText: "not-json", usage: { promptTokens: 5, completionTokens: 2 } })
        .mockResolvedValueOnce({ rawText: generated, usage: { promptTokens: 10, completionTokens: 20 } }) };
      const service = new GachaService({ store, provider, modelName: "test-model" });
      const id = service.draw({ mode: "appointed", count: 1, role: "军师", concept: "审慎", idempotencyKey: "invalid-then-retry" })[0]!.profile!.qianjiId;
      const seed = store.gacha.get(id)!.seed;
      await vi.waitFor(() => expect(service.get(id).profile?.draw?.generationStatus).toBe("failed"));
      expect(store.db.prepare("SELECT COUNT(*) AS count FROM gacha_model_calls WHERE outcome='INVALID_RESPONSE'").get()).toEqual({ count: 1 });
      service.retry(id);
      await vi.waitFor(() => expect(service.get(id).profile?.draw?.generationStatus).toBe("ready"));
      expect(store.gacha.get(id)?.seed).toBe(seed);
      expect(store.db.prepare("SELECT COUNT(*) AS count FROM qianji_draws").get()).toEqual({ count: 1 });
    } finally { store.close(); }
  });

  it("keeps a portrait imported while an appointed narrative is pending", async () => {
    const store = new CoreStore();
    try {
      let release!: (value: { rawText: string; usage: { promptTokens: number; completionTokens: number } }) => void;
      const provider = { call: vi.fn(() => new Promise<{ rawText: string; usage: { promptTokens: number; completionTokens: number } }>(resolve => { release = resolve; })) };
      const service = new GachaService({ store, provider, modelName: "test-model" });
      const id = service.draw({ mode: "appointed", count: 1, role: "军师", concept: "谨慎", idempotencyKey: "portrait-while-pending" })[0]!.profile!.qianjiId;
      const profile = store.qianji.getProfile(id)!;
      const portraitAsset = `${"a".repeat(64)}.png`;
      store.qianji.updateNarrative(id, profile.narrativeRevision, { ...profile.narrative, portraitAsset });
      release({ rawText: generated, usage: { promptTokens: 10, completionTokens: 20 } });
      await vi.waitFor(() => expect(service.get(id).profile?.draw?.generationStatus).toBe("ready"));
      expect(service.get(id).profile?.narrative.portraitAsset).toBe(portraitAsset);
    } finally { store.close(); }
  });

  it("records a Github search fallback as random with a reason", async () => {
    const store = new CoreStore();
    try {
      const service = new GachaService({ store, githubSearch: async () => [] });
      const card = service.draw({ mode: "github", count: 1, role: "跑商", idempotencyKey: "github-empty" })[0]!;
      const id = card.profile!.qianjiId;
      await vi.waitFor(() => expect(service.get(id).profile?.draw?.generationStatus).toBe("ready"));
      expect(service.get(id).profile?.draw).toMatchObject({ requestedOrigin: "github", origin: "random",
        fallbackReason: "GITHUB_NO_VERIFIED_REPOSITORY", lineage: [] });
    } finally { store.close(); }
  });

  it("uses only verified public repository metadata for Github lineage and skills", async () => {
    const store = new CoreStore();
    try {
      const fetchMock = vi.fn(async (url: string) => {
        if (url.includes("/search/repositories")) return Response.json({ items: [
          { full_name: "fake/unverified", html_url: "https://elsewhere.invalid/fake/unverified" },
          { full_name: "real/project", html_url: "https://github.com/real/project" },
        ] });
        if (url.endsWith("/repos/real/project")) return Response.json({ full_name: "real/project",
          html_url: "https://github.com/real/project", private: false, language: "TypeScript",
          topics: ["automation", "agents"] });
        throw new Error(`Unexpected URL: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const provider = { call: vi.fn(async () => ({ rawText: generated, usage: { promptTokens: 10, completionTokens: 20 } })) };
      const service = new GachaService({ store, provider, modelName: "test-model" });
      const id = service.draw({ mode: "github", count: 1, role: "军师", idempotencyKey: "github-verified" })[0]!.profile!.qianjiId;
      await vi.waitFor(() => expect(service.get(id).profile?.draw?.generationStatus).toBe("ready"));
      expect(service.get(id).profile?.draw).toMatchObject({ origin: "github",
        lineage: ["https://github.com/real/project"], skillTags: ["typescript", "automation", "agents"] });
      expect(service.get(id).profile?.draw?.lineageEvidence).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); store.close(); }
  });

  it("covers all 28 attribute pairs and reproduces the prompt fingerprint", () => {
    const store = new CoreStore();
    try {
      const service = new GachaService({ store });
      const profile = service.draw({ mode: "random", count: 1, idempotencyKey: "prompt-once" })[0]!.profile!;
      expect(gachaMotifCount()).toBe(28);
      const first = buildGachaPrompt(profile.draw!, profile.narrative, profile.narrativeRevision);
      expect(buildGachaPrompt(profile.draw!, profile.narrative, profile.narrativeRevision)).toEqual(first);
      expect(profile.draw?.promptFingerprint).toBe(first.fingerprint);
    } finally { store.close(); }
  });

  it("keeps a failed image retry on the same card and reads the saved portrait", async () => {
    const store = new CoreStore();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gacha-image-"));
    try {
      const service = new GachaService({ store });
      const id = service.draw({ mode: "random", count: 1, idempotencyKey: "image-once" })[0]!.profile!.qianjiId;
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9T2F0AAAAASUVORK5CYII=", "base64");
      const generate = vi.fn().mockRejectedValueOnce(new Error("IMAGE_TEMPORARY_FAILURE")).mockResolvedValue(png);
      const images = new GachaImageService(store, root, { model: "mock-image", generate });
      images.start(id);
      await vi.waitFor(() => expect(store.gacha.get(id)?.imageStatus).toBe("failed"));
      expect(store.qianji.getProfile(id)?.narrative.portraitAsset).toBeNull();
      images.start(id);
      await vi.waitFor(() => expect(store.gacha.get(id)?.imageStatus).toBe("ready"));
      const profile = store.qianji.getProfile(id)!;
      expect(profile.narrative.portraitAsset).toMatch(/^[a-f0-9]{64}\.png$/);
      expect(fs.readFileSync(path.join(root, "assets", "qianji", id, profile.narrative.portraitAsset!))).toEqual(png);
      expect(() => images.start(id)).toThrow("GACHA_IMAGE_ALREADY_EXISTS");
      expect(generate).toHaveBeenCalledTimes(2);
    } finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("paginates more than 200 recorded draws without skipping or repeating ids", async () => {
    const store = new CoreStore();
    const app = fastify();
    try {
      const service = new GachaService({ store });
      for (let i = 0; i < 21; i++) service.draw({ mode: "random", count: 10, idempotencyKey: `history-${i}` });
      await registerGachaRoutes(app, service, store, new GachaImageService(store, os.tmpdir()));
      let next: { createdAt: number; qianjiId: string } | null = null;
      const ids: string[] = [];
      do {
        const query = next ? `&beforeCreatedAt=${next.createdAt}&beforeId=${next.qianjiId}` : "";
        const response = await app.inject({ method: "GET", url: `/gacha/history?limit=50${query}` });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.total).toBe(210);
        expect(Object.values(body.counts).reduce((sum: number, count) => sum + Number(count), 0)).toBe(210);
        ids.push(...body.items.map((item: any) => item.profile.qianjiId));
        next = body.nextCursor;
      } while (next);
      expect(ids).toHaveLength(210);
      expect(new Set(ids).size).toBe(210);
    } finally { await app.close(); store.close(); }
  });
});
