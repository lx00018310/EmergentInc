import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getNeighbors6 } from "@emergentinc/domain";
import { CoreStore, MissionDraftInput } from "@emergentinc/persistence";
import { Mission, Execution } from "@emergentinc/protocol";
import { RunService } from "./run_service.js";
import { containedPath, validatePathSegment } from "./safe_path.js";

export interface MissionServiceOptions {
  store: CoreStore;
  workspaceRoot: string;
  runService: RunService;
  enabledTools?: string[];
  modelName?: string;
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mandateFromSnapshot(snapshot: Record<string, unknown>, qianjiId: string): string {
  const participants = Array.isArray(snapshot.participants) ? snapshot.participants as Array<Record<string, unknown>> : [];
  const self = participants.find(p => p.qianjiId === qianjiId);
  const isTrial = typeof snapshot.challengeText === "string";
  return [
    `# ${isTrial ? "统一试炼" : "阁主令"}：${String(snapshot.title ?? snapshot.trialId ?? "未命名任务")}`,
    `\n## 共同目标\n${String(snapshot.objective ?? snapshot.challengeText ?? "")}`,
    `\n## 验收标准\n${String(snapshot.acceptanceCriteria ?? "")}`,
    `\n## 预算与轮次\nToken 上限 ${String(snapshot.budgetTokens ?? "未知")}；轮次上限 ${String(snapshot.roundsLimit ?? "未知")}。`,
    self?.duty ? `\n## 本人职责\n${String(self.duty)}` : "",
  ].join("");
}

export class MissionService {
  private readonly store: CoreStore;
  private readonly workspaceRoot: string;
  private readonly runService: RunService;
  private readonly enabledTools: string[];
  private readonly modelName: string;

  constructor(options: MissionServiceOptions) {
    this.store = options.store;
    this.workspaceRoot = options.workspaceRoot;
    this.runService = options.runService;
    this.enabledTools = [...new Set((options.enabledTools ?? []).filter(name =>
      !["list_private_files", "read_private_file", "inspect_private_image"].includes(name)))];
    this.modelName = options.modelName ?? "unknown";
  }

  public create(input: MissionDraftInput): Mission {
    this.assertUniqueParticipants(input.participants.map(p => p.qianjiId));
    return this.store.missions.createDraft(input);
  }

  public update(missionId: string, input: MissionDraftInput): Mission {
    this.assertUniqueParticipants(input.participants.map(p => p.qianjiId));
    return this.store.missions.updateDraft(missionId, input);
  }

  public get(missionId: string): Mission | null {
    return this.store.missions.get(missionId);
  }

  public list(options: { status?: Mission["status"]; limit?: number } = {}): Mission[] {
    return this.store.missions.list(options);
  }

