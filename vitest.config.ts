import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  test: {
    // The suite spawns real worker processes and polls them on 1s timers. Under many parallel
    // workers those processes contend for CPU, so the legacy 5s default is too tight.
    testTimeout: 20000,
    hookTimeout: 20000,
    alias: {
      "@emergentinc/protocol": path.resolve(__dirname, "packages/protocol/src"),
      "@emergentinc/domain": path.resolve(__dirname, "packages/domain/src"),
      "@emergentinc/persistence": path.resolve(__dirname, "packages/persistence/src"),
      "@emergentinc/model": path.resolve(__dirname, "packages/model/src"),
      "@emergentinc/tools": path.resolve(__dirname, "packages/tools/src"),
      "@emergentinc/runtime": path.resolve(__dirname, "packages/runtime/src"),
    },
  },
});
