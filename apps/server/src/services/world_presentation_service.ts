import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { containedPath } from "./safe_path.js";

export interface WorldPresentation {
  organizationName: string;
  hallName: string;
  sectionLabels: Record<string, string>;
  eventLabels: Record<string, string>;
  revision: number;
}

const DEFAULT_SECTION_LABELS = {
  members: "人物",
  events: "最近事件",
  energyCost: "能量与成本",
  engine: "Engine",
};
const DEFAULT_EVENT_LABELS = {
  QIANJI_PROFILE_CREATED: "人物建立",
  QIANJI_NARRATIVE_UPDATED: "人设更新",
  QIANJI_BOUND: "绑定载体",
  QIANJI_UNBOUND: "解除绑定",
  QIANJI_RETIRED: "人物退役",
};

const DEFAULT_PRESENTATION: WorldPresentation = {
  organizationName: "EmergentInc 元胞会社",
  hallName: "天机阁",
  sectionLabels: DEFAULT_SECTION_LABELS,
  eventLabels: DEFAULT_EVENT_LABELS,
  revision: 0,
};

function parseLabels(value: unknown, defaults: Record<string, string>): Record<string, string> {
  if (value === undefined) return { ...defaults };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORLD_PRESENTATION_INVALID");
  const labels = value as Record<string, unknown>;
  if (Object.keys(labels).some(key => !Object.prototype.hasOwnProperty.call(defaults, key))) throw new Error("WORLD_PRESENTATION_INVALID");
  const result = { ...defaults };
  for (const [key, rawLabel] of Object.entries(labels)) {
    if (typeof rawLabel !== "string" || !rawLabel.trim() || Array.from(rawLabel).length > 80 || /[<>`{};\r\n\x00-\x1f]/.test(rawLabel)) {
      throw new Error("WORLD_PRESENTATION_INVALID");
    }
    result[key] = rawLabel;
  }
  return result;
}

function parsePresentation(value: unknown): WorldPresentation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("WORLD_PRESENTATION_INVALID");
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !["organizationName", "hallName", "sectionLabels", "eventLabels", "revision"].includes(key))) {
    throw new Error("WORLD_PRESENTATION_INVALID");
  }
  if (typeof raw.organizationName !== "string" || typeof raw.hallName !== "string" ||
      !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) {
    throw new Error("WORLD_PRESENTATION_INVALID");
  }
  if (!raw.organizationName.trim() || Array.from(raw.organizationName).length > 80 ||
      !raw.hallName.trim() || Array.from(raw.hallName).length > 80) {
    throw new Error("WORLD_PRESENTATION_INVALID");
  }
  return {
    organizationName: raw.organizationName,
    hallName: raw.hallName,
    sectionLabels: parseLabels(raw.sectionLabels, DEFAULT_SECTION_LABELS),
    eventLabels: parseLabels(raw.eventLabels, DEFAULT_EVENT_LABELS),
    revision: Number(raw.revision),
  };
}

export class WorldPresentationService {
  constructor(private readonly workspaceRoot: string) {}

  public get(): WorldPresentation {
    const file = containedPath(this.workspaceRoot, "runtime", "world_presentation.json");
    if (!fs.existsSync(file)) return { ...DEFAULT_PRESENTATION };
    try {
      return parsePresentation(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (error) {
      if (error instanceof Error && error.message === "WORLD_PRESENTATION_INVALID") throw error;
      throw new Error("WORLD_PRESENTATION_INVALID");
    }
  }

  public update(input: { expectedRevision: number; organizationName: string; hallName: string; sectionLabels?: unknown; eventLabels?: unknown }): WorldPresentation {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new Error("INVALID_EXPECTED_REVISION");
    }
    const current = this.get();
    if (input.expectedRevision !== current.revision) throw new Error("REVISION_CONFLICT");
    if (typeof input.organizationName !== "string" || !input.organizationName.trim() ||
        Array.from(input.organizationName).length > 80 ||
        typeof input.hallName !== "string" || !input.hallName.trim() || Array.from(input.hallName).length > 80) {
      throw new Error("INVALID_PRESENTATION");
    }
    const next: WorldPresentation = {
      organizationName: input.organizationName,
      hallName: input.hallName,
      sectionLabels: input.sectionLabels === undefined ? current.sectionLabels : parseLabels(input.sectionLabels, DEFAULT_SECTION_LABELS),
      eventLabels: input.eventLabels === undefined ? current.eventLabels : parseLabels(input.eventLabels, DEFAULT_EVENT_LABELS),
      revision: current.revision + 1,
    };
    const file = containedPath(this.workspaceRoot, "runtime", "world_presentation.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = containedPath(this.workspaceRoot, "runtime", "world_presentation." + randomUUID() + ".tmp");
    try {
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, file);
    } catch (error) {
      try { fs.rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
    return next;
  }
}