  public issue(missionId: string): Mission {
    return this.store.transaction(() => {
      const mission = this.requireMission(missionId);
      if (mission.status !== "draft") throw new Error("MISSION_NOT_DRAFT");
      if (!mission.participants.some(p => p.qianjiId === mission.ownerQianjiId)) throw new Error("MISSION_OWNER_MUST_PARTICIPATE");
      const members = mission.participants.map(participant => {
        const profile = this.store.qianji.getProfile(participant.qianjiId);
        const binding = this.store.qianji.getCurrentBindingByQianji(participant.qianjiId);
        const account = binding ? this.store.pixels.getPixelAccount(binding.pixelId) : null;
        if (!profile || profile.careerStatus !== "active") throw new Error(`MISSION_PARTICIPANT_NOT_ACTIVE:${participant.qianjiId}`);
        if (!binding || binding.bindingId !== participant.bindingId || !account?.active || account.refundDeficitTokens > 0) {
          throw new Error(`MISSION_BINDING_INVALID:${participant.qianjiId}`);
        }
        if (this.store.executions.getOpenExecutionForBinding(binding.bindingId)) throw new Error(`MISSION_PARTICIPANT_OCCUPIED:${participant.qianjiId}`);
        return { ...participant, pixelId: binding.pixelId };
      });
      this.assertConnected(members.map(member => member.pixelId));
      const snapshot = {
        schemaVersion: 1,
        missionId: mission.missionId,
        title: mission.title,
        missionType: mission.missionType,
        objective: mission.objective,
        acceptanceCriteria: mission.acceptanceCriteria,
        budgetTokens: mission.budgetTokens,
        roundsLimit: mission.roundsLimit,
        deadlineRound: mission.deadlineRound,
        modelName: this.modelName,
        participants: members.map(({ qianjiId, bindingId, pixelId, duty }) => ({ qianjiId, bindingId, pixelId, duty })),
      };
      const execution = this.store.executions.create({
        kind: "mission", subjectId: mission.missionId, budgetTokens: mission.budgetTokens,
        roundsLimit: mission.roundsLimit, inputSnapshot: snapshot, toolsSnapshot: this.enabledTools,
        bindingIds: members.map(member => member.bindingId),
      });
      this.store.missions.setExecution(mission.missionId, execution.executionId);
      return this.store.missions.transition(mission.missionId, "draft", "issued", { executionId: execution.executionId });
    });
  }

  public async start(missionId: string, rounds: number): Promise<unknown> {
    return this.startOrResume(missionId, rounds, false);
  }

  public async resume(missionId: string, rounds: number): Promise<unknown> {
    return this.startOrResume(missionId, rounds, true);
  }

  private async startOrResume(missionId: string, rounds: number, resume: boolean): Promise<unknown> {
    const mission = this.requireMission(missionId);
    const expectedMissionStatus = resume ? "running" : "issued";
    if (mission.status !== expectedMissionStatus) throw new Error(resume ? "MISSION_NOT_RESUMABLE" : "MISSION_NOT_ISSUED");
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error("MISSION_ROUNDS_INVALID");
    const execution = mission.executionId ? this.store.executions.get(mission.executionId) : null;
    if (!execution || execution.kind !== "mission" || execution.subjectId !== missionId) throw new Error("MISSION_EXECUTION_MISSING");
    if (execution.status === "blocked") throw new Error("MISSION_RECOVERY_REQUIRED");
    if (execution.status !== "ready" && execution.status !== "awaiting_review") throw new Error(`MISSION_EXECUTION_NOT_STARTABLE:${execution.status}`);
    const currentRound = this.runService.getWorldRound();
    const nextRound = currentRound + execution.roundsUsed + 1;
    if (mission.deadlineRound !== null && nextRound + rounds - 1 > mission.deadlineRound) throw new Error("MISSION_DEADLINE_EXCEEDED");

    const initialStart = !resume;
    const result = await this.runService.start({
      rounds,
      runBudgetTokens: mission.budgetTokens,
      executionId: execution.executionId,
      onRunCreated: () => this.store.transaction(() => {
        const freshMission = this.requireMission(missionId);
        const freshExecution = this.store.executions.get(execution.executionId);
        if (!freshExecution || freshExecution.status !== (initialStart ? "ready" : "awaiting_review")) {
          throw new Error("MISSION_EXECUTION_STATE_CHANGED");
        }
        this.store.executions.transition(execution.executionId, freshExecution.status, "running");
        if (initialStart) this.store.missions.transition(missionId, "issued", "running", { executionId: execution.executionId });
        for (const participant of freshMission.participants) {
          const binding = this.store.qianji.getBinding(participant.bindingId);
          if (!binding || binding.unboundAt !== null) throw new Error("MISSION_BINDING_CHANGED");
          this.store.messages.enqueueMessage({
            executionId: execution.executionId,
            roundNum: currentRound + freshExecution.roundsUsed + 1,
            sender: "human", recipient: binding.pixelId,
            content: mandateFromSnapshot(freshExecution.inputSnapshot, participant.qianjiId),
            sourceType: "human", senderBindingId: null, recipientBindingId: binding.bindingId,
          });
        }
      }),
      onRunFinalized: (_runId, finalizedExecutionId, status) => {
        if (status === "awaiting_review") {
          this.captureEvidence(finalizedExecutionId);
          this.markAwaitingAcceptance(finalizedExecutionId);
        }
      },
    });
    return result;
  }

