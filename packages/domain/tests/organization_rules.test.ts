import { describe, expect, it } from "vitest";
import {
  assertExecutionTransition,
  assertQianjiTransition,
} from "../src/index.js";

describe("Organization state rules", () => {
  it("allows only the documented Execution and Qianji transitions", () => {
    expect(() => assertExecutionTransition("closed", "running")).toThrow("EXECUTION_TRANSITION_INVALID");
    expect(() => assertQianjiTransition("retired", "active")).toThrow("QIANJI_TRANSITION_INVALID");
    expect(() => assertQianjiTransition("trial", "candidate")).not.toThrow();
  });
});
