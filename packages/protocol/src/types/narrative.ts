export interface NarrativeArtifact {
  artifactId: string;
  title: string;
  body: string;
  sourceEventIds: string[];
  sourceMissionIds: string[];
  contentRevision: number;
  createdAt: number;
}

export interface NarrativeExport {
  schemaVersion: 1;
  generatedAt: string;
  period: { from: string; to: string };
  characters: Array<{ qianjiId: string; displayName: string | null; narrativeRevision: number | null }>;
  events: Array<Record<string, unknown>>;
  missions: Array<Record<string, unknown>>;
  trials: Array<Record<string, unknown>>;
  products: Array<Record<string, unknown>>;
  deliveries: Array<Record<string, unknown>>;
  feedback: Array<Record<string, unknown>>;
  artifactMetadata: Array<Record<string, unknown>>;
  businessMetrics: { confirmedRevenueFen: number; refundFen: number; knownCostCny: number; totalCostCny: number | null };
  omittedCounts: Record<string, number>;
  warnings: string[];
}
