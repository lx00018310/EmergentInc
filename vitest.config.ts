import { defineConfig } from "vitest/config";
import * as path from "node:path";

export default defineConfig({
  test: {
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
