import { FastifyInstance } from "fastify";
import { MissionDraftInput } from "@emergentinc/persistence";
import { MissionService } from "../services/mission_service.js";
import { InputValidationError, InputValidationIssue } from "../services/input_validation.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function missionInput(value: unknown): MissionDraftInput | InputValidationError {
  if (!isRecord(value)) return new InputValidationError("MISSION_INPUT_INVALID", [{ path: "body", message: "must be an object" }]);
  const errors: InputValidationIssue[] = [];
  const allowed = ["title", "missionType", "objective", "acceptanceCriteria", "budgetTokens", "roundsLimit", "deadlineRound", "ownerQianjiId", "participants"];
  for (const field of Object.keys(value)) if (!allowed.includes(field)) errors.push({ path: field, message: "unknown field" });
  for (const field of ["title", "missionType", "objective", "acceptanceCriteria", "ownerQianjiId"]) {
    if (typeof value[field] !== "string" || !(value[field] as string).trim()) errors.push({ path: field, message: "must be a non-blank string" });
  }
  for (const field of ["budgetTokens", "roundsLimit"]) {
    if (!Number.isSafeInteger(value[field]) || Number(value[field]) < 1) errors.push({ path: field, message: "must be a positive safe integer" });
  }
  if (value.deadlineRound != null && (!Number.isSafeInteger(value.deadlineRound) || Number(value.deadlineRound) < 1)) {
    errors.push({ path: "deadlineRound", message: "must be a positive safe integer or null" });
  }
  if (!Array.isArray(value.participants) || value.participants.length < 1) {
    errors.push({ path: "participants", message: "must contain at least one participant" });
  } else value.participants.forEach((participant, index) => {
    const prefix = `participants.${index}`;
    if (!isRecord(participant)) { errors.push({ path: prefix, message: "must be an object" }); return; }
    for (const field of ["qianjiId", "bindingId"]) {
      if (typeof participant[field] !== "string" || !(participant[field] as string).trim()) errors.push({ path: `${prefix}.${field}`, message: "must be a non-blank string" });
    }
    if (participant.duty != null && typeof participant.duty !== "string") errors.push({ path: `${prefix}.duty`, message: "must be a string or null" });
  });
  if (errors.length) return new InputValidationError("MISSION_INPUT_INVALID", errors);
  return value as unknown as MissionDraftInput;
}

function sendError(reply: any, error: unknown): any {
  if (error instanceof InputValidationError) return reply.status(400).send({ detail: error.message, code: error.code, errors: error.errors });
  const message = error instanceof Error ? error.message : String(error);
  const notFound = message === "MISSION_NOT_FOUND";
  const conflict = /CONFLICT|OCCUPIED|NOT_DRAFT|NOT_ISSUED|NOT_RESUMABLE|RECOVERY|UNSETTLED|TERMINAL|DEADLINE|NOT_AWAITING|NOT_STARTABLE|STATE_CHANGED|ALREADY|BUDGET_EXHAUSTED|ROUND_LIMIT/.test(message);
  return reply.status(notFound ? 404 : conflict ? 409 : 400).send({ detail: message });
}

export async function registerOrganizationRoutes(server: FastifyInstance, missionService: MissionService): Promise<void> {
  const withProgress = (mission: NonNullable<ReturnType<MissionService["get"]>>) => ({
    ...mission,
    execution: missionService.getExecutionProgress(mission.missionId),
  });

  server.get("/missions", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return reply.status(400).send({ detail: "limit must be 1-200" });
    const status = query.status as any;
    if (status !== undefined && !["draft", "issued", "running", "awaiting_acceptance", "completed", "failed", "cancelled"].includes(status)) {
      return reply.status(400).send({ detail: "MISSION_STATUS_INVALID" });
    }
    return reply.send({ items: missionService.list({ status, limit }).map(withProgress), limit });
  });

  server.post("/missions", async (request, reply) => {
    const input = missionInput(request.body);
    if (input instanceof InputValidationError) return sendError(reply, input);
    try { return reply.status(201).send(missionService.create(input)); }
    catch (error) { return sendError(reply, error); }
  });

  server.get("/missions/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    const mission = missionService.get(id);
    return mission ? reply.send(withProgress(mission)) : reply.status(404).send({ detail: "MISSION_NOT_FOUND" });
  });

  server.get("/missions/:id/evidence", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { return reply.send({ evidence: missionService.listEvidence(id) }); }
    catch (error) { return sendError(reply, error); }
  });

  server.put("/missions/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    const input = missionInput(request.body);
    if (input instanceof InputValidationError) return sendError(reply, input);
    try { return reply.send(missionService.update(id, input)); }
    catch (error) { return sendError(reply, error); }
  });

  server.post("/missions/:id/issue", async (request, reply) => {
    try { return reply.send(missionService.issue(String((request.params as any).id ?? ""))); }
    catch (error) { return sendError(reply, error); }
  });

  for (const action of ["start", "resume"] as const) {
    server.post(`/missions/:id/${action}`, async (request, reply) => {
      const body = request.body;
      if (!isRecord(body) || Object.keys(body).some(key => key !== "rounds") || !Number.isSafeInteger(body.rounds) || Number(body.rounds) < 1) {
        return reply.status(400).send({ detail: "rounds must be a positive safe integer" });
      }
      try {
        const result = action === "start"
          ? await missionService.start(String((request.params as any).id ?? ""), Number(body.rounds))
          : await missionService.resume(String((request.params as any).id ?? ""), Number(body.rounds));
        return reply.status(202).send(result);
      } catch (error) { return sendError(reply, error); }
    });
  }

  server.post("/missions/:id/evidence", async (request, reply) => {
    try { return reply.send({ evidence: missionService.collectEvidence(String((request.params as any).id ?? "")) }); }
    catch (error) { return sendError(reply, error); }
  });

  server.post("/missions/:id/accept", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).some(key => !["outcome", "note", "evidenceIds", "idempotencyKey"].includes(key)) ||
        !["completed", "failed"].includes(String(body.outcome)) || typeof body.note !== "string" ||
        !Array.isArray(body.evidenceIds) || body.evidenceIds.some(id => typeof id !== "string") ||
        typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 200) {
      return reply.status(400).send({ detail: "MISSION_ACCEPTANCE_INPUT_INVALID" });
    }
    try { return reply.send(missionService.accept({ missionId: String((request.params as any).id ?? ""), ...body } as any)); }
    catch (error) { return sendError(reply, error); }
  });

  server.post("/missions/:id/cancel", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || Object.keys(body).some(key => key !== "reason") || typeof body.reason !== "string") {
      return reply.status(400).send({ detail: "MISSION_CANCEL_INPUT_INVALID" });
    }
    try { return reply.send(await missionService.cancel(String((request.params as any).id ?? ""), body.reason)); }
    catch (error) { return sendError(reply, error); }
  });
}
