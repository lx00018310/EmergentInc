import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { CoreStore } from "@emergentinc/persistence";
import { containedPath } from "./safe_path.js";

export interface GachaImageProvider {
  model: string;
  generate(prompt: string): Promise<Buffer>;
}

export class OpenAICompatibleImageProvider implements GachaImageProvider {
  constructor(public readonly model: string, private readonly baseUrl: string, private readonly apiKey: string) {}

  async generate(prompt: string): Promise<Buffer> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt, size: "1080x1920" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`GACHA_IMAGE_HTTP_${response.status}`);
    const result = await response.json() as { data?: Array<{ b64_json?: string }> };
    const encoded = result.data?.[0]?.b64_json;
    if (!encoded || encoded.length > 14_000_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error("GACHA_IMAGE_RESPONSE_INVALID");
    }
    return Buffer.from(encoded, "base64");
  }
}

export class GachaImageService {
  private readonly inFlight = new Set<string>();

  constructor(private readonly store: CoreStore, private readonly workspaceRoot: string,
    private readonly provider?: GachaImageProvider) {}

  start(qianjiId: string): void {
    const profile = this.store.qianji.getProfile(qianjiId);
    if (!profile?.draw) throw new Error("GACHA_DRAW_NOT_FOUND");
    if (profile.narrative.portraitAsset || profile.draw.imageStatus === "ready") throw new Error("GACHA_IMAGE_ALREADY_EXISTS");
    if (profile.draw.generationStatus !== "ready" || !profile.draw.cardPrompt) throw new Error("GACHA_PROMPT_NOT_READY");
    if (!this.provider) throw new Error("GACHA_IMAGE_NOT_CONFIGURED");
    if (this.inFlight.has(qianjiId)) return;
    this.store.gacha.beginImage(qianjiId, this.provider.model);
    this.inFlight.add(qianjiId);
    void this.generate(qianjiId, profile.draw.cardPrompt).catch(error => {
      this.store.gacha.failImage(qianjiId, error instanceof Error ? error.message : String(error));
    }).finally(() => this.inFlight.delete(qianjiId));
  }

  private async generate(qianjiId: string, prompt: string): Promise<void> {
    const bytes = await this.provider!.generate(prompt);
    if (bytes.length < 20 || bytes.length > 10 * 1024 * 1024 ||
      !bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
      !bytes.includes(Buffer.from("IEND"))) throw new Error("GACHA_IMAGE_PNG_INVALID");
    const assetId = `${createHash("sha256").update(bytes).digest("hex")}.png`;
    const directory = containedPath(this.workspaceRoot, "assets", "qianji", qianjiId);
    const assetPath = containedPath(directory, assetId);
    fs.mkdirSync(directory, { recursive: true });
    let created = false;
    try {
      if (!fs.existsSync(assetPath)) { fs.writeFileSync(assetPath, bytes, { flag: "wx" }); created = true; }
      this.store.transaction(() => {
        const profile = this.store.qianji.getProfile(qianjiId);
        if (!profile || profile.narrative.portraitAsset) throw new Error("GACHA_IMAGE_ALREADY_EXISTS");
        this.store.qianji.updateNarrative(qianjiId, profile.narrativeRevision,
          { ...profile.narrative, portraitAsset: assetId });
        this.store.gacha.finishImage(qianjiId, assetId);
        this.store.worldEvents.append({ eventType: "QIANJI_PORTRAIT_GENERATED", subjectType: "qianji",
          subjectId: qianjiId, qianjiId, sourceKey: `gacha:${qianjiId}:portrait`,
          payload: { assetId, model: this.provider!.model, promptFingerprint: profile.draw?.promptFingerprint } });
      });
    } catch (error) {
      if (created) fs.rmSync(assetPath, { force: true });
      throw error;
    }
  }
}
