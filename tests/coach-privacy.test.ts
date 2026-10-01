import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Privacy and boundary tests.
 *
 * These are source-level assertions, and they exist because the boundaries they
 * protect are structural: a provider resolver that leaks into a client bundle,
 * a secret name that appears in a client component, or a vendor name hardcoded
 * into the UI are all mistakes that compile and pass type-checking.
 */

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(entry)) out.push(full);
  }
  return out;
}

const SRC_FILES = walk(join(ROOT, "src")).map((f) => relative(ROOT, f));
const CLIENT_FILES = SRC_FILES.filter((f) =>
  readFileSync(join(ROOT, f), "utf8").includes('"use client"')
);
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Strip comments so a documentation note cannot trip a code-level assertion. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");

test("the provider resolver, registry and adapters are marked server-only", () => {
  const serverOnly = [
    "src/lib/services/coach/resolver.ts",
    "src/lib/services/coach/registry.ts",
    "src/lib/services/coach/config.ts",
    "src/lib/services/coach/service.ts",
    "src/lib/services/coach/providers/index.ts",
    "src/lib/services/coach/providers/riwi/index.ts",
    "src/lib/services/coach/stt/index.ts",
    "src/lib/services/coach/stt/registry.ts",
  ];
  for (const file of serverOnly) {
    assert.match(read(file), /^import "server-only";/m, `${file} must be server-only`);
  }
});

test("no client component can reach the evaluation internals", () => {
  const forbidden = [
    "services/coach/resolver",
    "services/coach/registry",
    "services/coach/config",
    "services/coach/providers",
    "services/coach/stt",
    "services/storage",
  ];
  assert.ok(CLIENT_FILES.length > 0, "expected client components to exist");
  for (const file of CLIENT_FILES) {
    const source = read(file);
    for (const target of forbidden) {
      assert.ok(
        !source.includes(target),
        `${file} is a client component and must not import ${target}`
      );
    }
  }
});

test("no secret name appears in any client component", () => {
  const secretNames = [
    "AI_PRIMARY_PROVIDER",
    "STT_PRIMARY_PROVIDER",
    "AI_EXTERNAL_ENABLED",
    "DATABASE_URL",
    "AUTH_SECRET",
    "R2_SECRET_ACCESS_KEY",
    "R2_ACCESS_KEY_ID",
    "requiredSecrets",
  ];
  for (const file of CLIENT_FILES) {
    const source = read(file);
    for (const name of secretNames) {
      assert.ok(!source.includes(name), `${file} references server-only name ${name}`);
    }
  }
});

test("provider credentials are never exposed through NEXT_PUBLIC_", () => {
  const envExample = read(".env.example");
  // A public app URL is fine; a public key, token or provider switch is not.
  const publicLines = envExample
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#") && line.startsWith("NEXT_PUBLIC_"));
  const offenders = publicLines.filter((line) =>
    /(KEY|SECRET|TOKEN|PASSWORD|AI_|STT_|R2_|DATABASE|AUTH_)/.test(line)
  );
  assert.deepEqual(offenders, [], "no secret may be exposed through NEXT_PUBLIC_");
  assert.ok(
    /AI_PRIMARY_PROVIDER=/.test(envExample),
    "the provider switch must be documented by name in .env.example"
  );
});

test(".env is ignored and not tracked by git", () => {
  const gitignore = read(".gitignore");
  assert.match(gitignore, /(^|\n)\.env/, ".env must be gitignored");
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const offenders = tracked.filter((file) => /(^|\/)\.env(\.|$)/.test(file) && file !== ".env.example");
  assert.deepEqual(offenders, [], `no .env file may be committed (found ${offenders.join(", ")})`);
});

test("no committed source file contains a live-looking credential", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.startsWith("package-lock.json") && !f.endsWith(".pdf"));
  for (const file of tracked) {
    if (!/\.(ts|tsx|mts|json|md|mjs|sql|example)$/.test(file) && !file.startsWith(".env")) continue;
    let source: string;
    try {
      source = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    assert.ok(
      !/AKIA[0-9A-Z]{16}/.test(source),
      `${file} looks like it contains an AWS-style access key id`
    );
    assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(source), `${file} looks like it contains an API key`);
    assert.ok(
      !/(R2_SECRET_ACCESS_KEY|AI_API_KEY|STT_API_KEY)=[A-Za-z0-9/+=]{16,}/.test(source),
      `${file} looks like it contains a real secret value`
    );
  }
});