  public collectEvidence(missionId: string): ReturnType<CoreStore["executions"]["listEvidence"]> {
    const mission = this.requireMission(missionId);
    if (!mission.executionId) throw new Error("MISSION_EXECUTION_MISSING");
    const execution = this.store.executions.get(mission.executionId);
    if (!execution || execution.status !== "awaiting_review") throw new Error("MISSION_NOT_READY_FOR_EVIDENCE");
    const evidence = this.captureEvidence(execution.executionId);
    this.markAwaitingAcceptance(execution.executionId);
    return evidence;
  }

  public captureExecutionEvidence(executionId: string): ReturnType<CoreStore["executions"]["listEvidence"]> {
    return this.captureEvidence(executionId);
  }

  public listEvidence(missionId: string): ReturnType<CoreStore["executions"]["listEvidence"]> {
    const mission = this.requireMission(missionId);
    return mission.executionId ? this.store.executions.listEvidence(mission.executionId) : [];
  }

  public accept(input: { missionId: string; outcome: "completed" | "failed"; note: string; evidenceIds: string[]; idempotencyKey: string }): Mission {
    if (!input.note.trim() || input.note.length > 4000) throw new Error("MISSION_ACCEPTANCE_NOTE_REQUIRED");
    if (!Array.isArray(input.evidenceIds) || new Set(input.evidenceIds).size !== input.evidenceIds.length) throw new Error("MISSION_EVIDENCE_IDS_INVALID");
    return this.store.ownerActions.execute(input.idempotencyKey, `mission.accept:${input.missionId}`, input, () => this.store.transaction(() => {
      const mission = this.requireMission(input.missionId);
      if (mission.status !== "awaiting_acceptance" || !mission.executionId) throw new Error("MISSION_NOT_AWAITING_ACCEPTANCE");
      const execution = this.store.executions.get(mission.executionId);
      if (!execution || execution.status !== "awaiting_review" || execution.reservedTokens !== 0) throw new Error("MISSION_EXECUTION_UNSETTLED");
      const evidence = this.store.executions.listEvidence(execution.executionId);
      const evidenceById = new Map(evidence.map(item => [item.evidenceId, item]));
      for (const id of input.evidenceIds) {
        const item = evidenceById.get(id);
        if (!item) throw new Error(`MISSION_EVIDENCE_NOT_FOUND:${id}`);
        this.assertEvidenceSnapshot(item);
      }
      this.store.missions.setAcceptance(input.missionId, input.note.trim());
      this.store.missions.transition(input.missionId, "awaiting_acceptance", input.outcome, {
        executionId: execution.executionId, evidenceIds: input.evidenceIds,
      });
      this.store.executions.transition(execution.executionId, "awaiting_review", "closed");
      this.store.executions.releaseParticipants(execution.executionId);
      return this.requireMission(input.missionId);
    }));
  }

