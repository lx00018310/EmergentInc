import * as fs from "node:fs";
import * as path from "node:path";
import { CurrentStore, migrateCurrentState } from "@emergentinc/persistence";
import { lifeId } from "@emergentinc/protocol";
export class GenerationMigrator {
  migrate(old: CurrentStore, next: CurrentStore, oldSkills: string, nextSkills: string) {
    migrateCurrentState(old, next);
    fs.mkdirSync(nextSkills, { recursive: true });
    // Only inherited validated candidates are copied; no scratch, failed source, cache or debug files.
    for (const row of next.db.prepare("SELECT id,skill_id,candidate_json FROM body_candidates").all()) {
      const id = lifeId(row.id), slot = lifeId(row.skill_id);
      const source = path.join(oldSkills, slot, `${id}.json`);
      if (fs.lstatSync(source).isSymbolicLink() || fs.readFileSync(source, "utf8") !== row.candidate_json) throw new Error("MIGRATION_BODY_ARTIFACT_INVALID");
      const directory = path.join(nextSkills, slot); fs.mkdirSync(directory, { recursive: true });
      fs.copyFileSync(source, path.join(directory, `${id}.json`));
    }
  }
}
