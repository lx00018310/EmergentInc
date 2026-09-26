import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CoreStore, TrialDraftInput } from "@emergentinc/persistence";
import { QianjiNarrativeSpec, Trial, TrialCandidate } from "@emergentinc/protocol";
import { validateQianjiNarrative } from "@emergentinc/domain";
import { RunService } from "./run_service.js";
import { containedPath, validatePathSegment } from "./safe_path.js";
import { InputValidationError } from "./input_validation.js";

const COORDINATE = /^-?(0|[1-9]\d*)_-?(0|[1-9]\d*)_-?(0|[1-9]\d*)$/;
const DEFAULT_TOOLS = ["save_artifact", "read_artifact", "list_artifacts"];
const EXTRA_TOOLS = ["webfetch", "github_repo"];

export interface TrialServiceOptions {
  store: CoreStore;
  workspaceRoot: string;
  runService: RunService;
  enabledTools: string[];
  modelName: string;
  captureEvidence: (executionId: string) => unknown[];
}

export interface TrialCandidateInput {
  formalNarrative: QianjiNarrativeSpec;
  testNarrative: QianjiNarrativeSpec;
  pixelId: string;
  initialEnergyTokens: number;
  idempotencyKey: string;
}

export class TrialService {
  private readonly store: CoreStore;
  private readonly workspaceRoot: string;
  private readonly runService: RunService;
  private readonly enabledTools: Set<string>;
  private readonly modelName: string;
  private readonly captureEvidence: (executionId: string) => unknown[];

  constructor(options: TrialServiceOptions) {
    this.store = options.store;
    this.workspaceRoot = options.workspaceRoot;
    this.runService = options.runService;
    this.enabledTools = new Set(options.enabledTools);
    this.modelName = options.modelName;
    this.captureEvidence = options.captureEvidence;
  }

  public createRecruitment(input: { roleLabel: string; jd: string }) {
    if (!input.roleLabel.trim() || !input.jd.trim()) throw new Error("RECRUITMENT_FIELDS_REQUIRED");
    return this.store.transaction(() => {
      const recruitment = this.store.trials.createRecruitment(input.roleLabel, input.jd);
      this.store.worldEvents.append({ eventType: "RECRUITMENT_POSTED", subjectType: "trial", subjectId: recruitment.recruitmentId,
        sourceKey: `recruitment:${recruitment.recruitmentId}:posted`, payload: { roleLabel: recruitment.roleLabel } });
      return recruitment;
    });
  }

  public listRecruitments(limit = 50) { return this.store.trials.listRecruitments(limit); }
  public list(options: { status?: Trial["status"]; limit?: number } = {}) {
    return this.store.trials.list(options).map(trial => this.summary(trial));
  }
  public get(id: string) { return this.store.trials.get(id); }

  public summary(trial: Trial) {
    return { ...trial, candidates: trial.candidates.map(candidate => {
      const execution = this.store.executions.get(candidate.executionId);
      if (!execution) return { ...candidate, execution: null };
      const models = this.store.db.prepare("SELECT cost_cny FROM model_calls WHERE execution_id=?").all(execution.executionId) as any[];
      const tools = this.store.db.prepare(`SELECT te.cost_cny FROM tool_executions te JOIN messages m ON m.message_id=te.message_id
        WHERE m.execution_id=?`).all(execution.executionId) as any[];
      const unknownModelCount = models.filter(row => row.cost_cny == null).length;
      const unknownToolCount = tools.filter(row => row.cost_cny == null).length;
      const knownCostCny = Number((models.reduce((sum, row) => sum + (row.cost_cny == null ? 0 : Number(row.cost_cny)), 0) +
        tools.reduce((sum, row) => sum + (row.cost_cny == null ? 0 : Number(row.cost_cny)), 0)).toFixed(8));
      const latestRun = this.store.db.prepare("SELECT stop_reason,error_summary FROM runs WHERE execution_id=? ORDER BY created_at DESC LIMIT 1")
        .get(execution.executionId) as any;
      return { ...candidate, execution: { status: execution.status, spentTokens: execution.spentTokens,
        reservedTokens: execution.reservedTokens, roundsUsed: execution.roundsUsed, roundsLimit: execution.roundsLimit,
        knownCostCny, totalCostCny: unknownModelCount + unknownToolCount ? null : knownCostCny,
        unknownModelCount, unknownToolCount, stopReason: latestRun?.stop_reason ?? null,
        errorSummary: latestRun?.error_summary ?? null, evidence: this.store.executions.listEvidence(execution.executionId) } };
    }) };
  }

