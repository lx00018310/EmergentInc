import * as fs from "node:fs";
import * as path from "node:path";
import { GenomeManifest } from "@emergentinc/protocol";
import { LineageStore, CurrentStore } from "@emergentinc/persistence";

export { readGenome, generationDirectory, writeGenerationPointer } from "@emergentinc/persistence";
import { generationDirectory, writeGenerationPointer } from "@emergentinc/persistence";

export class LifeContext {
  constructor(readonly workspaceRoot: string, readonly genome: GenomeManifest, readonly lineage: LineageStore, readonly current: CurrentStore,readonly worldId?:string) {}
  close() { this.current.close(); this.lineage.close(); }
  load(pixelId: string, task: unknown, environment: unknown = {}) {
    return { genome: this.genome, current: { ...this.current.meta(), workingState: this.current.state(pixelId),
      objectives: this.current.objectives(pixelId), skills: this.current.skills() },
      memories: this.lineage.relevantMemories({ pixelId,worldId:this.worldId }), task, environment };
  }
}
