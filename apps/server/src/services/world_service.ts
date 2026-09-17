import * as fs from "node:fs";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { idToCoord, getNeighbors6 } from "@emergentinc/domain";

export class WorldService {
  constructor(
    private workspaceRoot: string,
    private store: CoreStore
  ) {}

  public getWorldDto(): any {
    const liveDir = path.resolve(this.workspaceRoot, "live");
    const worldStateFile = path.resolve(liveDir, "world_state.json");
    let worldMeta: any = { round: 0, external_accounting: {}, counters: {} };

    if (fs.existsSync(worldStateFile)) {
      try {
        worldMeta = JSON.parse(fs.readFileSync(worldStateFile, "utf-8"));
      } catch {}
    }

    const accounts = this.store.pixels.listActivePixels();
    const activePixelIds = new Set(accounts.map((a) => a.pixelId));

    // 扫描 live/pixels 目录下的元胞
    const pixelsDir = path.resolve(liveDir, "pixels");
    const pixelItems: any[] = [];

    if (fs.existsSync(pixelsDir)) {
      const entries = fs.readdirSync(pixelsDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const pid = ent.name;
          const account = this.store.pixels.getPixelAccount(pid);
          let coord = [0, 0, 0];
          try {
            coord = idToCoord(pid);
          } catch {}

          const neighbors = getNeighbors6(pid)
            .filter((nId) => fs.existsSync(path.resolve(pixelsDir, nId)))
            .map((nId) => ({
              id: nId,
              active: activePixelIds.has(nId),
            }));

          pixelItems.push({
            id: pid,
            position: coord,
            energy: account?.energy || 0,
            active: account ? account.active : false,
            neighbors,
          });
        }
      }
    }

    return {
      round: worldMeta.round || 0,
      active_pixels: accounts.length,
      pixels: pixelItems,
      external_accounting: worldMeta.external_accounting || {
        CNY_in: 0.0,
        CNY_out: 0.0,
        USD_in: 0.0,
        USD_out: 0.0,
      },
      counters: worldMeta.counters || {
        external_requests: 0,
        capabilities_granted: 0,
        external_events: 0,
      },
    };
  }

  public getPixel(pixelId: string): any {
    const pixelDir = path.resolve(this.workspaceRoot, "live", "pixels", pixelId);
    if (!fs.existsSync(pixelDir)) {
      return null;
    }

    const account = this.store.pixels.getPixelAccount(pixelId);
    let coord = [0, 0, 0];
    try {
      coord = idToCoord(pixelId);
    } catch {}

    const pixelFile = path.resolve(pixelDir, "pixel.md");
    let pixelMd = "";
    if (fs.existsSync(pixelFile)) {
      pixelMd = fs.readFileSync(pixelFile, "utf-8");
    }

    return {
      id: pixelId,
      state: {
        id: pixelId,
        position: coord,
        energy: account?.energy || 0,
        active: account?.active || false,
        refund_deficit_tokens: account?.refundDeficitTokens || 0,
        spend_blocked_reason: account?.spendBlockedReason || null,
      },
      pixel_md: pixelMd,
    };
  }

  public getPixelArtifactPath(pixelId: string, filename: string): string {
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      throw new Error("Invalid artifact filename: directory traversal forbidden");
    }
    const artifactsDir = path.resolve(this.workspaceRoot, "live", "artifacts", pixelId);
    const target = path.resolve(artifactsDir, filename);
    if (!target.startsWith(artifactsDir) || !fs.existsSync(target)) {
      throw new Error(`Artifact '${filename}' not found`);
    }
    return target;
  }

  public getEnvironment(): { content: string } {
    const envPath = path.resolve(this.workspaceRoot, "live", "environment.md");
    if (!fs.existsSync(envPath)) {
      return { content: "" };
    }
    return { content: fs.readFileSync(envPath, "utf-8") };
  }

  public updateEnvironment(content: string): { status: string; length: number } {
    const envPath = path.resolve(this.workspaceRoot, "live", "environment.md");
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, content, "utf-8");
    return { status: "UPDATED", length: content.length };
  }
}
