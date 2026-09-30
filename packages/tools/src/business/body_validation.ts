import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { BodyCandidate, lifeId, lifeText } from "@emergentinc/protocol";
import { RootlessSandbox } from "./rootless_sandbox.js";

export type BodyRunner = Pick<RootlessSandbox, "probe" | "runBody" | "recoverInterrupted">;
export const bodyHash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function boundedJson(value: unknown) {
  const json = JSON.stringify(value);
  if (!json || Buffer.byteLength(json) > 65536) throw new Error("INVALID_BODY_JSON");
  const copy = JSON.parse(json);
  if (!isDeepStrictEqual(copy, value)) throw new Error("INVALID_BODY_JSON");
  return copy;
}
/** Conservative source gate plus mandatory kernel/Node permissions. Source checks alone are not isolation. */
export function bodyCandidate(value: unknown, interfaceVersion: string): BodyCandidate {
  const c = boundedJson(value) as BodyCandidate;
  if (!c || Object.keys(c).sort().join(",") !== "interface_version,purpose,skill_id,source,tests" || c.interface_version !== interfaceVersion)
    throw new Error("INVALID_BODY_INTERFACE");
  lifeId(c.skill_id); lifeText(c.purpose, 2000); lifeText(c.source, 65536);
  if (Buffer.byteLength(c.source) > 65536 || !/\bexport\s+default\b/.test(c.source)) throw new Error("INVALID_BODY_SOURCE");
  if (/\b(import|require|process|globalThis|global|fetch|WebSocket|XMLHttpRequest|child_process|eval|Function|constructor|__proto__|prototype|credentials|private|mount|genome)\b|node:|https?:|docker\.sock/.test(c.source))
    throw new Error("BODY_SECURITY_BOUNDARY");
  if (!Array.isArray(c.tests) || c.tests.length < 1 || c.tests.length > 20 ||
      c.tests.some(t => !t || Object.keys(t).sort().join(",") !== "expected,input")) throw new Error("INVALID_BODY_TEST_DATA");
  for (const test of c.tests) { boundedJson(test.input); boundedJson(test.expected); }
  return c;
}
export interface BodyValidationReceipt {
  passed: boolean; candidateHash: string; image: string; interfaceVersion: string; suiteHash: string;
  checks: { passed: boolean; reason?: string }[]; validatedAt: number;
}
export function bodyCandidateHash(c: BodyCandidate, image: string) {
  return bodyHash({ candidate: c, image, harness: "body-json-data@1", permissions: "node-permission+rootless@1" });
}
export async function validateBodyCandidate(c: BodyCandidate, runner: BodyRunner): Promise<BodyValidationReceipt> {
  bodyCandidate(c, c.interface_version);
  const environment = await runner.probe();
  if (environment.rootless !== true || environment.seccomp !== "builtin" || environment.cgroup !== 2 || !/@sha256:[a-f0-9]{64}$/.test(environment.image))
    throw new Error("SANDBOX_POLICY_MISMATCH");
  const receipt: BodyValidationReceipt = { passed: false, candidateHash: bodyCandidateHash(c, environment.image),
    image: environment.image, interfaceVersion: c.interface_version, suiteHash: bodyHash(c.tests), checks: [], validatedAt: Date.now() };
  for (const test of c.tests) {
    try {
      const result = boundedJson(await runner.runBody(c.source, test.input));
      const passed = isDeepStrictEqual(result, test.expected);
      receipt.checks.push({ passed, ...(!passed ? { reason: "BODY_TEST_MISMATCH" } : {}) });
    } catch (e) { receipt.checks.push({ passed: false, reason: e instanceof Error ? e.message : "BODY_EXECUTION_FAILED" }); break; }
  }
  receipt.passed = receipt.checks.length === c.tests.length && receipt.checks.every(t => t.passed);
  return receipt;
}
