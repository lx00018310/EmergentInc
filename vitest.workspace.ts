import { defineWorkspace } from "vitest/config";
import { createRequire } from "node:module";
import * as path from "node:path";
const react = createRequire(path.resolve(__dirname, "frontend/package.json"))("@vitejs/plugin-react");

const alias = {
  "@emergentinc/protocol": path.resolve(__dirname, "packages/protocol/src"),
  "@emergentinc/domain": path.resolve(__dirname, "packages/domain/src"),
  "@emergentinc/persistence": path.resolve(__dirname, "packages/persistence/src"),
  "@emergentinc/model": path.resolve(__dirname, "packages/model/src"),
  "@emergentinc/tools": path.resolve(__dirname, "packages/tools/src"),
  "@emergentinc/runtime": path.resolve(__dirname, "packages/runtime/src"),
};

// String projects do not inherit the root config, so every project extends it explicitly.
// Without this, tests run under the 5s default and time out when many workers contend.
const timeout = { testTimeout: 20000, hookTimeout: 20000 };

export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: {
      name: "parity",
      include: ["tests/parity/**/*.test.ts"],
      alias,
    },
  },
  {
    extends: "./vitest.config.ts",
    test: { name: "packages", include: ["packages/*/tests/**/*.test.ts"], alias, ...timeout },
  },
  // Self-contained: extending frontend/vite.config.ts resolves its relative setupFiles
  // against the workspace root and breaks. Everything needed is inlined here.
  {
    root: __dirname,
    esbuild: { jsx: "automatic" },
    test: { name: "frontend", include: ["frontend/tests/**/*.test.{ts,tsx}"],
      environment: "jsdom", globals: true,
      plugins: [react()],
      setupFiles: [path.resolve(__dirname, "frontend/tests/setup.ts")],
      testTimeout: timeout.testTimeout, hookTimeout: timeout.hookTimeout },
  },
  {
    extends: "./vitest.config.ts",
    test: { name: "server", include: ["apps/server/tests/**/*.test.ts"], ...timeout },
  },
  {
    extends: "./vitest.config.ts",
    test: { name: "recovery", include: ["apps/recovery/tests/**/*.test.ts"], ...timeout },
  },
]);
