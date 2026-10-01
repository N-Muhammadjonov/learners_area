import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(args: string[]) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  try {
    return { code: 0, out: execFileSync(process.execPath, ["--import", "tsx", "scripts/import-reading-105.mjs", ...args], { env, encoding: "utf8", stdio: "pipe" }) };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { code: e.status, out: `${e.stdout}${e.stderr}` };
  }
}

test("reading-105 dry run validates the source without a database; never fabricates a 105-row success", () => {
  const dir = mkdtempSync(join(tmpdir(), "r105-"));
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data", "reading_bundle_01_105.json"), JSON.stringify({ batch: { name: "x", passage_count: 1 }, content_items: [] }));
  const short = run(["--source", dir]);
  assert.match(short.out, /not 105/);
  assert.doesNotMatch(short.out, /DATABASE_URL/);
  const missing = run(["--source", join(dir, "nope.zip")]);
  assert.match(missing.out, /does not exist — expected a zip containing learnersarea_reading_supabase_ready_v1\/data\/reading_bundle_01_105\.json/);
  assert.match(run(["--source", dir, "--apply"]).out, /DATABASE_URL is not set/, "writes still require a database");
});
