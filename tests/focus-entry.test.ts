import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// The focus contract is about what a learner actually experiences, so it is
// exercised as a real DOM component suite in an isolated process (the parent
// runner's worker protocol must not be inherited).
test("Focus auto-entry browser contract", (t) => {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: "", TSX_TSCONFIG_PATH: resolve("tests/ui/tsconfig.json") };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=spec", "tests/ui/focus-entry.test.tsx"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  t.diagnostic(result.stdout.trim());
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  assert.match(result.stdout, /tests 2/, "both component cases must actually execute");
});
