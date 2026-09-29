import { describe, expect, it, vi } from "vitest";
import { automationCandidateHash, validateAutomation, AUTOMATION_PROFILE, AUTOMATION_SUITE_HASH } from "../src/business/automation_validation.js";

const image = `node@sha256:${"a".repeat(64)}`;
const probe = async () => ({ rootless: true, seccomp: "builtin", cgroup: 2, image });
describe("trusted automation candidate validation", () => {
  it("does not accept a candidate's self-declared success", async () => {
    const run = vi.fn(async () => ({ passed: true, candidateHash: "forged", sourceHash: "forged" }));
    const receipt = await validateAutomation("export default ()=>({passed:true})", { probe, run });
    expect(receipt.passed).toBe(false); expect(receipt.profile).toBe(AUTOMATION_PROFILE); expect(receipt.suiteHash).toBe(AUTOMATION_SUITE_HASH);
    expect(receipt.checks.every(c => c.reason === "OUTPUT_CONTRACT_MISMATCH")).toBe(true);
  });
  it("binds approval identity to code, runtime image and the trusted suite", () => {
    const source = "export default x=>x";
    expect(automationCandidateHash(source, image)).not.toBe(automationCandidateHash(source + ";", image));
    expect(automationCandidateHash(source, image)).not.toBe(automationCandidateHash(source, image.replaceAll("a", "b")));
    expect(automationCandidateHash(source, image)).toBe(automationCandidateHash(source, image));
  });
  it("records a failed run and never falls back to host execution", async () => {
    const run = vi.fn(async () => { throw new Error("ROOTLESS_DOCKER_UNAVAILABLE"); });
    const receipt = await validateAutomation("invalid source", { probe, run });
    expect(receipt.passed).toBe(false); expect(receipt.checks).toHaveLength(1); expect(run).toHaveBeenCalledTimes(1);
  });
  it("requires the environment probe before any candidate execution", async () => {
    const run = vi.fn();
    await expect(validateAutomation("source", { probe: async () => { throw new Error("ROOTLESS_LINUX_REQUIRED"); }, run })).rejects.toThrow("ROOTLESS_LINUX_REQUIRED");
    expect(run).not.toHaveBeenCalled();
  });
});
