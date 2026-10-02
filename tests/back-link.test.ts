// B1–B3: the shared Back control.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldUseHistory } from "../src/lib/navigation/back";
import uz from "../src/lib/i18n/uz";

test("B1 history is used only after an in-site navigation; deep links fall back to the href", () => {
  const o = "https://learn.test";
  assert.equal(shouldUseHistory("https://learn.test/listening", o, 3), true);
  assert.equal(shouldUseHistory("", o, 3), false);
  assert.equal(shouldUseHistory("https://evil.test/x", o, 3), false);
  assert.equal(shouldUseHistory("https://learn.test/x", o, 1), false);
  assert.equal(shouldUseHistory("not a url", o, 3), false);
});

test("B2 BackLink is a real link with a ≥44px target and a decorative arrow", () => {
  const src = readFileSync("src/components/ui/BackLink.tsx", "utf8");
  assert.match(src, /<Link\s+href=\{fallbackHref\}/);
  assert.match(src, /min-h-11/);
  assert.match(src, /<span aria-hidden>←<\/span>/);
  assert.match(src, /event\.metaKey \|\| event\.ctrlKey/);
  assert.equal(uz.common.back, "Orqaga");
});

test("B3 the Management Listening import uses BackLink to /admin/listening; the old URL only redirects", () => {
  const admin = readFileSync("src/app/(app)/admin/listening/import/page.tsx", "utf8");
  assert.match(admin, /<BackLink fallbackHref="\/admin\/listening"/);
  assert.match(admin, /requireAdministrator\(\)/);
  const legacy = readFileSync("src/app/(app)/listening/import/page.tsx", "utf8");
  assert.match(legacy, /redirect\(administrator \? "\/admin\/listening\/import" : "\/listening"\)/);
  assert.doesNotMatch(legacy, /<ListeningImport|components\/listening\/ListeningImport/);
  assert.match(readFileSync("src/app/(app)/listening/page.tsx", "utf8"), /href="\/admin\/listening\/import"/);
});
