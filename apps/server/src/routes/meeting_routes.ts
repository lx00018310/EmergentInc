import { FastifyInstance } from "fastify";
import { CoreStore } from "@emergentinc/persistence";
import { MeetingService } from "../services/meeting_service.js";

function fail(reply: any, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return reply.status(detail === "MEETING_NOT_FOUND" ? 404 :
    /BUSY|UNAVAILABLE|CONFLICT/.test(detail) ? 409 :
      detail === "MEETING_MODEL_NOT_CONFIGURED" ? 503 : 400).send({ detail });
}

export async function registerMeetingRoutes(server: FastifyInstance, service: MeetingService, store: CoreStore) {
  server.get("/meetings", async (_request, reply) => reply.send({ items: service.list() }));
  server.post("/meetings", async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.topic !== "string" || !Array.isArray(body.participantIds) ||
        body.participantIds.some((id: unknown) => typeof id !== "string") ||
        Object.keys(body).some(key => !["topic", "participantIds"].includes(key))) {
      return reply.status(400).send({ detail: "MEETING_INPUT_INVALID" });
    }
    try { return reply.status(201).send(service.create(body.topic, body.participantIds)); }
    catch (error) { return fail(reply, error); }
  });
  server.get("/meetings/:id", async (request, reply) => {
    try { return reply.send(service.get(String((request.params as any).id))); }
    catch (error) { return fail(reply, error); }
  });
  server.post("/meetings/:id/messages", async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.content !== "string" ||
        Object.keys(body).some(key => key !== "content")) {
      return reply.status(400).send({ detail: "MEETING_MESSAGE_INVALID" });
    }
    try { return reply.send(await service.speak(String((request.params as any).id), body.content)); }
    catch (error) { return fail(reply, error); }
  });

  server.get("/approvals", async (_request, reply) => {
    const rows = store.db.prepare(`SELECT request_id AS requestId,qianji_id AS qianjiId,pixel_id AS pixelId,
      capability,status,decision_reason AS decisionReason,created_at AS createdAt,decided_at AS decidedAt
      FROM qianji_approval_requests ORDER BY created_at DESC LIMIT 100`).all();
    return reply.send({ items: rows });
  });
  server.post("/approvals/:id/decision", async (request, reply) => {
    const body = request.body as any;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        !["approved", "rejected"].includes(body.decision) ||
        (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) ||
        Object.keys(body).some(key => !["decision", "reason"].includes(key))) {
      return reply.status(400).send({ detail: "APPROVAL_DECISION_INVALID" });
    }
    const id = String((request.params as any).id);
    const result = store.db.prepare(`UPDATE qianji_approval_requests
      SET status=?,decision_reason=?,decided_at=?
      WHERE request_id=? AND status='pending'`).run(body.decision, body.reason?.trim() ?? null, Date.now() / 1000, id);
    if (Number(result.changes) !== 1) return reply.status(409).send({ detail: "APPROVAL_NOT_PENDING" });
    return reply.send({ requestId: id, status: body.decision });
  });
}
