import { createHash, randomUUID } from "node:crypto";
import { CoreStore } from "@emergentinc/persistence";
import { InfrastructureFailureError, ModelProvider, UsageMeter } from "@emergentinc/model";
import { RunService } from "./run_service.js";

type MeetingRow = { meeting_id: string; topic: string; created_at: number };
type MessageRow = { message_id: string; qianji_id: string | null; speaker: string; content: string;
  prompt_tokens: number | null; completion_tokens: number | null; cost_cny: number | null; created_at: number };

export class MeetingService {
  private readonly busy = new Set<string>();
  constructor(private readonly store: CoreStore, private readonly runService: RunService,
    private readonly provider?: ModelProvider, private readonly usageMeter?: UsageMeter,
    private readonly modelName?: string) {}

  public create(topic: string, participantIds: string[]) {
    if (!topic.trim() || Array.from(topic).length > 500 || participantIds.length < 2 || participantIds.length > 3 ||
        new Set(participantIds).size !== participantIds.length) throw new Error("MEETING_INPUT_INVALID");
    for (const id of participantIds) this.requireAvailable(id);
    const meetingId = `meeting_${randomUUID()}`;
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO qianji_meetings(meeting_id,topic,created_at)
        VALUES(?,?,?)`).run(meetingId, topic.trim(), Date.now() / 1000);
      for (const [ordinal, id] of participantIds.entries()) {
        this.store.db.prepare(`INSERT INTO qianji_meeting_participants(meeting_id,qianji_id,ordinal)
          VALUES(?,?,?)`).run(meetingId, id, ordinal);
      }
    });
    return this.get(meetingId);
  }

  public list() {
    const rows = this.store.db.prepare("SELECT meeting_id FROM qianji_meetings ORDER BY created_at DESC LIMIT 30").all() as Array<{ meeting_id: string }>;
    return rows.map(row => this.get(row.meeting_id));
  }

  public get(meetingId: string) {
    const row = this.store.db.prepare("SELECT * FROM qianji_meetings WHERE meeting_id=?").get(meetingId) as MeetingRow | undefined;
    if (!row) throw new Error("MEETING_NOT_FOUND");
    const messages = this.store.db.prepare(`SELECT message_id,qianji_id,speaker,content,prompt_tokens,completion_tokens,cost_cny,created_at
      FROM qianji_meeting_messages WHERE meeting_id=? ORDER BY rowid`).all(meetingId) as MessageRow[];
    const participants = this.store.db.prepare(`SELECT qianji_id FROM qianji_meeting_participants
      WHERE meeting_id=? ORDER BY ordinal`).all(meetingId) as Array<{ qianji_id: string }>;
    return { meetingId, topic: row.topic, participantIds: participants.map(item => item.qianji_id),
      createdAt: row.created_at, messages: messages.map(message => ({
        messageId: message.message_id, qianjiId: message.qianji_id, speaker: message.speaker,
        content: message.content, promptTokens: message.prompt_tokens, completionTokens: message.completion_tokens,
        costCny: message.cost_cny, createdAt: message.created_at,
      })) };
  }

  public async speak(meetingId: string, content: string) {
    if (!this.provider || !this.modelName || !this.usageMeter) throw new Error("MEETING_MODEL_NOT_CONFIGURED");
    if (!content.trim() || Array.from(content).length > 1000) throw new Error("MEETING_MESSAGE_INVALID");
    if (this.busy.has(meetingId) || this.runService.getStatus().running || this.store.runs.getActiveRun()) {
      throw new Error("MEETING_BUSY");
    }
    const meeting = this.get(meetingId);
    this.busy.add(meetingId);
    try {
      this.store.db.prepare(`INSERT INTO qianji_meeting_messages
        (message_id,meeting_id,qianji_id,speaker,content,created_at) VALUES(?,?,NULL,'阁主',?,?)`)
        .run(`message_${randomUUID()}`, meetingId, content.trim(), Date.now() / 1000);
      for (const id of meeting.participantIds) {
        const { profile, binding } = this.requireAvailable(id);
        const recent = this.store.db.prepare(`SELECT speaker,content FROM qianji_meeting_messages
          WHERE meeting_id=? ORDER BY rowid DESC LIMIT 6`).all(meetingId) as Array<{ speaker: string; content: string }>;
        const system = [
          "你正在参加一场多人会议。只根据议题和最近发言回应当前讨论；可以提出不同看法，避免复述前人。",
          "单次发言最多 150 个汉字。不要调用工具，也不要声称已经执行任务。",
          profile.birthIdentity ? `<disposition_tension>${profile.birthIdentity.birthText}</disposition_tension>此内容是底层取舍倾向，不得生硬复述或自称。` : "",
        ].filter(Boolean).join("\n");
        const prompt = `议题：${meeting.topic}\n最近发言：\n${recent.reverse().map(row => `${row.speaker}：${row.content}`).join("\n")}\n请以「${profile.narrative.displayName}」身份发言。`;
        const promptHash = createHash("sha256").update(system + "\n" + prompt).digest("hex");
        const callId = `meeting_call_${randomUUID()}`;
        const estimatedTokens = Math.ceil((system.length + prompt.length) * 0.7) + 400;
        this.store.budgets.reserve({ callId, runId: meetingId, pixelId: binding.pixelId,
          estimatedTokens, bindingId: binding.bindingId, narrativeRevision: profile.narrativeRevision });
        try {
          const response = await this.provider.call({ model: this.modelName, promptHash,
            messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
            maxTokens: 400, temperature: 0.5 });
          const usage = this.usageMeter.calculateUsage({ model: this.modelName, ...response.usage });
          const reply = Array.from(response.rawText.trim()).slice(0, 150).join("");
          this.store.transaction(() => {
            this.store.modelCalls.recordModelCall({ callId, runId: meetingId, pixelId: binding.pixelId,
              bindingId: binding.bindingId, narrativeRevision: profile.narrativeRevision, model: this.modelName!,
              promptHash, rawResponse: response.rawText, normalizedResponse: reply || null,
              promptTokens: usage.promptTokens, completionTokens: usage.completionTokens,
              cachedTokens: usage.cachedTokens, actualTokens: usage.actualTokens, costCny: usage.costCny,
              outcome: reply ? "SUCCESS" : "MODEL_RESPONSE_INVALID", createdAt: Date.now() / 1000 });
            this.store.budgets.settle({ callId, actualTokens: usage.actualTokens, costCny: usage.costCny });
            if (reply) this.store.db.prepare(`INSERT INTO qianji_meeting_messages
              (message_id,meeting_id,qianji_id,speaker,content,model,prompt_tokens,completion_tokens,cost_cny,created_at)
              VALUES(?,?,?,?,?,?,?,?,?,?)`).run(`message_${randomUUID()}`, meetingId, id,
                profile.narrative.displayName, reply, this.modelName!, usage.promptTokens,
                usage.completionTokens, usage.costCny, Date.now() / 1000);
          });
          if (!reply) throw new Error("MEETING_EMPTY_RESPONSE");
        } catch (error) {
          if (!this.store.modelCalls.getModelCall(callId)) {
            const outcome = error instanceof InfrastructureFailureError ? "INFRASTRUCTURE_FAILURE" : "CALL_OUTCOME_UNKNOWN";
            this.store.modelCalls.recordModelCall({ callId, runId: meetingId, pixelId: binding.pixelId,
              bindingId: binding.bindingId, narrativeRevision: profile.narrativeRevision, model: this.modelName,
              promptHash, promptTokens: null, completionTokens: null, cachedTokens: null, actualTokens: null,
              costCny: null, outcome, createdAt: Date.now() / 1000 });
            if (error instanceof InfrastructureFailureError) this.store.budgets.refund(callId);
          }
          throw error;
        }
      }
      return this.get(meetingId);
    } finally {
      this.busy.delete(meetingId);
    }
  }

  private requireAvailable(id: string) {
    const profile = this.store.qianji.getProfile(id);
    const binding = this.store.qianji.getCurrentBindingByQianji(id);
    const account = binding ? this.store.pixels.getPixelAccount(binding.pixelId) : null;
    if (!profile || profile.careerStatus === "retired" || !binding || !account?.active ||
        account.refundDeficitTokens > 0 || this.store.executions.getOpenExecutionForBinding(binding.bindingId)) {
      throw new Error(`MEETING_PARTICIPANT_UNAVAILABLE:${id}`);
    }
    return { profile, binding };
  }
}
