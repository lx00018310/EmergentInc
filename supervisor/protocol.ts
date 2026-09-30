export interface GenePatchFile { path: string; content: string | null }
export interface GeneRequest {
  id: string; base_generation: string; base_release: string; proposal_id: string; patch: GenePatchFile[];
}
export interface GeneCandidate {
  id: string; base_generation: string; base_release: string; proposal_id: string;
  patch_hash: string; gene_hash: string; candidate_release_hash: string; candidate_hash: string;
  release_id: string; directory: string;
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
  activeRelease?(): string;
}
export function classifyChange(paths: string[]): "BODY" | "GENE" | "ROOT" {
  if (!paths.length) throw new Error("EMPTY_CHANGE");
  if (paths.some(p => p.startsWith("supervisor/") || p === "scripts/generation-supervisor.mjs" || p === "scripts/local-upgrade.mjs" ||
    p === "apps/recovery" || p.startsWith("apps/recovery/"))) return "ROOT";
  return paths.every(p => /^workspace\/generations\/G\d{4,}\/body\/skills\/[a-zA-Z0-9_/-]+\.json$/.test(p)) ? "BODY" : "GENE";
}
