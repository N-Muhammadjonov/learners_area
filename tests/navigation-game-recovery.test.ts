import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Server tests need react-server for server-only modules; this real DOM component
// suite runs React's client build in an isolated process instead.
test("Navigation and game recovery DOM regressions", (t) => {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "", TSX_TSCONFIG_PATH: resolve("tests/ui/tsconfig.json") };
  // A nested Node test runner must not inherit the parent's worker protocol.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", "tests/ui/navigation-game-recovery.test.tsx", "tests/ui/navigation-game-load-controls.test.tsx"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8", timeout: 30_000,
  });
  t.diagnostic(result.stdout.trim());
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  assert.match(result.stdout, /tests 20/, "the component cases must actually execute");
});
