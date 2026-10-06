export interface GenePatchFile { path: string; content: string | null }
export interface GeneRequest {
  id: string; base_generation: string; base_release: string; proposal_id: string; patch: GenePatchFile[];
  owner_release?: { reason: string; source_commit: string; release_hash: string };
}
export interface GeneCandidate {
  id: string; base_generation: string; base_release: string; proposal_id: string;
  patch_hash: string; gene_hash: string; candidate_release_hash: string; candidate_hash: string;
  release_id: string; directory: string;
  owner_release?: GeneRequest["owner_release"];
}
export interface EvolutionRuntime {
  validateRelease(directory: string): Promise<void>;
  quiesce(): Promise<void>;
  finalDream(): Promise<void>;
  smoke(directory: string, workspace: string, generationId: string): Promise<void>;
  stop(): Promise<void>;
  switchRelease(directory: string): Promise<void>;
  start(): Promise<void>;
  healthy(generationId: string): Promise<void>;
  resume(): Promise<void>;
  prepareCurrent?(directory: string): Promise<void>;
  postRollbackDream?(input: unknown): Promise<void>;
  checkRollback?(directory: string): void;
  prepareRollback?(directory: string): Promise<void>;
  activeRelease?(): string;
  worlds?(): {id:string;directory:string}[];
}
export function classifyChange(paths: string[]): "BODY" | "GENE" | "ROOT" {
  if (!paths.length) throw new Error("EMPTY_CHANGE");
  if (paths.some(p => p.startsWith("supervisor/") || p === "scripts/generation-supervisor.mjs" || p === "scripts/local-upgrade.mjs" ||
    p === "scripts/version-upgrade.mjs" || p === "scripts/upgrade-web.mjs" || p === "resources/upgrade-web.html" || p === "EmergentInc_Upgrade.bat" || p === "scripts/local-release.mjs" || p === "scripts/launch-approved.mjs" || p === "EmergentInc_UI.bat" || p === "EmergentInc_UI.ps1" ||
    p === "scripts/v23-migration-dry-run.mjs" || p === "scripts/v23-world-migrate.mjs" || p === "scripts/v23-generation.mjs" || p === "scripts/v23-upgrade.mjs" || p === "scripts/v23-approved-release.mjs" ||
    p === "apps/recovery" || p.startsWith("apps/recovery/"))) return "ROOT";
  return paths.every(p => /^workspace\/generations\/G\d{4,}\/body\/skills\/[a-zA-Z0-9_/-]+\.json$/.test(p)) ? "BODY" : "GENE";
}
