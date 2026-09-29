import { describe, expect, it, vi } from "vitest";
import { CoreStore } from "@emergentinc/persistence";
import { deriveBirthIdentity } from "@emergentinc/domain";
import { UsageMeter } from "@emergentinc/model";
import { MeetingService } from "../src/services/meeting_service.js";
import { RunService } from "../src/services/run_service.js";

describe("MeetingService", () => {
  it("runs sequentially with a six-message window and charges each participant", async () => {
    const store = new CoreStore();
    try {
      const ids: string[] = [];
      for (let index = 1; index <= 2; index++) {
        const pixelId = `${index}_0_0`;
        const { primaryBits: _primaryBits, changedBits: _changedBits, ...birthIdentity } =
          deriveBirthIdentity(String(index + 20));
        const profile = store.qianji.createProfile({ careerStatus: "active", birthIdentity,
          narrative: { displayName: `人物${index}`, traits: {}, behaviorProfile: [] } });
        store.pixels.upsertPixelAccount({ pixelId, energy: 10000, active: true,
          refundDeficitTokens: 0, spendBlockedReason: null });
        store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId, incarnation: 1 });
        ids.push(profile.qianjiId);
      }
      const requests: any[] = [];
      const provider = { call: vi.fn(async (request: any) => {
        requests.push(request);
        return { rawText: "先验证最小可行路径，再决定是否扩大。", usage: { promptTokens: 12, completionTokens: 8 } };
      }) };
      const runService = { getStatus: () => ({ running: false }) } as unknown as RunService;
      const service = new MeetingService(store, runService, provider, new UsageMeter({ models: {} }), "test-model");
      const meeting = service.create("下一步验证什么？", ids);
      const result = await service.speak(meeting.meetingId, "请分别提出建议");
      expect(result.messages).toHaveLength(3);
      expect(result.messages.map(message => message.speaker)).toEqual(["阁主", "人物1", "人物2"]);
      expect(requests).toHaveLength(2);
      expect(requests[1].messages[1].content).toContain("人物1：先验证最小可行路径");
      expect(requests[0].messages[0].content).toContain("<disposition_tension>");
      expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(9980);
      expect(store.pixels.getPixelAccount("2_0_0")?.energy).toBe(9980);
      expect(store.modelCalls.countByRunId(meeting.meetingId)).toBe(2);
    } finally { store.close(); }
  });
});