test("vendor references stay in server-only adapters and their registration, never app UI or data routes", () => {
  const vendors = ["openai", "anthropic", "gemini", "claude", "gpt-4", "mistral", "deepseek"];
  for (const file of SRC_FILES) {
    if (file.startsWith("src/lib/services/coach/providers/openai/") || file === "src/lib/services/coach/stt/openai.ts" || file === "src/lib/services/coach/providers/index.ts" || file === "src/lib/services/coach/stt/registry.ts") {
      assert.match(read(file), /^import "server-only";/m);
      continue;
    }
    const source = read(file).toLowerCase();
    for (const vendor of vendors) {
      assert.ok(!source.includes(vendor), `${file} references a specific vendor (${vendor})`);
    }
  }
});

test("the label shown to a student comes from the stored row, not from configuration", () => {
  const view = read("src/components/coach/EvaluationView.tsx");
  const viewCode = stripComments(view);
  assert.ok(view.includes("evaluation.checkedByName"), "the view must render the stored label");
  assert.ok(!viewCode.includes("readCoachConfig"), "the view must not consult configuration");
  assert.ok(!viewCode.includes("AI_PRIMARY_PROVIDER"), "the view must not consult configuration");

  const resolver = read("src/lib/services/coach/resolver.ts");
  assert.ok(
    resolver.includes("providerDisplayName: provider.displayName"),
    "results must carry the display name of the provider that produced them"
  );
  assert.ok(
    resolver.includes("fallbackFrom: primary.provider.id"),
    "a fallback must record which provider it fell back from"
  );
});

test("speech-to-text has no path into evaluation persistence", () => {
  for (const file of ["src/lib/services/coach/stt/index.ts", "src/lib/services/coach/stt/registry.ts"]) {
    const source = read(file);
    assert.ok(!source.includes("data/evaluations"), `${file} must not write evaluations`);
    assert.ok(!source.includes("resolveEvaluation"), `${file} must not resolve an evaluator`);
    assert.ok(!source.includes("checkedBy"), `${file} must not claim evaluation credit`);
  }
});

test("evaluation routes require a session before anything else", () => {
  const routes = [
    "src/app/api/writing/submissions/[id]/submit/route.ts",
    "src/app/api/speaking/attempts/[id]/submit/route.ts",
    "src/app/api/speaking/attempts/[id]/transcript/route.ts",
    "src/app/api/grammar/exercises/[id]/produce/route.ts",
    "src/app/api/vocabulary/[id]/use/route.ts",
    "src/app/api/assignments/[id]/evaluate/route.ts",
  ];
  for (const route of routes) {
    const source = read(route);
    // Authorization must come from the database-backed guard: a signed cookie
    // alone is not enough, because an account can be suspended or still be
    // waiting for admission while its cookie stays valid.
    assert.match(source, /requireActiveUser\(\)/, `${route} must gate on requireActiveUser`);
    assert.ok(
      source.indexOf("requireActiveUser") < source.indexOf("evaluate"),
      `${route} must authorize before it evaluates`
    );
    assert.match(source, /status: 401/, `${route} must answer 401 without a session`);
  }
});

test("the test runner loads server-only modules the same way the server build does", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(pkg.scripts.test ?? "", /--conditions=react-server/);
});

test("evaluation artifacts never store a signed URL as an authoritative value", () => {
  const artifacts = read("src/lib/data/coach-artifacts.ts");
  assert.ok(!artifacts.includes("http://"), "artifacts must not persist absolute URLs");
  assert.ok(!artifacts.includes("signedReadUrl"), "artifacts must not persist signed URLs");
  const evaluations = read("src/lib/data/evaluations.ts");
  assert.ok(
    !evaluations.includes("objectUrl"),
    "an evaluation refers to database rows, never to a file URL"
  );
});