  public async cancel(missionId: string, reason: string): Promise<Mission> {
    if (!reason.trim() || reason.length > 1000) throw new Error("MISSION_CANCEL_REASON_REQUIRED");
    const mission = this.requireMission(missionId);
    if (["completed", "failed", "cancelled"].includes(mission.status)) throw new Error("MISSION_ALREADY_TERMINAL");
    if (!mission.executionId) return this.store.missions.transition(missionId, mission.status, "cancelled", { reason: reason.trim() });
    const execution = this.store.executions.get(mission.executionId);
    if (!execution) throw new Error("MISSION_EXECUTION_MISSING");
    if (this.runService.getStatus().running) {
      const activeRunId = this.runService.getStatus().run_id;
      const activeRun = activeRunId ? this.store.runs.getRun(activeRunId) : null;
      if (activeRun?.execution_id !== execution.executionId) throw new Error("OTHER_RUN_IN_PROGRESS");
      this.runService.requestStop();
      for (let i = 0; i < 600 && this.runService.getStatus().running; i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (this.runService.getStatus().running) throw new Error("MISSION_STOP_TIMEOUT");
    }
    return this.store.transaction(() => {
      const fresh = this.requireMission(missionId);
      const currentExecution = this.store.executions.get(execution.executionId);
      if (!currentExecution) throw new Error("MISSION_EXECUTION_MISSING");
      const unresolved = this.store.db.prepare(`SELECT
          (SELECT COUNT(*) FROM reservations WHERE execution_id=? AND status='OPEN') +
          (SELECT COUNT(*) FROM messages WHERE execution_id=? AND status IN ('PROCESSING','RESERVED','CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT')) AS count`)
        .get(execution.executionId, execution.executionId) as any;
      if (Number(unresolved.count) > 0 || currentExecution.reservedTokens !== 0 || currentExecution.status === "blocked") {
        throw new Error("MISSION_RECOVERY_REQUIRED");
      }
      this.store.db.prepare(`UPDATE messages SET status='ABANDONED', abandoned_reason='Mission cancelled by Owner', updated_at=?
        WHERE execution_id=? AND status IN ('QUEUED','WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET')`)
        .run(Date.now() / 1000, execution.executionId);
      if (currentExecution.status !== "closed") this.store.executions.transition(execution.executionId, currentExecution.status, "closed");
      this.store.executions.releaseParticipants(execution.executionId);
      return this.store.missions.transition(missionId, fresh.status, "cancelled", { reason: reason.trim() });
    });
  }

  public getEffectiveMandate(qianjiId: string): { source: "manual" | "mission" | "trial"; content: string; relatedId: string | null } {
    const binding = this.store.qianji.getCurrentBindingByQianji(qianjiId);
    if (binding) {
      const execution = this.store.executions.getOpenExecutionForBinding(binding.bindingId);
      if (execution) {
        if (execution.kind === "mission") return { source: "mission", content: mandateFromSnapshot(execution.inputSnapshot, qianjiId), relatedId: execution.subjectId };
        return { source: "trial", content: mandateFromSnapshot(execution.inputSnapshot, qianjiId), relatedId: execution.subjectId };
      }
    }
    if (!binding) return { source: "manual", content: "", relatedId: null };
    const filePath = containedPath(this.workspaceRoot, "live", "pixels", binding.pixelId, "mandate.md");
    return { source: "manual", content: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "", relatedId: null };
  }

  public markAwaitingAcceptance(executionId: string): void {
    const execution = this.store.executions.get(executionId);
    if (!execution || execution.kind !== "mission" || execution.status !== "awaiting_review") return;
    const mission = this.store.missions.get(execution.subjectId);
    if (mission?.status === "running") this.store.missions.transition(mission.missionId, "running", "awaiting_acceptance", { executionId });
  }

  private captureEvidence(executionId: string) {
    const existing = this.store.executions.listEvidence(executionId);
    const byOperation = new Set(existing.map(item => item.operationId).filter(Boolean));
    const rows = this.store.db.prepare(`SELECT te.operation_id AS operationId, te.pixel_id AS pixelId, te.result,
        ep.binding_id AS bindingId
      FROM tool_executions te JOIN messages m ON m.message_id=te.message_id
      JOIN execution_participants ep ON ep.execution_id=m.execution_id
      JOIN qianji_bindings b ON b.binding_id=ep.binding_id AND b.pixel_id=te.pixel_id
      WHERE m.execution_id=? AND te.tool='save_artifact' AND te.status='SUCCESS'
      ORDER BY te.started_at, te.operation_id`).all(executionId) as any[];
    for (const row of rows) {
      if (byOperation.has(String(row.operationId))) continue;
      const receipt = JSON.parse(String(row.result ?? "{}")) as Record<string, unknown>;
      const filename = String(receipt.filename ?? "");
      validatePathSegment(filename);
      if (!/^[a-f0-9]{64}$/.test(String(receipt.sha256 ?? "")) || !Number.isSafeInteger(receipt.size_bytes)) {
        throw new Error(`EVIDENCE_RECEIPT_INVALID:${row.operationId}`);
      }
      const source = containedPath(this.workspaceRoot, "evidence", executionId, "artifacts", String(row.pixelId), filename);
      if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`EVIDENCE_SOURCE_MISSING:${filename}`);
      const bytes = fs.readFileSync(source);
      if (digest(bytes) !== receipt.sha256 || bytes.length !== Number(receipt.size_bytes)) throw new Error(`EVIDENCE_SOURCE_CHANGED:${filename}`);
      const evidenceId = `evidence_${randomUUID()}`;
      const destinationRelative = path.posix.join("evidence", executionId, "snapshots", evidenceId, filename);
      const destination = containedPath(this.workspaceRoot, ...destinationRelative.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes, { flag: "wx" });
      const saved = fs.readFileSync(destination);
      if (digest(saved) !== String(receipt.sha256) || saved.length !== bytes.length) {
        throw new Error(`EVIDENCE_SNAPSHOT_VERIFY_FAILED:${filename}`);
      }
      this.store.executions.addEvidence({ evidenceId, executionId, bindingId: String(row.bindingId),
        operationId: String(row.operationId), relativePath: destinationRelative,
        sha256: String(receipt.sha256), sizeBytes: bytes.length, evidenceType: "text_artifact" });
      byOperation.add(String(row.operationId));
    }
    return this.store.executions.listEvidence(executionId);
  }

