import { describe, expect, it } from "vitest";
import {
  assertExecutionTransition,
  assertMissionTransition,
  assertQianjiTransition,
  assertTrialTransition,
  canTransitionMission,
  validateMissionLimits,
  validateTrialBudget,
} from "../src/index.js";

describe("Organization state rules", () => {
  it("allows only the documented Mission, Trial, Execution, and Qianji transitions", () => {
    expect(canTransitionMission("draft", "issued")).toBe(true);
    expect(() => assertMissionTransition("draft", "completed")).toThrow("MISSION_TRANSITION_INVALID");
    expect(() => assertTrialTransition("completed", "running")).toThrow("TRIAL_TRANSITION_INVALID");
    expect(() => assertExecutionTransition("closed", "running")).toThrow("EXECUTION_TRANSITION_INVALID");
    expect(() => assertQianjiTransition("retired", "active")).toThrow("QIANJI_TRANSITION_INVALID");
    expect(() => assertQianjiTransition("trial", "candidate")).not.toThrow();
  });

  it("validates Mission limits and the shared 2-3 candidate Trial budget", () => {
    expect(() => validateMissionLimits(1, 1, null)).not.toThrow();
    expect(() => validateMissionLimits(0, 1, null)).toThrow("MISSION_BUDGET_INVALID");
    expect(() => validateMissionLimits(10, 1, 0)).toThrow("MISSION_DEADLINE_INVALID");
    expect(() => validateTrialBudget(2, 200, 100, 1)).not.toThrow();
    expect(() => validateTrialBudget(1, 200, 100, 1)).toThrow("TRIAL_CANDIDATE_COUNT_INVALID");
    expect(() => validateTrialBudget(3, 200, 100, 1)).toThrow("TRIAL_BUDGET_EXCEEDED");
  });
});
