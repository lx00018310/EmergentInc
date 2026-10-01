import type { LifeRow } from "@emergentinc/persistence";
import type { LifeContext } from "./life_context.js";

export interface LifeEvent {
  id: string; time: number; type: string; layer: "ROOT" | "GENOME" | "EVOLUTION" | "BODY";
  title: string; detail: string; state: string; generation: string;
}
const trustKinds = ["owner_gene_decision", "generation_birth", "generation_failure", "generation_rollback", "security_boundary", "POST_ROLLBACK_DREAM_REQUIRED"];
const titles: Record<string, string> = {
  owner_gene_decision: "Owner 决定 Gene 方向", gene_proposed: "形成 Gene Proposal", owner_correction: "Owner 纠正经验",
  generation_birth: "Generation 出生", generation_failure: "Generation 出生失败", generation_rollback: "Generation 回退",
  security_boundary: "身体遇到权限边界", POST_ROLLBACK_DREAM_REQUIRED: "回退后等待整理经历",
  post_rollback_dream_completed: "回退经历整理完成", body_need: "发现 Body Need", body_generated: "生成身体候选",
  body_validation_passed: "身体验证通过", body_validation_failed: "身体验证失败", body_activated: "身体能力激活",
  body_rolled_back: "身体能力回退", body_run_succeeded: "身体能力运行成功", body_growth_blocked: "身体生长受阻",
  working_state_changed: "工作状态变化", objective_changed: "目标状态变化",
};
const recent = (events: LifeEvent[]) => events.sort((a, b) => b.time - a.time || b.id.localeCompare(a.id, undefined, { numeric: true })).slice(0, 20);
function recordedEvent(row: LifeRow, generation: string, body = false): LifeEvent {
  const p = JSON.parse(String(row.payload));
  const kind = String(row.kind);
  return { id: `${body ? "current" : "life"}:${row.sequence}`, time: Number(row.created_at), type: kind,
    layer: body ? "BODY" : kind === "owner_gene_decision" ? "ROOT" : kind === "gene_proposed" ? "GENOME" : "EVOLUTION",
    generation: String(row.generation_id ?? generation),
    title: kind === "gene_proposed" && String(row.source_ref).startsWith("proposal:body-need:") ? "Body Need → Gene Proposal" : titles[kind] ?? kind,
    detail: [p.decision, p.proposalId, p.source, p.point, p.reason, p.previous, p.release, p.skillId, p.changeId,
      p.restored && `恢复 ${p.restored}`, p.revision != null && `R${p.revision}`].filter(Boolean).join(" · "),
    state: String(p.decision ?? (kind.includes("failed") || kind.includes("failure") || kind.includes("blocked") ? "FAILED"
      : kind === "POST_ROLLBACK_DREAM_REQUIRED" ? "REQUIRES_REVIEW" : "RECORDED")) };
}

