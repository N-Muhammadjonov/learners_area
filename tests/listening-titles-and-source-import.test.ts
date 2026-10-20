import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Listening section identity and tabs belong to the blue fixed header", () => {
  assert.match(read("src/components/shell/Topbar.tsx"), /<ModuleHeaderTitle dict=\{dict\}/);
  assert.match(read("src/components/shell/Topbar.tsx"), /<ModuleHeaderNavigation dict=\{dict\}/);
  assert.doesNotMatch(read("src/app/app/(shell)/listening/layout.tsx"), /<ListeningSectionHeading|<ModuleNavigation/);
  const sections = read("src/lib/nav/module-sections.ts");
  for (const section of ["lessons", "tests", "mcq"]) assert.ok(sections.includes(`/app/listening/${section}`));
  for (const section of ["lessons", "tests", "general", "mcq"]) {
    assert.doesNotMatch(read(`src/app/app/(shell)/listening/${section}/page.tsx`), /<h1 className="font-display text-2xl text-ink-900">\{t.title\}<\/h1>/);
  }
});

test("Listening Tests keeps four cards across wide laptops on one scrolling catalogue", () => {
  const page = read("src/app/app/(shell)/listening/tests/page.tsx");
  assert.match(page, /sm:grid-cols-2 xl:grid-cols-4/);
  assert.match(page, /data-listening-academic-card=\{card.testId\}/);
  assert.match(page, /href=\{`\/app\/listening\/tests\/\$\{card.testId\}`\}/);
  assert.match(page, /data-listening-academic-card-questions/);
  assert.match(page, /data-listening-academic-card-progress/);
  assert.match(page, /data-listening-academic-card-exam/);
  assert.match(page, /academicListeningCards\(user\.id, 1, undefined, user\.role\)/,
    "the role-aware catalogue always reads its single scrolling page");
  assert.doesNotMatch(page, /data-listening-academic-(pagination|prev|next)/);
  assert.match(page, /prefetch=\{false\}/, "opening the catalogue does not prefetch test payloads");
  assert.match(page, /card\.locked \?[\s\S]*data-listening-test-locked[\s\S]*<button[^>]*disabled[\s\S]*: <Link/,
    "locked cards render a disabled control instead of a test link");
  assert.doesNotMatch(page, /min-w-\[3[0-9][0-9]px\]/);
});

test("HTML + embedded MP3 is converted to native Listening activities, not an untrusted JavaScript exam", () => {
  const inspect = read("src/lib/listening/inspect.ts");
  assert.doesNotMatch(inspect, /if \(entryPath\) payload\.authoredRuntime/);
  assert.match(inspect, /const htmlPaths = Object\.keys\(textFiles\)/);
  assert.match(inspect, /payload = convertLegacyPackage/);
  assert.match(inspect, /payload = listeningPackageSchema\.parse/);
  assert.match(read("src/lib/listening/embedded-media.ts"), /embedded-listening-audio\.mp3/);
});
