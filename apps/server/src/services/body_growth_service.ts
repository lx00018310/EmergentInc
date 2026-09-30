import { BodyCandidate, lifeId, lifeText } from "@emergentinc/protocol";
import { bodyCandidate, bodyHash } from "@emergentinc/tools";
import { LifeContext } from "./life_context.js";
import { BodySkillSupervisor } from "./automation_supervisor.js";

export type LifeModel = (purpose: "dream" | "body", key: string, input: unknown) => Promise<string>;
export class BodyGrowthService {
  private busy = false;
  constructor(readonly life: LifeContext, readonly supervisor?: BodySkillSupervisor, private generate?: LifeModel) {}
  async idle() { while (this.busy) await new Promise(resolve => setTimeout(resolve, 25)); await this.supervisor?.idle(); }
  syncBusinessResources() {
    if (this.life.lineage.activeGeneration()?.id !== this.life.current.meta().generation_id) return;
    for (const request of this.life.lineage.db.prepare("SELECT * FROM business_requests WHERE state='OPEN' AND resource LIKE 'body:%'").all()) {
      const view = this.life.lineage.getPlan(String(request.plan_id));
      if (view.revision !== request.revision || view.plan.expiresAt <= Date.now() || view.state === "STOPPED") continue;
      const matched = view.plan.resources.filter(r => r.startsWith("body:")).some((resource, index) => {
        if (resource !== request.resource) return false;
        return !!this.life.current.db.prepare(`SELECT c.id FROM body_needs n JOIN body_candidates c ON c.need_id=n.id
          JOIN body_skills s ON s.active_change_id=c.id WHERE n.id=? AND n.pixel_id='business' AND n.need=?
          AND n.state='SATISFIED' AND c.state='ACTIVE' AND s.state='ACTIVE'`)
          .get(`plan-${view.id}-${view.revision}-${index}`, resource.slice(5));
      });
      if (matched) this.life.lineage.resolveResource(String(request.id), "provided", "对应 Body Need 已通过沙箱数据测试并激活");
    }
  }
  async grow(input: { id: string; pixel_id: string; need: string; evidence: string; required_capabilities?: string[]; carry_forward?: boolean; candidate?: unknown }) {
    if (this.busy) throw new Error("BODY_GROWTH_ALREADY_RUNNING");
    lifeId(input?.id); lifeId(input.pixel_id); lifeText(input.need, 2000); lifeText(input.evidence, 4000);
    if (input.required_capabilities && (!Array.isArray(input.required_capabilities) || input.required_capabilities.some(c => typeof c !== "string")))
      throw new Error("INVALID_BODY_CAPABILITIES");
    const need = this.life.current.need(input.id, input.pixel_id, input.need, input.evidence, input.carry_forward);
    const key = `body-${bodyHash({ generation: this.life.current.meta().generation_id, needId: input.id }).slice(0, 32)}`;
    const saved = this.life.current.db.prepare("SELECT candidate_json FROM body_candidates WHERE id=?").get(key);
    if (input.candidate !== undefined && saved && bodyHash(input.candidate) !== bodyHash(JSON.parse(String(saved.candidate_json))))
      throw new Error("BODY_IDEMPOTENCY_CONFLICT");
    if (need.state === "SATISFIED") { this.syncBusinessResources(); return need; }
    if (need.state === "GENE_PROPOSED") return need;
    const outside = input.required_capabilities?.some(c => c !== "pure_json");
    if (outside) return this.propose(input, "所需权限超出纯 JSON Body 契约");
    if (!this.supervisor || (!this.generate && input.candidate === undefined)) throw new Error("BODY_SANDBOX_AND_MODEL_REQUIRED");
    this.busy = true;
    try {
      let candidate: BodyCandidate;
      const existing = this.life.current.db.prepare("SELECT id FROM body_candidates WHERE id=?").get(key);
      if (existing) candidate = this.supervisor.get(key).candidate;
      else {
        const raw = input.candidate === undefined ? await this.generate!("body", key, this.life.load(input.pixel_id, { need: input.need, evidence: input.evidence })) : undefined;
        try { candidate = bodyCandidate(input.candidate === undefined ? JSON.parse(raw!) : input.candidate, this.life.genome.body_interface_version); }
        catch (e) {
          if (e instanceof Error && e.message === "BODY_SECURITY_BOUNDARY") return this.propose(input, "生成的能力尝试跨越 Body 安全边界");
          this.life.current.db.prepare("UPDATE body_needs SET state='VALIDATION_FAILED',updated_at=? WHERE id=?").run(Date.now(), input.id);
          throw new Error(input.candidate === undefined ? "BODY_CANDIDATE_INVALID_COST_RECORDED" : "INVALID_BODY_CANDIDATE");
        }
        this.supervisor.submit(key, candidate, input.id);
      }
      await this.supervisor.recover();
      const c = this.supervisor.get(key);
      if (c.state === "GENERATED") await this.supervisor.validateBodyCandidate(key);
      const validated = this.supervisor.get(key);
      if (validated.state === "VALIDATED") {
        const active = await this.supervisor.policyAutoActivate(key);
        this.syncBusinessResources();
        return active;
      }
      if (validated.state === "VALIDATION_FAILED") this.life.current.db.prepare("UPDATE body_needs SET state='VALIDATION_FAILED',updated_at=? WHERE id=?").run(Date.now(), input.id);
      return validated;
    } finally { this.busy = false; }
  }
  private propose(input: { id: string; pixel_id: string; need: string; evidence: string }, reason: string) {
    const generation = this.life.current.meta().generation_id;
    const proposal = this.life.lineage.proposeGene(generation, "dream", { point: input.need.slice(0, 1000), reason: `${reason}；${input.evidence}`.slice(0, 1000),
      effect: "Owner 决定方向；准确候选仍需可信监管通道批准" }, `body-need:${generation}:${input.id}`);
    this.life.lineage.remember(generation, "security_boundary", { point: input.need.slice(0, 1000), reason, effect: "Body 未获得额外权限，已转 Gene Proposal" },
      `body-boundary:${generation}:${input.id}`, input.pixel_id, 4);
    this.life.current.db.prepare("UPDATE body_needs SET state='GENE_PROPOSED',updated_at=? WHERE id=?").run(Date.now(), input.id);
    return proposal;
  }
}
