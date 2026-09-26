import { FastifyInstance } from "fastify";
import { TrialService } from "../services/trial_service.js";
import { InputValidationError, InputValidationIssue } from "../services/input_validation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function statusFor(message: string): number {
  if (message === "TRIAL_NOT_FOUND" || message === "RECRUITMENT_NOT_FOUND") return 404;
  if (/NOT_DRAFT|NOT_RESUMABLE|IN_PROGRESS|OCCUPIED|LIMIT|RECOVERY|BLOCKED|STATUS|CANCEL|NOT_AWAITING|NOT_CANCELLABLE|BUDGET|EXHAUSTED|MISMATCH|REMAINS|COORDINATE_OCCUPIED|RUNNING/.test(message)) return 409;
  return 400;
}
function fail(reply: any, error: unknown) {
  if (error instanceof InputValidationError) return reply.status(400).send({ detail: error.message, code: error.code, errors: error.errors });
  const message = error instanceof Error ? error.message : String(error);
  return reply.status(statusFor(message)).send({ detail: message });
}

export async function registerTrialRoutes(server: FastifyInstance, service: TrialService): Promise<void> {
  server.get("/recruitments", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return reply.status(400).send({ detail: "limit must be 1-200" });
    return reply.send({ items: service.listRecruitments(limit), limit });
  });
  server.post("/recruitments", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).some(key => !["roleLabel", "jd"].includes(key)) ||
        typeof body.roleLabel !== "string" || !body.roleLabel.trim() || typeof body.jd !== "string" || !body.jd.trim()) {
      return reply.status(400).send({ detail: "RECRUITMENT_FIELDS_REQUIRED" });
    }
    try { return reply.status(201).send(service.createRecruitment({ roleLabel: body.roleLabel, jd: body.jd })); }
    catch (error) { return fail(reply, error); }
  });

  server.get("/trials", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    const status = query.status as any;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return reply.status(400).send({ detail: "limit must be 1-200" });
    if (status !== undefined && !["draft", "running", "awaiting_selection", "completed", "cancelled"].includes(status)) {
      return reply.status(400).send({ detail: "TRIAL_STATUS_INVALID" });
    }
    return reply.send({ items: service.list({ status, limit }), limit });
  });
  server.post("/trials", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).some(key => !["recruitmentId", "challengeText", "acceptanceCriteria", "totalBudgetTokens", "roundsPerCandidate", "candidateBudgetTokens", "allowedTools", "modelName"].includes(key)) ||
        typeof body.challengeText !== "string" || typeof body.acceptanceCriteria !== "string" ||
        !Number.isSafeInteger(body.totalBudgetTokens) || !Number.isSafeInteger(body.roundsPerCandidate) || !Number.isSafeInteger(body.candidateBudgetTokens) ||
        (body.allowedTools !== undefined && (!Array.isArray(body.allowedTools) || body.allowedTools.some(name => typeof name !== "string"))) ||
        (body.modelName !== undefined && typeof body.modelName !== "string") ||
        (body.recruitmentId !== undefined && body.recruitmentId !== null && typeof body.recruitmentId !== "string")) {
      return reply.status(400).send({ detail: "TRIAL_FIELDS_INVALID" });
    }
    try { return reply.status(201).send(service.create(body as any)); }
    catch (error) { return fail(reply, error); }
  });
  server.get("/trials/:id", async (request, reply) => {
    const trial = service.get(String((request.params as any).id ?? ""));
    return trial ? reply.send(service.summary(trial)) : reply.status(404).send({ detail: "TRIAL_NOT_FOUND" });
  });
  server.post("/trials/:id/candidates", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body)) return fail(reply, new InputValidationError("TRIAL_CANDIDATE_INPUT_INVALID", [{ path: "body", message: "must be an object" }]));
    const errors: InputValidationIssue[] = [];
    for (const field of Object.keys(body)) if (!["formalNarrative", "testNarrative", "pixelId", "initialEnergyTokens", "idempotencyKey"].includes(field)) {
      errors.push({ path: field, message: "unknown field" });
    }
    if (typeof body.pixelId !== "string" || !body.pixelId.trim()) errors.push({ path: "pixelId", message: "must be a non-blank coordinate string" });
    if (!Number.isSafeInteger(body.initialEnergyTokens) || Number(body.initialEnergyTokens) < 1) errors.push({ path: "initialEnergyTokens", message: "must be a positive safe integer" });
    if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 200) {
      errors.push({ path: "idempotencyKey", message: "must be a non-blank string of at most 200 characters" });
    }
    for (const field of ["formalNarrative", "testNarrative"]) if (!isRecord(body[field])) errors.push({ path: field, message: "must be an object" });
    if (errors.length) return fail(reply, new InputValidationError("TRIAL_CANDIDATE_INPUT_INVALID", errors));
    try {
      const candidate = service.createCandidate(String((request.params as any).id ?? ""), body as any);
      return reply.status(201).send(candidate);
    } catch (error) { return fail(reply, error); }
  });
  server.post("/trials/:id/start", async (request, reply) => {
    if (request.body !== undefined && (!isRecord(request.body) || Object.keys(request.body).length)) return reply.status(400).send({ detail: "TRIAL_START_INPUT_INVALID" });
    try { return reply.status(202).send(await service.start(String((request.params as any).id ?? ""))); }
    catch (error) { return fail(reply, error); }
  });
  server.post("/trials/:id/resume", async (request, reply) => {
    const body = request.body;
    if (body !== undefined && (!isRecord(body) || Object.keys(body).some(key => key !== "rounds") ||
        (body.rounds !== undefined && (!Number.isSafeInteger(body.rounds) || Number(body.rounds) < 1)))) return reply.status(400).send({ detail: "TRIAL_RESUME_INPUT_INVALID" });
    try { return reply.status(202).send(await service.resume(String((request.params as any).id ?? ""), isRecord(body) && body.rounds !== undefined ? Number(body.rounds) : undefined)); }
    catch (error) { return fail(reply, error); }
  });
  server.post("/trials/:id/select", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).some(key => !["winnerQianjiId", "reason", "evidenceIds", "idempotencyKey"].includes(key)) ||
        (body.winnerQianjiId !== null && typeof body.winnerQianjiId !== "string") || typeof body.reason !== "string" ||
        !Array.isArray(body.evidenceIds) || body.evidenceIds.some(id => typeof id !== "string") ||
        typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 200) {
      return reply.status(400).send({ detail: "TRIAL_DECISION_INPUT_INVALID" });
    }
    try { return reply.send(service.select({ trialId: String((request.params as any).id ?? ""), ...body } as any)); }
    catch (error) { return fail(reply, error); }
  });
  server.post("/trials/:id/cancel", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).some(key => key !== "reason") || typeof body.reason !== "string") return reply.status(400).send({ detail: "TRIAL_CANCEL_INPUT_INVALID" });
    try { return reply.send(await service.cancel(String((request.params as any).id ?? ""), body.reason)); }
    catch (error) { return fail(reply, error); }
  });
}
