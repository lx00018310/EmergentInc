import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { RootlessSandbox } from "./rootless_sandbox.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Trusted release code owns this contract and its tests. A candidate receives inputs, never this validator.
// First concrete improvement: sum explicitly selected CSV amount fields without converting identifiers or formulas.
const cases = [
  { name: "empty", input: { rows: [], numericFields: ["amount"] }, expected: { rows: 0, totals: { amount: 0 }, invalid: { amount: 0 } } },
  { name: "csv-and-identifiers", input: { rows: [{ id: "001", amount: "12.50" }, { id: "002", amount: "-2.25" }], numericFields: ["amount"] },
    expected: { rows: 2, totals: { amount: 10.25 }, invalid: { amount: 0 } } },
  { name: "reject-formulas-and-missing", input: { rows: [{ amount: "=SUM(A1:A2)" }, { amount: "" }, {}, { amount: null }, { amount: "3" }], numericFields: ["amount"] },
    expected: { rows: 5, totals: { amount: 3 }, invalid: { amount: 4 } } },
  { name: "only-explicit-fields", input: { rows: [{ amount: 5, id: "12345", discount: "1.25" }], numericFields: ["amount", "discount"] },
    expected: { rows: 1, totals: { amount: 5, discount: 1.25 }, invalid: { amount: 0, discount: 0 } } },
] as const;

export const AUTOMATION_PROFILE = "csv_numeric_summary@1";
export const AUTOMATION_SUITE_HASH = hash(cases);
export function validateAutomationInput(input: any): asserts input is { rows: Record<string, unknown>[]; numericFields: string[] } {
  if (!input || !Array.isArray(input.rows) || input.rows.length > 10000 || input.rows.some((r: unknown) => !r || typeof r !== "object" || Array.isArray(r)) ||
    !Array.isArray(input.numericFields) || input.numericFields.length > 200 ||
    input.numericFields.some((f: unknown) => typeof f !== "string" || !f || f.length > 200) ||
    new Set(input.numericFields).size !== input.numericFields.length) throw new Error("INVALID_AUTOMATION_INPUT");
}
export function validateAutomationOutput(input: unknown, result: any) {
  validateAutomationInput(input);
  const fields = [...input.numericFields].sort();
  if (!result || result.rows !== input.rows.length || !result.totals || !result.invalid ||
    !isDeepStrictEqual(Object.keys(result).sort(), ["invalid", "rows", "totals"]) ||
    !isDeepStrictEqual(Object.keys(result.totals).sort(), fields) || !isDeepStrictEqual(Object.keys(result.invalid).sort(), fields) ||
    fields.some(f => typeof result.totals[f] !== "number" || !Number.isFinite(result.totals[f]) ||
      !Number.isSafeInteger(result.invalid[f]) || result.invalid[f] < 0 || result.invalid[f] > input.rows.length)) throw new Error("AUTOMATION_OUTPUT_INVALID");
}
export function automationCandidateHash(source: string, image: string) {
  return hash({ source, image, profile: AUTOMATION_PROFILE, suiteHash: AUTOMATION_SUITE_HASH });
}
export interface AutomationValidationReceipt {
  candidateHash: string; sourceHash: string; image: string; profile: string; suiteHash: string;
  passed: boolean; checks: { name: string; passed: boolean; reason?: string }[]; validatedAt: number;
}

/** Only a rootless runner can execute the candidate. This receipt is computed outside candidate code. */
export async function validateAutomation(source: string, runner: Pick<RootlessSandbox, "probe" | "run">): Promise<AutomationValidationReceipt> {
  const environment = await runner.probe();
  const receipt: AutomationValidationReceipt = { candidateHash: automationCandidateHash(source, environment.image),
    sourceHash: hash(source), image: environment.image, profile: AUTOMATION_PROFILE, suiteHash: AUTOMATION_SUITE_HASH,
    passed: false, checks: [], validatedAt: Date.now() };
  for (const c of cases) {
    try {
      const actual = await runner.run(source, c.input);
      const passed = isDeepStrictEqual(actual, c.expected);
      receipt.checks.push({ name: c.name, passed, ...(!passed ? { reason: "OUTPUT_CONTRACT_MISMATCH" } : {}) });
    } catch (e) {
      const reason = e instanceof Error && /^[A-Z_]+$/.test(e.message) ? e.message : "VALIDATION_EXECUTION_FAILED";
      receipt.checks.push({ name: c.name, passed: false, reason });
      break;
    }
  }
  receipt.passed = receipt.checks.length === cases.length && receipt.checks.every(c => c.passed);
  return receipt;
}
