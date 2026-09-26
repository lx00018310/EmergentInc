import { FastifyInstance } from "fastify";
import { BusinessService } from "../services/business_service.js";
import { validatePathSegment } from "../services/safe_path.js";

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function statusFor(message: string): number {
  if (/NOT_FOUND|NOT_EXIST/.test(message)) return 404;
  if (/CONFLICT|INVALID|NOT_EDITABLE|TRANSITION|ALREADY|NOT_LINKED|ALREADY_STARTED|REQUIRED_MISSION|EXCEEDS|MISMATCH|NOT_PARTICIPANT|UNIQUE|OCCUPIED/.test(message)) return 409;
  return 400;
}
function fail(reply: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return reply.status(statusFor(message)).send({ detail: message });
}

export async function registerBusinessRoutes(server: FastifyInstance, service: BusinessService): Promise<void> {
  server.get("/products", async (_request, reply) => reply.send({ items: service.listProducts() }));
  server.post("/products", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).some(key => !["name", "description", "targetUser", "problemStatement", "ownerQianjiId", "createdFromMissionId"].includes(key)) ||
        ["name", "description", "targetUser", "problemStatement", "ownerQianjiId"].some(key => typeof body[key] !== "string") ||
        (body.createdFromMissionId !== undefined && body.createdFromMissionId !== null && typeof body.createdFromMissionId !== "string")) {
      return reply.status(400).send({ detail: "PRODUCT_INPUT_INVALID" });
    }
    try { return reply.status(201).send(service.createProduct(body as any)); } catch (error) { return fail(reply, error); }
  });
  server.get("/products/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "PRODUCT_ID_INVALID" }); }
    const product = service.getProduct(id);
    return product ? reply.send(product) : reply.status(404).send({ detail: "PRODUCT_NOT_FOUND" });
  });
  server.put("/products/:id", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).some(key => !["name", "description", "targetUser", "problemStatement"].includes(key)) ||
        ["name", "description", "targetUser", "problemStatement"].some(key => typeof body[key] !== "string")) return reply.status(400).send({ detail: "PRODUCT_INPUT_INVALID" });
    try { return reply.send(service.updateProduct(String((request.params as any).id ?? ""), body as any)); } catch (error) { return fail(reply, error); }
  });
  server.post("/products/:id/transition", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).some(key => !["status", "reason"].includes(key)) ||
        typeof body.status !== "string" || (body.reason !== undefined && typeof body.reason !== "string")) return reply.status(400).send({ detail: "PRODUCT_TRANSITION_INPUT_INVALID" });
    try { return reply.send(service.transitionProduct(String((request.params as any).id ?? ""), body.status as any, body.reason as string | undefined)); }
    catch (error) { return fail(reply, error); }
  });
  server.post("/products/:id/missions", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).length !== 1 || typeof body.missionId !== "string") return reply.status(400).send({ detail: "PRODUCT_MISSION_INPUT_INVALID" });
    try { return reply.send(service.linkMission(String((request.params as any).id ?? ""), body.missionId)); } catch (error) { return fail(reply, error); }
  });

  server.get("/feedback", async (request, reply) => {
    const productId = (request.query as any)?.productId;
    return reply.send({ items: service.listFeedback(typeof productId === "string" ? productId : undefined) });
  });
  server.post("/feedback", async (request, reply) => {
    const body = request.body;
    const allowed = ["productId", "missionId", "contactAlias", "source", "privateFeedbackText", "publicSummary", "occurredAt"];
    if (!record(body) || Object.keys(body).some(key => !allowed.includes(key)) || typeof body.productId !== "string" ||
        typeof body.source !== "string" || typeof body.privateFeedbackText !== "string" ||
        ["missionId", "contactAlias", "publicSummary"].some(key => body[key] !== undefined && body[key] !== null && typeof body[key] !== "string") ||
        (body.occurredAt !== undefined && typeof body.occurredAt !== "number")) return reply.status(400).send({ detail: "FEEDBACK_INPUT_INVALID" });
    try { return reply.status(201).send(service.createFeedback(body as any)); } catch (error) { return fail(reply, error); }
  });

  server.get("/deliveries", async (request, reply) => {
    const productId = (request.query as any)?.productId;
    return reply.send({ items: service.listDeliveries(typeof productId === "string" ? productId : undefined) });
  });
  server.post("/deliveries", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).some(key => !["productId", "missionId", "contactAlias", "evidenceIds"].includes(key)) ||
        typeof body.productId !== "string" || typeof body.missionId !== "string" ||
        (body.contactAlias !== undefined && body.contactAlias !== null && typeof body.contactAlias !== "string") ||
        !Array.isArray(body.evidenceIds) || body.evidenceIds.some(id => typeof id !== "string")) return reply.status(400).send({ detail: "DELIVERY_INPUT_INVALID" });
    try { return reply.status(201).send(service.createDelivery(body as any)); } catch (error) { return fail(reply, error); }
  });
  server.post("/deliveries/:id/transition", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).some(key => !["status", "note"].includes(key)) || typeof body.status !== "string" ||
        (body.note !== undefined && typeof body.note !== "string")) return reply.status(400).send({ detail: "DELIVERY_TRANSITION_INPUT_INVALID" });
    try { return reply.send(service.transitionDelivery(String((request.params as any).id ?? ""), body.status as any, body.note as string | undefined)); }
    catch (error) { return fail(reply, error); }
  });

  server.get("/revenues", async (_request, reply) => reply.send({ items: service.listRevenues() }));
  server.post("/revenues", async (request, reply) => {
    const body = request.body;
    const allowed = ["externalTxId", "amountFen", "productId", "missionId", "primaryQianjiId", "contributions", "evidenceRef", "idempotencyKey"];
    if (!record(body) || Object.keys(body).some(key => !allowed.includes(key)) ||
        ["externalTxId", "productId", "missionId", "primaryQianjiId", "evidenceRef", "idempotencyKey"].some(key => typeof body[key] !== "string") ||
        !Number.isSafeInteger(body.amountFen) || (body.contributions !== undefined && (!Array.isArray(body.contributions) || body.contributions.some(item => !record(item) ||
          Object.keys(item).some(key => !["qianjiId", "shareBps", "evidenceRef"].includes(key)) || typeof item.qianjiId !== "string" || !Number.isSafeInteger(item.shareBps) ||
          (item.evidenceRef !== undefined && item.evidenceRef !== null && typeof item.evidenceRef !== "string"))))) return reply.status(400).send({ detail: "REVENUE_INPUT_INVALID" });
    try { return reply.status(201).send(service.recordRevenue(body as any)); } catch (error) { return fail(reply, error); }
  });
  server.post("/revenues/:externalTxId/refunds", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).some(key => !["refundId", "amountFen", "reason", "evidenceRef", "idempotencyKey"].includes(key)) ||
        ["refundId", "reason", "evidenceRef", "idempotencyKey"].some(key => typeof body[key] !== "string") || !Number.isSafeInteger(body.amountFen)) return reply.status(400).send({ detail: "REFUND_INPUT_INVALID" });
    try { return reply.status(201).send(service.recordRefund({ ...body, externalTxId: String((request.params as any).externalTxId ?? "") } as any)); }
    catch (error) { return fail(reply, error); }
  });
  server.get("/business/metrics", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const scope = query.scope === undefined ? "organization" : query.scope;
    if (!["organization", "product", "qianji", "mission"].includes(String(scope)) ||
        (query.id !== undefined && typeof query.id !== "string") || (scope !== "organization" && typeof query.id !== "string")) return reply.status(400).send({ detail: "BUSINESS_METRICS_QUERY_INVALID" });
    try { return reply.send(service.getMetrics(scope as any, query.id as string | undefined)); } catch (error) { return fail(reply, error); }
  });

  server.get("/narrative/export", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (typeof query.from !== "string" || typeof query.to !== "string" || Object.keys(query).some(key => !["from", "to"].includes(key))) return reply.status(400).send({ detail: "NARRATIVE_PERIOD_REQUIRED" });
    try {
      const result = service.exportFacts(query.from, query.to);
      reply.header("Content-Type", "application/json; charset=utf-8").header("Content-Disposition", "attachment; filename=emergentinc-facts.json");
      return reply.send(result);
    } catch (error) { return fail(reply, error); }
  });
  server.post("/narrative/artifacts", async (request, reply) => {
    const body = request.body;
    if (!record(body) || Object.keys(body).some(key => !["title", "body", "sourceEventIds", "sourceMissionIds", "idempotencyKey"].includes(key)) ||
        typeof body.title !== "string" || typeof body.body !== "string" || !Array.isArray(body.sourceEventIds) ||
        body.sourceEventIds.some(id => typeof id !== "string") || !Array.isArray(body.sourceMissionIds) || body.sourceMissionIds.some(id => typeof id !== "string") ||
        typeof body.idempotencyKey !== "string") {
      return reply.status(400).send({ detail: "NARRATIVE_ARTIFACT_INPUT_INVALID" });
    }
    try { return reply.status(201).send(service.createNarrativeArtifact(body as any)); } catch (error) { return fail(reply, error); }
  });
  server.get("/narrative/artifacts", async (request, reply) => {
    const limit = (request.query as any)?.limit === undefined ? 100 : Number((request.query as any).limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) return reply.status(400).send({ detail: "limit must be 1-500" });
    return reply.send({ items: service.listNarrativeArtifacts(limit) });
  });
  server.get("/chronicle", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).some(key => !["from", "to", "qianjiId", "missionId", "productId", "limit"].includes(key))) return reply.status(400).send({ detail: "CHRONICLE_QUERY_INVALID" });
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    const optionalStrings = ["qianjiId", "missionId", "productId"];
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || typeof query.from !== "string" || typeof query.to !== "string" ||
        optionalStrings.some(key => query[key] !== undefined && typeof query[key] !== "string")) return reply.status(400).send({ detail: "CHRONICLE_QUERY_INVALID" });
    try { return reply.send(service.listChronicle({ from: query.from, to: query.to, qianjiId: query.qianjiId as string | undefined,
      missionId: query.missionId as string | undefined, productId: query.productId as string | undefined, limit })); }
    catch (error) { return fail(reply, error); }
  });
}