/** Read-only projections of the existing databases. No Supervisor private database or credential access. */
export function lifeOverview(life: LifeContext) {
  const { lineage, current, genome } = life;
  const meta = current.meta(), generation = String(meta.generation_id);
  const skills = current.db.prepare(`SELECT s.*,c.body_revision FROM body_skills s
    LEFT JOIN body_candidates c ON c.id=s.active_change_id ORDER BY s.skill_id`).all();
  const needs = current.db.prepare("SELECT * FROM body_needs ORDER BY created_at DESC,rowid DESC LIMIT 100").all();
  const memories = lineage.relevantMemories(), proposals = lineage.proposals(), generations = lineage.generations();
  const lifeRows = lineage.db.prepare("SELECT * FROM life_events ORDER BY created_at DESC,sequence DESC LIMIT 20").all();
  const events = lifeRows.map(row => recordedEvent(row, generation));
  const evidenceRows = lineage.db.prepare(`SELECT * FROM life_events WHERE kind IN (${trustKinds.map(() => "?").join(",")})
    ORDER BY created_at DESC,sequence DESC LIMIT 20`).all(...trustKinds);
  const evidence = evidenceRows.map(row => recordedEvent(row, generation));
  // Birth/failure/rollback can be persisted as Memory Gate evidence without a life_event.
  const gateRows = lineage.db.prepare(`SELECT * FROM memories WHERE kind IN (${trustKinds.map(() => "?").join(",")})
    ORDER BY created_at DESC,rowid DESC LIMIT 20`).all(...trustKinds);
  for (const row of gateRows) {
    const event: LifeEvent = { id: `memory:${row.id}`, time: Number(row.created_at), type: String(row.kind), layer: "EVOLUTION",
      generation: String(row.generation_id), title: String(row.point), detail: `${row.reason} · ${row.effect}`,
      state: row.kind === "generation_failure" ? "FAILED" : "RECORDED" };
    const duplicate = (rows: LifeRow[], stream: LifeEvent[]) => rows.some(r => r.source_ref === row.source_ref) ||
      ["generation_birth", "generation_failure", "generation_rollback"].includes(event.type) && stream.some(e => e.type === event.type && e.generation === event.generation);
    if (!duplicate(lifeRows, events)) events.push(event);
    if (!duplicate(evidenceRows, evidence)) evidence.push(event);
  }
  for (const p of proposals) {
    if (lifeRows.some(row => row.source_ref === `proposal:${p.source_ref}`)) continue;
    events.push({ id: `proposal:${p.id}`, time: Number(p.created_at), type: "gene_proposed", layer: "GENOME",
      title: String(p.source_ref).startsWith("body-need:") ? "Body Need → Gene Proposal" : "形成 Gene Proposal",
      detail: `来源 ${p.source} · ${p.id}`, state: "PROPOSED", generation: String(p.generation_id) });
  }
  for (const g of generations) {
    if (g.born_at && !events.some(e => e.type === "generation_birth" && e.generation === g.id))
      events.push({ id: `generation:${g.id}:birth`, time: Number(g.born_at), type: "generation_birth", layer: "EVOLUTION",
        title: `${g.id} 出生`, detail: `父代 ${g.parent_id ?? "无"} · Release ${g.release_id}`, state: "RECORDED", generation: String(g.id) });
  }
  const dreamQuery = `SELECT d.id,d.generation_id,d.status,d.trigger,d.error,d.created_at,d.finished_at,
    json_array_length(d.input_json,'$.facts') fact_count,
    (SELECT COUNT(*) FROM memories m WHERE m.source_ref LIKE d.id || ':memory:%') memory_count,
    (SELECT COUNT(*) FROM gene_proposals p WHERE p.source_ref LIKE d.id || ':proposal:%') proposal_count,
    CASE WHEN d.trigger!='post_rollback' AND d.status IN ('FAILED','RUNNING','OUTCOME_UNKNOWN') AND o.state='SETTLED' AND o.response IS NOT NULL THEN 1 ELSE 0 END retry_available
    FROM dream_runs d LEFT JOIN business_operations o ON o.id='life:' || d.generation_id || ':dream:' || d.id`;
  const dreamRuns = lineage.db.prepare(`${dreamQuery} ORDER BY d.created_at DESC,d.rowid DESC LIMIT 20`).all();
  const dreamEvents = lineage.db.prepare(`${dreamQuery} ORDER BY COALESCE(d.finished_at,d.created_at) DESC,d.rowid DESC LIMIT 20`).all();
  for (const run of dreamEvents) events.push({ id: `dream:${run.id}`, time: Number(run.finished_at ?? run.created_at),
    type: `dream_${String(run.status).toLowerCase()}`, layer: "EVOLUTION", title: `Dream ${run.status}`,
    detail: String(run.error ?? `${run.memory_count} 条 Memory · ${run.proposal_count} 条 Proposal`),
    state: String(run.status), generation: String(run.generation_id) });
  const bodyCandidates = current.db.prepare(`SELECT id,skill_id,need_id,candidate_hash,state,previous_id,activated_at,created_at,body_revision
    FROM body_candidates ORDER BY created_at DESC,rowid DESC LIMIT 20`).all();
  const currentEvents = current.db.prepare("SELECT * FROM current_events ORDER BY created_at DESC,sequence DESC LIMIT 20").all()
    .map(row => {
      const event = recordedEvent(row, generation, true);
      if (row.kind === "body_rolled_back") {
        const p = JSON.parse(String(row.payload));
        const failed = current.db.prepare("SELECT body_revision FROM body_candidates WHERE id=?").get(p.changeId);
        const restored = p.restored ? current.db.prepare("SELECT body_revision FROM body_candidates WHERE id=?").get(p.restored) : undefined;
        event.detail = `${failed?.body_revision != null ? `R${failed.body_revision}` : p.changeId} ROLLED_BACK → ${restored?.body_revision != null ? `R${restored.body_revision} ACTIVE` : "能力停用"} · ${p.reason}`;
      }
      return event;
    });
  const count = (sql: string) => Number(lineage.db.prepare(sql).get()!.n);
  const businessSummary = {
    activePlans: count("SELECT COUNT(*) n FROM business_plans WHERE state IN ('ACTIVE','WAITING_RESOURCE')"),
    runningTasks: count("SELECT COUNT(*) n FROM business_tasks WHERE state='RUNNING'"),
    waitingResources: count("SELECT COUNT(*) n FROM business_requests WHERE state='OPEN'"),
    datasets: count("SELECT COUNT(*) n FROM business_datasets"),
    connections: count("SELECT COUNT(*) n FROM business_connections WHERE enabled=1"),
    recentResults: lineage.db.prepare(`SELECT t.id,t.capability,t.state,t.error,MAX(e.created_at) time
      FROM business_tasks t JOIN business_events e ON json_extract(e.payload,'$.taskId')=t.id
      WHERE t.state IN ('SUCCEEDED','FAILED','OUTCOME_UNKNOWN') GROUP BY t.id ORDER BY time DESC LIMIT 5`).all(),
  };
  return {
    // One-version compatibility for existing overview consumers.
    current: meta, skills, needs, memories, proposals, generations, dreamRuns,
    trust: { state: "DEV_LOCAL", recovery: { state: "NOT_CONFIGURED" }, control: "NOT_CONNECTED",
      runtime: process.platform === "win32" ? "LOCAL_OWNER_MAINTENANCE" : "UNVERIFIED",
      supervisor: "NOT_CONNECTED", ownerExactApproval: "REQUIRES_REVIEW", releaseRecovery: "REQUIRES_REVIEW",
      activeGeneration: lineage.activeGeneration()?.id ?? null, evidence: recent(evidence) },
    genome: { generation: genome.generation, geneHash: meta.gene_hash, bodyInterfaceVersion: genome.body_interface_version,
      protectedPaths: genome.protected_paths, capabilityContracts: genome.capability_contracts, proposals, generations,
      events: recent(events.filter(e => e.layer === "GENOME")) },
    evolution: { memories: lineage.db.prepare("SELECT * FROM memories ORDER BY created_at DESC,rowid DESC LIMIT 20").all(),
      proposals, generations, dreamRuns, evolutionEvents: recent(events) },
    body: { current: meta, database: "READY", skills, needs, bodyCandidates, currentEvents, businessSummary },
  };
}

export async function recoveryHealth(origin?: string): Promise<{ state: "NOT_CONFIGURED" | "REACHABLE" | "UNAVAILABLE" }> {
  if (!origin) return { state: "NOT_CONFIGURED" };
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      return { state: "UNAVAILABLE" };
    const response = await fetch(`${url.origin}/health/live`, { redirect: "error", signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { state: "UNAVAILABLE" };
    const health = await response.json() as { alive?: boolean; role?: string };
    return { state: health.alive === true && health.role === "recovery" ? "REACHABLE" : "UNAVAILABLE" };
  } catch { return { state: "UNAVAILABLE" }; }
}
