export type GenerationState = "BIRTHING" | "ACTIVE" | "RETIRED" | "FAILED" | "ROLLED_BACK";
export type GeneProposalState = "PROPOSED" | "APPROVED" | "REJECTED" | "IMPLEMENTING" | "CANDIDATE_READY" | "BORN" | "FAILED";
export interface MemoryPoint { point: string; reason: string; effect: string }
export interface GenomeManifest {
  schema_version: 1;
  generation: number;
  body_interface_version: string;
  protected_paths: string[];
  capability_contracts: Record<string, unknown>;
}
export interface BodyCandidate {
  skill_id: string;
  purpose: string;
  source: string;
  tests: { input: unknown; expected: unknown }[];
  interface_version: string;
}
export function lifeText(value: unknown, limit = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("INVALID_LIFE_TEXT");
  return value;
}
export function lifeId(value: unknown): string {
  const id = lifeText(value, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("INVALID_LIFE_ID");
  return id;
}
export function memoryPoint(value: unknown): MemoryPoint {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "effect,point,reason") throw new Error("INVALID_MEMORY_POINT");
  const v = value as MemoryPoint;
  return { point: lifeText(v.point), reason: lifeText(v.reason), effect: lifeText(v.effect) };
}
export function genomeManifest(value: unknown): GenomeManifest {
  const v = value as GenomeManifest;
  if (!v || v.schema_version !== 1 || !Number.isSafeInteger(v.generation) || v.generation < 1 ||
      typeof v.body_interface_version !== "string" || !/^[0-9]+$/.test(v.body_interface_version) ||
      !Array.isArray(v.protected_paths) || !v.protected_paths.length ||
      v.protected_paths.some(p => typeof p !== "string" || !p || p.startsWith("/") || p.includes("..") || p.includes("\\")) ||
      !v.capability_contracts || typeof v.capability_contracts !== "object" || Array.isArray(v.capability_contracts))
    throw new Error("INVALID_GENOME_MANIFEST");
  return v;
}
