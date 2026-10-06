import * as fs from "node:fs";
import * as path from "node:path";
import { GenomeManifest } from "@emergentinc/protocol";
import { LineageStore, CurrentStore } from "@emergentinc/persistence";

export { readGenome, generationDirectory, writeGenerationPointer } from "@emergentinc/persistence";
import { generationDirectory, writeGenerationPointer } from "@emergentinc/persistence";
import { lifeOverview } from "./life_overview.js";

export class LifeContext {
  constructor(readonly workspaceRoot: string, readonly genome: GenomeManifest, readonly lineage: LineageStore, readonly current: CurrentStore,readonly worldId?:string) {}
  static open(workspace: string, genome: GenomeManifest, geneHash: string, releaseId: string, pointer = path.join(workspace, "active-generation.json")) {
    const lineagePath = path.join(workspace, "lineage/lineage.sqlite3");
    if (!fs.existsSync(lineagePath) && fs.existsSync(path.join(workspace, "ledger/business.sqlite3")))
      throw new Error("V21_EXPLICIT_MIGRATION_REQUIRED");
    const lineage = new LineageStore(lineagePath);
    let current: CurrentStore | undefined;
    try {
      let active = lineage.activeGeneration();
      if (active && fs.existsSync(pointer)) {
        const pointedId = JSON.parse(fs.readFileSync(pointer, "utf8")).generation_id;
        if (pointedId !== active.id) {
          const pointed = lineage.db.prepare("SELECT * FROM generations WHERE id=?").get(pointedId);
          // Supervisor alone writes the pointer. Provisional boot stays quiesced until health succeeds.
          if (!pointed || pointed.state !== "BIRTHING" || pointed.parent_id !== active.id) throw new Error("ACTIVE_GENERATION_POINTER_MISMATCH");
          active = pointed;
        }
      }
      if (!active) {
        if (lineage.generations().length || fs.existsSync(pointer)) throw new Error("GENERATION_RECOVERY_REQUIRED");
        lineage.createGeneration({ id: "G0001", number: 1, geneHash, releaseId, state: "ACTIVE" });
        active = lineage.activeGeneration()!;
        current = new CurrentStore(path.join(generationDirectory(workspace, active.id), "current.sqlite3"));
        current.initialize(active, genome.body_interface_version);
        fs.mkdirSync(path.join(generationDirectory(workspace, active.id), "body/skills"), { recursive: true });
        writeGenerationPointer(workspace, active.id, pointer);
        lineage.remember(active.id, "generation_birth", { point: "G0001 已初始化", reason: "建立初始生命数据边界", effect: "业务事实跨代保留" }, "birth:G0001");
      } else {
        if (!fs.existsSync(pointer) || JSON.parse(fs.readFileSync(pointer, "utf8")).generation_id !== active.id)
          throw new Error("ACTIVE_GENERATION_POINTER_MISMATCH");
        const file = path.join(generationDirectory(workspace, active.id), "current.sqlite3");
        if (!fs.existsSync(file)) throw new Error("ACTIVE_CURRENT_DATABASE_MISSING");
        current = new CurrentStore(file);
      }
      if (active.gene_hash !== geneHash || current.meta().generation_id !== active.id || current.meta().gene_hash !== geneHash ||
          current.meta().release_id !== active.release_id || current.meta().body_interface_version !== genome.body_interface_version)
        throw new Error(`ACTIVE_GENOME_MISMATCH: workspace ${workspace} is bound to ${active.id} / ${active.gene_hash}; source is ${geneHash}. Use an explicitly approved upgrade; do not overwrite the stored hash.`);
      return new LifeContext(workspace, genome, lineage, current);
    } catch (e) { current?.close(); lineage.close(); throw e; }
  }
  close() { this.current.close(); this.lineage.close(); }
  load(pixelId: string, task: unknown, environment: unknown = {}) {
    return { genome: this.genome, current: { ...this.current.meta(), workingState: this.current.state(pixelId),
      objectives: this.current.objectives(pixelId), skills: this.current.skills() },
      memories: this.lineage.relevantMemories({ pixelId,worldId:this.worldId }), task, environment };
  }
  overview() {
    return lifeOverview(this);
  }
}
