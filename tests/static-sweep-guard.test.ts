// §19 sweep (2026-10-03): defects found by the global static sweep stay fixed.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("SG1 no native alert() in product UI: errors render inline, localised", () => {
  const offenders = [...files("src/components"), ...files("src/app")]
    .filter((f) => /(^|[^.\w])alert\(/.test(readFileSync(f, "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "")));
  assert.deepEqual(offenders, []);
});

test("SG2 learner-facing copy never calls the product a demo or promises an unavailable reset link", () => {
  for (const file of ["src/lib/i18n/en.ts", "src/lib/i18n/uz.ts"]) {
    const text = readFileSync(file, "utf8");
    const reset = text.match(/resetSubtitle: "([^"]*)"/)?.[1] ?? "";
    assert.ok(reset.length > 0, `${file} resetSubtitle`);
    assert.doesNotMatch(reset, /demo|show you a reset link|ko'rsatamiz/i, file);
  }
});

test("SG3 a failed Speaking-material delete is surfaced, not swallowed", () => {
  const src = readFileSync("src/components/speaking/ManagedMaterialCard.tsx", "utf8");
  assert.match(src, /method: "DELETE" \}\)\.catch\(\(\) => null\)/);
  assert.match(src, /if \(!res \|\| !res\.ok\)/);
  assert.match(src, /role="alert"/);
});
