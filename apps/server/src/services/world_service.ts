import * as fs from "node:fs";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { idToCoord, getNeighbors6 } from "@emergentinc/domain";
import { getUnicodeLength } from "@emergentinc/protocol";

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
          let coord: [number, number, number] = [0, 0, 0];
          try {
            coord = idToCoord(pid) as [number, number, number];
          } catch {}

          // 1. 读取 disk 状态文件中的世代与父代数据
          const stateFile = path.resolve(pixelsDir, pid, "state.json");
          let diskState: any = null;
          if (fs.existsSync(stateFile)) {
            try {
              diskState = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
            } catch {}
          }

          // 2. 读取 pixel.md 内容与计算 Unicode 码点字数
          const pixelFile = path.resolve(pixelsDir, pid, "pixel.md");
          let pixelMd = "";
          if (fs.existsSync(pixelFile)) {
            try {
              pixelMd = fs.readFileSync(pixelFile, "utf-8");
            } catch {}
          }
          const pixelMdLength = getUnicodeLength(pixelMd);

          // 3. 统计交付物数量
          let artifactsCount = 0;
          const artifactsDir = path.resolve(liveDir, "artifacts", pid);
          if (fs.existsSync(artifactsDir)) {
            try {
              artifactsCount = fs.readdirSync(artifactsDir).length;
            } catch {}
          }

          // 4. 严格解析 parent：创世元胞为 null，子代如存在记录则输出，缺失则为 "unknown"（禁止伪标 Genesis）
          const isGenesisCoord = coord[0] === 0 && coord[1] === 0 && coord[2] === 0;
          let parentVal: string | null = null;
          if (diskState && typeof diskState.parent === "string" && diskState.parent.trim().length > 0) {
            parentVal = diskState.parent;
          } else if (isGenesisCoord) {
            parentVal = null;
          } else {
            parentVal = "unknown";
          }

          // 5. 邻居列表：前端契约定义为 string[] (即邻居元胞 ID 数组)
          const neighbors: string[] = getNeighbors6(pid).filter((nId) =>
            fs.existsSync(path.resolve(pixelsDir, nId))
          );

          pixelItems.push({
            id: pid,
            position: coord,
            energy: account?.energy || 0,
            active: account ? account.active : false,
            parent: parentVal,
            born_round: typeof diskState?.born_round === "number" ? diskState.born_round : 0,
            generation: typeof diskState?.generation === "number" ? diskState.generation : (isGenesisCoord ? 0 : 1),
            last_active_round: typeof diskState?.last_active_round === "number" ? diskState.last_active_round : 0,
            pixel_md: pixelMd,
            pixel_md_length: pixelMdLength,
            artifacts_count: artifactsCount,
            neighbors,
          });
        }
      }
    }

    // 读取全局环境 environment.md
    const envFile = path.resolve(liveDir, "environment.md");
    let environmentMd = "";
    if (fs.existsSync(envFile)) {
      try {
        environmentMd = fs.readFileSync(envFile, "utf-8");
      } catch {}
    }

    // 统计全局度量与支出
    const globalBudget = this.store.budgets.getGlobalBudget();
    const totalEnergy = pixelItems.reduce((sum, p) => sum + (p.energy || 0), 0);

    const metrics = {
      alive_pixels: accounts.length,
      total_pixels: pixelItems.length,
      total_energy: totalEnergy,
      total_spent_tokens: globalBudget?.totalSpent || 0,
      total_spent_cny: 0.0,
      system_status: "READY",
    };

    // 读取最近消息流并转换为 MessageFlowDto 格式
    const recentMessages = this.store.messages.listRecentMessages(20);
    const latestMessageFlow = recentMessages.map((m) => ({
      source: m.sender,
      target: m.recipient,
      from: m.sender,
      to: m.recipient,
      message_id: m.messageId,
      round: m.roundNum,
    }));

    return {
      round: worldMeta.round || 0,
      active_pixels: accounts.length,
      pixels: pixelItems,
      environment_md: environmentMd,
      metrics,
      latest_message_flow: latestMessageFlow,
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
