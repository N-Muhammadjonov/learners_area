// Batch 3: Reading content import lives in Management only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mayImportReading } from "../src/lib/reading/permissions";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

test("Reading import role matrix: student/teacher denied, admin/owner allowed", () => {
  assert.deepEqual((["student", "teacher", "admin", "owner"] as const).map(mayImportReading), [false, false, true, true]);
});

test("page and API enforce the same rule; dry run never commits", () => {
  const api = readFileSync("src/app/api/admin/reading/import/route.ts", "utf8");
  assert.match(api, /if \(!mayImportReading\(user\.role\)\) return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\)/);
  assert.match(api, /if \(body\?\.dryRun === true\) throw new DryRun/);
  assert.match(api, /importGeneralReadingSet\(tx, parsed\.data\)/, "reuses the existing idempotent importer");
  const page = readFileSync("src/app/app/(shell)/admin/reading/import/page.tsx", "utf8");
  assert.match(page, /mayImportReading\(administrator\.role\)/);
  assert.match(page, /<BackLink fallbackHref="\/app\/admin\/reading"/);
  assert.match(readFileSync("src/app/app/(shell)/admin/reading/page.tsx", "utf8"), /href="\/app\/admin\/reading\/import"/);
});

test("the learner Reading area carries no staff import/upload/authoring UI", () => {
  const files = [...walk("src/app/app/(shell)/reading"), ...walk("src/components/reading")].filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /\/admin\/reading|reading\/import|startUpload\(|NewPassageForm|isStaff\(|isAdministrator\(/, f);
  }
});

test("every Reading import error has en/uz text", () => {
  const api = readFileSync("src/app/api/admin/reading/import/route.ts", "utf8");
  for (const [, code] of api.matchAll(/error: "([a-z_]+)"/g)) for (const d of [en, uz]) assert.ok((d.readingImport.errors as Record<string, string>)[code!], code);
});
