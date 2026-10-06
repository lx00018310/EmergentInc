import { FastifyInstance } from "fastify";
import { lifeId, memoryPoint } from "@emergentinc/protocol";
import { LifeContext } from "../services/life_context.js";
import { DreamService } from "../services/dream_service.js";
import { MemoryGate } from "../services/memory_gate.js";
import { BodyGrowthService } from "../services/body_growth_service.js";
import { recoveryHealth } from "../services/life_overview.js";

export interface EvolutionServices {
  life: LifeContext; dream: DreamService; memoryGate: MemoryGate; body: BodyGrowthService;
  recoveryOrigin?: string;
  worldOverview?:()=>unknown[];
  beforeProposalDecision?:(id:string,decision:string)=>void;
  onProposalApproved?: (id:string)=>Promise<unknown>|unknown;
  quiesced?: () => boolean; quiesce?: () => Promise<void>; resume?: () => Promise<void>;
}
export async function registerEvolutionRoutes(app: FastifyInstance, services: EvolutionServices) {
  const { life, dream, memoryGate, body } = services;
  app.get("/evolution/overview", async () => {
    const overview = life.overview(), status = dream.status();
    return { ...overview, body:{...overview.body,...(services.worldOverview?{worlds:services.worldOverview(),projection:true}: {})}, dream: status, trust: { ...overview.trust, recovery: await recoveryHealth(services.recoveryOrigin) },
      evolution: { ...overview.evolution, dream: status } };
  });
  app.post("/evolution/dream", async () => dream.run());
  app.post<{ Params: { id: string } }>("/evolution/dream/:id/retry", async req => dream.retry(req.params.id));
  app.post("/evolution/final-dream", async () => dream.finalDream());
  app.post("/evolution/post-rollback-dream", async req => dream.postRollback(req.body));
  app.post("/evolution/quiesce", async () => { if (!services.quiesce) throw new Error("EVOLUTION_CONTROL_REQUIRED"); await services.quiesce(); return { quiesced: true }; });
  app.post("/evolution/resume", async () => { if (!services.resume) throw new Error("EVOLUTION_CONTROL_REQUIRED"); await services.resume(); return { quiesced: false }; });
  app.post("/evolution/proposals", async req => {
    const b = req.body as any; lifeId(b?.key);
    return life.lineage.proposeGene(life.current.meta().generation_id, "owner", memoryPoint(b?.proposal), `owner:${b.key}`);
  });
  app.post<{ Params: { id: string } }>("/evolution/proposals/:id/decision", async req => {
    const b = req.body as any;
    if (!["APPROVED", "REJECTED"].includes(b?.decision)) throw new Error("INVALID_PROPOSAL_DECISION");
    services.beforeProposalDecision?.(req.params.id,b.decision);
    const proposal=life.lineage.decideProposal(req.params.id, b.decision);
    const request=b.decision==='APPROVED'?await services.onProposalApproved?.(req.params.id):undefined;return {...proposal,...(request?{candidateRequest:request}:{})};
  });
  app.post("/evolution/corrections", async req => {
    const b = req.body as any; lifeId(b?.key); if (b?.pixel_id) lifeId(b.pixel_id);
    return memoryGate.ownerCorrection(b.key, b?.correction, b?.pixel_id);
  });
  app.post("/evolution/body/needs", async req => body.grow(req.body as any));
  app.post<{ Params: { id: string } }>("/evolution/body/skills/:id/run", async req => {
    if (!body.supervisor) throw new Error("BODY_SANDBOX_REQUIRED");
    await body.supervisor.recover();
    return body.supervisor.run(req.params.id, (req.body as any)?.input);
  });
}