  public create(input: Omit<TrialDraftInput, "modelName" | "allowedTools"> & { modelName?: string; allowedTools?: string[] }): Trial {
    const modelName = input.modelName?.trim() || this.modelName;
    if (!modelName || modelName === "unknown") throw new Error("TRIAL_MODEL_UNAVAILABLE");
    const allowedTools = input.allowedTools === undefined
      ? DEFAULT_TOOLS.filter(name => this.enabledTools.has(name))
      : input.allowedTools;
    if (!allowedTools.length || allowedTools.some(name => !this.enabledTools.has(name) || ![...DEFAULT_TOOLS, ...EXTRA_TOOLS].includes(name))) {
      throw new Error("TRIAL_TOOLS_INVALID");
    }
    if (new Set(allowedTools).size !== allowedTools.length) throw new Error("TRIAL_TOOLS_DUPLICATE");
    return this.store.trials.createDraft({ ...input, modelName, allowedTools });
  }

  public createCandidate(trialId: string, input: TrialCandidateInput): TrialCandidate {
    if (!COORDINATE.test(input.pixelId) || input.pixelId.split("_").length !== 3) throw new Error("CANDIDATE_COORDINATE_INVALID");
    for (const coordinate of input.pixelId.split("_")) if (!Number.isSafeInteger(Number(coordinate))) throw new Error("CANDIDATE_COORDINATE_INVALID");
    if (!Number.isSafeInteger(input.initialEnergyTokens) || input.initialEnergyTokens < 1) throw new Error("CANDIDATE_INITIAL_ENERGY_INVALID");
    const formal = validateQianjiNarrative(input.formalNarrative);
    const test = validateQianjiNarrative(input.testNarrative);
    if (!formal.valid || !test.valid) {
      const errors = [
        ...formal.errors.map(issue => ({ ...issue, path: issue.path.replace(/^narrative/, "formalNarrative") })),
        ...test.errors.map(issue => ({ ...issue, path: issue.path.replace(/^narrative/, "testNarrative") })),
      ];
      throw new InputValidationError("CANDIDATE_NARRATIVE_INVALID", errors);
    }
    const stageKey = createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24);
    const stagingRoot = containedPath(this.workspaceRoot, "runtime", "trial-candidate-staging");
    const stage = containedPath(stagingRoot, stageKey);
    const pixelDestination = containedPath(this.workspaceRoot, "live", "pixels", input.pixelId);
    const artifactDestination = containedPath(this.workspaceRoot, "live", "artifacts", input.pixelId);
    let installedPixel = false;
    let installedArtifacts = false;
    return this.store.ownerActions.execute(input.idempotencyKey, `trial.candidate.create:${trialId}`, input, () => {
      const trial = this.store.trials.get(trialId);
      if (!trial) throw new Error("TRIAL_NOT_FOUND");
      if (trial.status !== "draft") throw new Error("TRIAL_NOT_DRAFT");
      const count = trial.candidates.length;
      if (count >= 3) throw new Error("TRIAL_CANDIDATE_LIMIT_REACHED");
      if ((count + 1) * trial.candidateBudgetTokens > trial.totalBudgetTokens) throw new Error("TRIAL_BUDGET_CANNOT_COVER_CANDIDATES");
      if (input.initialEnergyTokens < trial.candidateBudgetTokens) throw new Error("CANDIDATE_ENERGY_BELOW_BUDGET");
      if (count > 0) {
        const existingEnergy = this.store.pixels.getPixelAccount(trial.candidates[0].qianjiId
          ? this.store.qianji.getCurrentBindingByQianji(trial.candidates[0].qianjiId)?.pixelId ?? ""
          : "")?.energy;
        if (existingEnergy !== input.initialEnergyTokens) throw new Error("TRIAL_CANDIDATE_ENERGY_MUST_MATCH");
      }
      const bindingHistory = this.store.db.prepare("SELECT COUNT(*) AS count FROM qianji_bindings WHERE pixel_id=?").get(input.pixelId) as any;
      const account = this.store.pixels.getPixelAccount(input.pixelId);
      if (Number(bindingHistory.count) > 0 || account || fs.existsSync(pixelDestination) || fs.existsSync(artifactDestination)) {
        throw new Error("CANDIDATE_COORDINATE_OCCUPIED");
      }
      if (fs.existsSync(stage)) throw new Error("CANDIDATE_STAGING_REMAINS");

      const candidateId = `candidate_${randomUUID()}`;
      const qianjiId = `qj_${randomUUID()}`;
      const bindingId = `binding_${randomUUID()}`;
      const executionId = `execution_${randomUUID()}`;
      const rules = this.rulesSnapshot(trial);
      const snapshot = { schemaVersion: 1, trialId, candidateId, ...rules,
        participants: [{ qianjiId, bindingId, pixelId: input.pixelId, duty: "完成统一试炼题目" }] };

      fs.mkdirSync(stagingRoot, { recursive: true });
      fs.mkdirSync(stage, { recursive: false });
      const stagedPixel = path.join(stage, "pixel");
      const stagedArtifacts = path.join(stage, "artifacts");
      fs.mkdirSync(stagedPixel);
      fs.mkdirSync(stagedArtifacts);
      fs.writeFileSync(path.join(stagedPixel, "pixel.md"), "", "utf8");
      fs.writeFileSync(path.join(stagedPixel, "tips.md"), "", "utf8");
      fs.writeFileSync(path.join(stagedPixel, "mandate.md"), "", "utf8");
      fs.writeFileSync(path.join(stagedPixel, "state.json"), JSON.stringify({
        id: input.pixelId, pixel_id: input.pixelId, energy: input.initialEnergyTokens, active: true,
        incarnation: 1, generation: 1, born_round: 0, last_active_round: 0,
      }, null, 2), "utf8");

      try {
        this.store.transaction(() => {
          this.store.pixels.upsertPixelAccount({ pixelId: input.pixelId, energy: 0, active: true,
            refundDeficitTokens: 0, spendBlockedReason: null });
          const profile = this.store.qianji.createProfile({ qianjiId, careerStatus: "candidate", narrative: test.value });
          const binding = this.store.qianji.createBinding({ bindingId, qianjiId, pixelId: input.pixelId, incarnation: 1 });
          this.store.applyExternalReward({ pixelId: input.pixelId, amount: input.initialEnergyTokens,
            idempotencyKey: `trial_seed:${input.idempotencyKey}`, source: "trial_seed", reason: `Trial candidate ${trialId}` });
          const execution = this.store.executions.create({ kind: "trial_candidate", subjectId: trialId,
            budgetTokens: trial.candidateBudgetTokens, roundsLimit: trial.roundsPerCandidate,
            inputSnapshot: snapshot, toolsSnapshot: trial.allowedTools, bindingIds: [binding.bindingId] });
          const candidate = this.store.trials.addCandidate({ trialId, qianjiId: profile.qianjiId,
            bindingId: binding.bindingId, executionId: execution.executionId, ordinal: count + 1,
            formalNarrative: formal.value }, candidateId);
          fs.mkdirSync(path.dirname(pixelDestination), { recursive: true });
          fs.mkdirSync(path.dirname(artifactDestination), { recursive: true });
          fs.renameSync(stagedPixel, pixelDestination); installedPixel = true;
          fs.renameSync(stagedArtifacts, artifactDestination); installedArtifacts = true;
          return candidate;
        });
        return this.store.trials.getCandidate(candidateId)!;
      } catch (error) {
        if (installedPixel && fs.existsSync(pixelDestination)) fs.rmSync(pixelDestination, { recursive: true, force: true });
        if (installedArtifacts && fs.existsSync(artifactDestination)) fs.rmSync(artifactDestination, { recursive: true, force: true });
        throw error;
      } finally {
        if (fs.existsSync(stage) && !fs.readdirSync(stage).length) fs.rmSync(stage, { recursive: true, force: true });
      }
    });
  }

  public async start(trialId: string): Promise<unknown> {
    const trial = this.requireTrial(trialId);
    if (trial.status !== "draft") throw new Error("TRIAL_NOT_DRAFT");
    if (trial.candidates.length < 2 || trial.candidates.length > 3) throw new Error("TRIAL_REQUIRES_TWO_OR_THREE_CANDIDATES");
    if (trial.candidates.length * trial.candidateBudgetTokens > trial.totalBudgetTokens) throw new Error("TRIAL_BUDGET_CANNOT_COVER_CANDIDATES");
    const energy = trial.candidates.map(candidate => {
      const binding = this.store.qianji.getBinding(candidate.bindingId);
      return binding ? this.store.pixels.getPixelAccount(binding.pixelId)?.energy ?? null : null;
    });
    if (energy.some(value => value === null || value !== energy[0] || value < trial.candidateBudgetTokens)) throw new Error("TRIAL_CANDIDATE_ENERGY_MUST_MATCH");
    const rulesHash = this.rulesSnapshot(trial).rulesHash;
    for (const candidate of trial.candidates) {
      const execution = this.store.executions.get(candidate.executionId);
      if (!execution || execution.kind !== "trial_candidate" || execution.subjectId !== trialId ||
          execution.inputSnapshot.rulesHash !== rulesHash || JSON.stringify(execution.toolsSnapshot) !== JSON.stringify(trial.allowedTools)) {
        throw new Error("TRIAL_RULE_SNAPSHOT_MISMATCH");
      }
    }
    return this.launchCandidate(trial, trial.candidates[0], false);
  }

  public async resume(trialId: string, rounds?: number): Promise<unknown> {
    const trial = this.requireTrial(trialId);
    if (trial.status !== "running") throw new Error("TRIAL_NOT_RESUMABLE");
    if (this.runService.getStatus().running) throw new Error("RUN_IN_PROGRESS");
    const candidate = trial.candidates.find(item => this.store.executions.get(item.executionId)?.status !== "closed");
    if (!candidate) return this.finishSelection(trialId);
    const execution = this.store.executions.get(candidate.executionId)!;
    if (execution.status === "awaiting_review") return this.finishCandidate(trial, candidate);
    if (execution.status !== "blocked" && !(execution.status === "ready" && trial.pauseReason?.startsWith("candidate_start_failed:"))) {
      throw new Error(`TRIAL_CANDIDATE_NOT_PAUSED:${execution.status}`);
    }
    if (execution.spentTokens + execution.reservedTokens >= execution.budgetTokens) throw new Error("TRIAL_CANDIDATE_BUDGET_EXHAUSTED");
    if (this.store.getUnfinalizedOperations().hasUnfinalized) throw new Error("TRIAL_RECOVERY_REQUIRED");
    const remaining = execution.roundsLimit - execution.roundsUsed;
    const requested = rounds ?? Math.max(1, remaining);
    if (!Number.isSafeInteger(requested) || requested < 1 || requested > remaining) throw new Error("TRIAL_ROUND_LIMIT_EXCEEDED");
    return this.launchCandidate(trial, candidate, true, requested);
  }

  public select(input: { trialId: string; winnerQianjiId: string | null; reason: string; evidenceIds: string[]; idempotencyKey: string }): Trial {
    if (!input.reason.trim() || input.reason.length > 4000 || new Set(input.evidenceIds).size !== input.evidenceIds.length) throw new Error("TRIAL_DECISION_INPUT_INVALID");
    return this.store.ownerActions.execute(input.idempotencyKey, `trial.select:${input.trialId}`, input, () => this.store.transaction(() => {
      const trial = this.requireTrial(input.trialId);
      if (trial.status !== "awaiting_selection") throw new Error("TRIAL_NOT_AWAITING_SELECTION");
      if (this.runService.getStatus().running || this.store.getUnfinalizedOperations().hasUnfinalized) throw new Error("TRIAL_RUN_OR_RECOVERY_ACTIVE");
      if (input.winnerQianjiId && !trial.candidates.some(candidate => candidate.qianjiId === input.winnerQianjiId)) throw new Error("TRIAL_WINNER_NOT_CANDIDATE");
      const knownEvidence = new Set(trial.candidates.flatMap(candidate =>
        Array.isArray(candidate.evidence) ? candidate.evidence.flatMap((item: any) => typeof item?.evidenceId === "string" ? [item.evidenceId] : []) : []));
      for (const id of input.evidenceIds) if (!knownEvidence.has(id)) throw new Error(`TRIAL_EVIDENCE_NOT_FOUND:${id}`);
      for (const candidate of trial.candidates) {
        const profile = this.store.qianji.getProfile(candidate.qianjiId);
        if (!profile || profile.careerStatus !== "trial") throw new Error("TRIAL_CANDIDATE_STATUS_INVALID");
        if (candidate.qianjiId === input.winnerQianjiId) {
          if (candidate.formalNarrative) this.store.qianji.updateNarrative(profile.qianjiId, profile.narrativeRevision, candidate.formalNarrative);
          this.store.qianji.transitionCareerStatus(profile.qianjiId, "trial", "active");
        } else {
          this.store.qianji.transitionCareerStatus(profile.qianjiId, "trial", "retired", `未被招录：${input.reason.trim()}`);
        }
      }
      return this.store.trials.decide(input.trialId, input.winnerQianjiId, input.reason.trim());
    }));
  }

  public async cancel(trialId: string, reason: string): Promise<Trial> {
    if (!reason.trim()) throw new Error("TRIAL_CANCEL_REASON_REQUIRED");
    const trial = this.requireTrial(trialId);
    if (["completed", "cancelled"].includes(trial.status)) throw new Error("TRIAL_NOT_CANCELLABLE");
    if (trial.status === "running" && this.runService.getStatus().running) {
      const activeRunId = this.runService.getStatus().run_id;
      const activeRun = activeRunId ? this.store.runs.getRun(activeRunId) : null;
      if (activeRun?.execution_id && !trial.candidates.some(candidate => candidate.executionId === activeRun.execution_id)) throw new Error("OTHER_RUN_IN_PROGRESS");
      this.store.trials.setPauseReason(trialId, "cancel_requested");
      this.runService.requestStop();
      for (let i = 0; i < 600 && this.runService.getStatus().running; i++) await new Promise(resolve => setTimeout(resolve, 50));
      if (this.runService.getStatus().running) throw new Error("TRIAL_STOP_TIMEOUT");
    }
    return this.store.transaction(() => {
      const current = this.requireTrial(trialId);
      for (const candidate of current.candidates) {
        const execution = this.store.executions.get(candidate.executionId);
        if (execution && execution.status !== "closed") {
          if (execution.reservedTokens > 0) throw new Error("TRIAL_RECOVERY_REQUIRED");
          const unresolved = this.store.db.prepare(`SELECT
              (SELECT COUNT(*) FROM reservations WHERE execution_id=? AND status='OPEN') +
              (SELECT COUNT(*) FROM messages WHERE execution_id=? AND status IN ('PROCESSING','RESERVED','CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT')) AS count`)
            .get(execution.executionId, execution.executionId) as any;
          if (Number(unresolved.count) > 0) throw new Error("TRIAL_RECOVERY_REQUIRED");
          this.store.db.prepare(`UPDATE messages SET status='ABANDONED', abandoned_reason=?, updated_at=?
            WHERE execution_id=? AND status IN ('QUEUED','WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET')`)
            .run(`Trial cancelled: ${reason.trim()}`, Date.now() / 1000, execution.executionId);
          this.store.executions.transition(execution.executionId, execution.status, "closed");
          this.store.executions.releaseParticipants(execution.executionId);
        }
        const profile = this.store.qianji.getProfile(candidate.qianjiId);
        if (profile?.careerStatus === "trial") this.store.qianji.transitionCareerStatus(profile.qianjiId, "trial", "candidate");
      }
      return this.store.trials.transition(trialId, current.status, "cancelled", { reason: reason.trim() });
    });
  }

  private async launchCandidate(trial: Trial, candidate: TrialCandidate, resume: boolean, rounds = trial.roundsPerCandidate): Promise<unknown> {
    const execution = this.store.executions.get(candidate.executionId);
    if (!execution) throw new Error("TRIAL_EXECUTION_MISSING");
    const allowedStatuses = resume ? ["blocked", "ready"] : ["ready"];
    if (!allowedStatuses.includes(execution.status)) throw new Error(`TRIAL_EXECUTION_NOT_STARTABLE:${execution.status}`);
    const result = await this.runService.start({
      rounds, runBudgetTokens: trial.candidateBudgetTokens, executionId: execution.executionId,
      onRunCreated: () => this.store.transaction(() => {
        const fresh = this.store.executions.get(execution.executionId);
        if (!fresh || fresh.status !== execution.status) throw new Error("TRIAL_EXECUTION_STATE_CHANGED");
        const currentTrial = this.requireTrial(trial.trialId);
        if (!resume && candidate.ordinal === 1) {
          if (currentTrial.status !== "draft") throw new Error("TRIAL_STATE_CHANGED");
          const rulesHash = String(fresh.inputSnapshot.rulesHash ?? "");
          for (const item of currentTrial.candidates) this.store.qianji.transitionCareerStatus(item.qianjiId, "candidate", "trial");
          this.store.trials.transition(trial.trialId, "draft", "running", { candidateCount: currentTrial.candidates.length, rulesHash });
        } else if (currentTrial.status !== "running") {
          throw new Error("TRIAL_STATE_CHANGED");
        }
        if (resume && currentTrial.pauseReason) this.store.trials.clearPauseReason(trial.trialId);
        this.store.executions.transition(execution.executionId, fresh.status, "running");
        const binding = this.store.qianji.getBinding(candidate.bindingId);
        if (!binding || binding.unboundAt !== null) throw new Error("TRIAL_BINDING_CHANGED");
        const snapshot = fresh.inputSnapshot;
        const content = `# 统一试炼题目\n${String(snapshot.challengeText ?? "")}\n\n## 验收标准\n${String(snapshot.acceptanceCriteria ?? "")}\n\n预算 ${trial.candidateBudgetTokens} Token；最多 ${trial.roundsPerCandidate} 轮。`;
        this.store.messages.enqueueMessage({ executionId: execution.executionId,
          roundNum: this.runService.getWorldRound() + fresh.roundsUsed + 1,
          sender: "human", recipient: binding.pixelId, content, sourceType: "human",
          senderBindingId: null, recipientBindingId: candidate.bindingId });
      }),
      onRunFinalized: (_runId, finalizedExecutionId, status) => this.onCandidateFinalized(trial.trialId, candidate.candidateId, finalizedExecutionId, status),
    });
    return { ...result, trialId: trial.trialId, candidateId: candidate.candidateId, ordinal: candidate.ordinal };
  }

  private onCandidateFinalized(trialId: string, candidateId: string, executionId: string, status: "awaiting_review" | "blocked"): void {
    const trial = this.store.trials.get(trialId);
    if (!trial || trial.status !== "running" || trial.pauseReason === "cancel_requested") return;
    if (status === "blocked") {
      this.store.trials.setPauseReason(trialId, `candidate_blocked:${candidateId}`);
      return;
    }
    try {
      this.finishCandidate(trial, this.store.trials.getCandidate(candidateId)!, executionId);
    } catch (error) {
      this.store.trials.setPauseReason(trialId, `evidence_or_finalize_failed:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private finishCandidate(trial: Trial, candidate: TrialCandidate, executionId = candidate.executionId): unknown {
    const evidence = this.captureEvidence(executionId);
    return this.store.transaction(() => {
      this.store.trials.setCandidateEvidence(candidate.candidateId, evidence);
      const execution = this.store.executions.get(executionId);
      if (!execution || execution.status !== "awaiting_review" || execution.reservedTokens !== 0) throw new Error("TRIAL_EXECUTION_UNSETTLED");
      this.store.executions.transition(executionId, "awaiting_review", "closed");
      this.store.executions.releaseParticipants(executionId);
      this.store.trials.clearPauseReason(trial.trialId);
      const fresh = this.requireTrial(trial.trialId);
      const next = fresh.candidates.find(item => item.ordinal > candidate.ordinal);
      if (!next) return this.store.trials.transition(trial.trialId, "running", "awaiting_selection", { candidateCount: fresh.candidates.length });
      setTimeout(() => {
        const stillRunning = this.store.trials.get(trial.trialId);
        if (stillRunning?.status === "running" && !stillRunning.pauseReason) {
          void this.launchCandidate(stillRunning, next, false).catch(error => {
            try { this.store.trials.setPauseReason(trial.trialId, `candidate_start_failed:${error instanceof Error ? error.message : String(error)}`); } catch {}
          });
        }
      }, 0);
      return { status: "CANDIDATE_COMPLETED", candidateId: candidate.candidateId, nextCandidateId: next.candidateId };
    });
  }

  private finishSelection(trialId: string): Trial {
    return this.store.trials.transition(trialId, "running", "awaiting_selection", { candidateCount: this.requireTrial(trialId).candidates.length });
  }

  private rulesSnapshot(trial: Trial) {
    const rules = { challengeText: trial.challengeText, acceptanceCriteria: trial.acceptanceCriteria,
      totalBudgetTokens: trial.totalBudgetTokens, roundsPerCandidate: trial.roundsPerCandidate,
      candidateBudgetTokens: trial.candidateBudgetTokens, allowedTools: trial.allowedTools,
      modelName: trial.modelName };
    return { ...rules, rulesHash: this.hash(rules) };
  }

  private hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
  private requireTrial(id: string): Trial { const trial = this.store.trials.get(id); if (!trial) throw new Error("TRIAL_NOT_FOUND"); return trial; }
}
