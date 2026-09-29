import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";
import { BusinessService } from "../services/business_service.js";

export async function registerBusinessRoutes(app: FastifyInstance, service: BusinessService) {
  const store = service.store;
  app.setErrorHandler((error, _request, reply) => {
    const code = error instanceof Error ? error.message : "BUSINESS_OPERATION_FAILED";
    const status = /NOT_FOUND/.test(code) ? 404 : /INVALID_|_REQUIRED|PRECISION_UNSUPPORTED/.test(code) ? 400 :
      /CONFLICT|EXHAUSTED|EXPIRED|INACTIVE|REVOKED|NOT_OPEN|NOT_APPROVABLE|NOT_RUNNING|NOT_RESUMABLE|ALREADY_RUNNING|REQUIRES_REVIEW|IMMUTABLE/.test(code) ? 409 : 500;
    return reply.status(status).send({ detail: status === 500 && !/^[A-Z_]+$/.test(code) ? "BUSINESS_OPERATION_FAILED" : code });
  });
  app.get("/business/overview", async () => ({ ...store.overview(), ...service.status() }));
  app.post("/business/budget", async req => { store.configure(req.body as any); return store.settings(); });
  app.post("/business/intents", async req => {
    const b = req.body as any;
    if (typeof b?.direction !== "string" || typeof b?.key !== "string") throw new Error("INVALID_DIRECTION_OR_KEY");
    return service.propose(b.direction, b.key);
  });
  app.get<{ Params: { id: string } }>("/business/plans/:id", async req => store.getPlan(req.params.id));
  app.get<{ Params: { id: string } }>("/business/plans/:id/revisions", async req => store.revisions(req.params.id));
  app.post<{ Params: { id: string } }>("/business/plans/:id/restore", async req => store.restoreRevision(req.params.id, req.body as any));
  app.post<{ Params: { id: string } }>("/business/plans/:id/revisions", async req => {
    const b = req.body as any;
    if (typeof b?.feedback !== "string" || typeof b?.key !== "string" || !Number.isSafeInteger(b?.revision)) throw new Error("INVALID_REVISION");
    return service.propose(b.feedback, b.key, req.params.id, b.revision);
  });
  app.post<{ Params: { id: string } }>("/business/plans/:id/approve", async req => {
    const b = req.body as any;
    if (!Number.isSafeInteger(b?.revision) || typeof b?.hash !== "string") throw new Error("APPROVAL_VERSION_REQUIRED");
    return store.approve(req.params.id, b.revision, b.hash);
  });
  for (const action of ["pause", "resume", "revoke"] as const) {
    app.post<{ Params: { id: string } }>(`/business/plans/:id/${action}`, async req => store.control(req.params.id, action));
  }
  app.post("/business/datasets", async req => {
    const b = req.body as any;
    if (!b || (b.id !== undefined && typeof b.id !== "string")) throw new Error("INVALID_DATASET");
    const id = store.addDataset(b.id || randomUUID(), b.name, b.rows);
    return { id };
  });
  app.get("/business/requests", async () => store.overview().requests);
  app.post("/business/connections/github/authorize", async req => {
    if (!service.connections) throw new Error("CONNECTION_SERVICE_REQUIRED");
    return service.connections.authorizeGithub(req.body as any);
  });
  app.post<{ Params: { id: string } }>("/business/connections/:id/disable", async req => {
    store.disableConnection(req.params.id); return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/business/tasks/:id/reconcile", async req => service.reconcileTask(req.params.id));
  app.post("/business/orders", async req => store.evidence.createOrder(req.body as any));
  app.post<{ Params: { id: string } }>("/business/orders/:id/status", async req => store.evidence.updateOrder(req.params.id, req.body as any));
  app.post("/business/payment-evidence", async req => store.evidence.recordPayment(req.body as any));
  app.post<{ Params: { id: string } }>("/business/tasks/:id/retry", async req => {
    const b = req.body as any; store.retryPureTask(req.params.id, b?.note); return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/business/plans/:id/feedback", async req => {
    const b = req.body as any; return store.recordFeedback(req.params.id, b?.key, b?.note, b?.evidence ?? "");
  });
  app.post<{ Params: { id: string } }>("/business/requests/:id/decision", async req => {
    const b = req.body as any;
    if (!["provided", "reject"].includes(b?.decision) || typeof b?.note !== "string") throw new Error("INVALID_RESOURCE_DECISION");
    store.resolveResource(req.params.id, b.decision, b.note);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/business/operations/:id/reconcile", async req => {
    const b = req.body as any;
    const op = store.operation(req.params.id);
    if (!op || !["draft", "review"].includes(op.scope) || op.state !== "OUTCOME_UNKNOWN" || !Number.isSafeInteger(b?.amountMicros) || b.amountMicros < 0 ||
        typeof b.evidence !== "string" || !b.evidence.trim() || b.evidence.length > 4000) throw new Error("BILL_EVIDENCE_REQUIRED");
    store.settle(req.params.id, b.amountMicros, null, { source: "owner_confirmed", evidence: b.evidence });
    if (op.scope === "review") { service.restoreReview(req.params.id.slice(5)); return { ok: true }; }
    if (op.response) {
      try { return { ok: true, plan: service.restoreProposal(req.params.id) }; }
      catch { return { ok: true, notice: "费用已确认，原响应未形成有效方案；可重新提出方向。" }; }
    }
    return { ok: true, notice: "费用已确认。未取得原响应，未自动重发请求。" };
  });
}