  private assertEvidenceSnapshot(evidence: ReturnType<CoreStore["executions"]["listEvidence"]>[number]): void {
    if (!evidence.relativePath || !evidence.sha256 || evidence.sizeBytes === null) throw new Error("MISSION_EVIDENCE_INCOMPLETE");
    const segments = evidence.relativePath.split("/");
    if (segments[0] !== "evidence" || !segments.includes("snapshots")) throw new Error("MISSION_EVIDENCE_PATH_INVALID");
    const snapshotPath = containedPath(this.workspaceRoot, ...segments);
    if (!fs.existsSync(snapshotPath) || !fs.statSync(snapshotPath).isFile()) throw new Error("MISSION_EVIDENCE_SNAPSHOT_MISSING");
    const bytes = fs.readFileSync(snapshotPath);
    if (digest(bytes) !== evidence.sha256 || bytes.length !== evidence.sizeBytes) throw new Error("MISSION_EVIDENCE_SNAPSHOT_CHANGED");
  }

  private assertConnected(pixelIds: string[]): void {
    if (!pixelIds.length) throw new Error("MISSION_PARTICIPANTS_REQUIRED");
    const remaining = new Set(pixelIds);
    const visited = new Set<string>();
    const queue = [pixelIds[0]];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of getNeighbors6(current)) if (remaining.has(neighbor) && !visited.has(neighbor)) queue.push(neighbor);
    }
    if (visited.size !== remaining.size) throw new Error("MISSION_PARTICIPANTS_NOT_CONNECTED");
  }

  private assertUniqueParticipants(ids: string[]): void {
    if (new Set(ids).size !== ids.length) throw new Error("MISSION_DUPLICATE_PARTICIPANT");
  }

  private requireMission(id: string): Mission {
    const mission = this.store.missions.get(id);
    if (!mission) throw new Error("MISSION_NOT_FOUND");
    return mission;
  }
}
