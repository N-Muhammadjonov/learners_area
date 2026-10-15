import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("Listening active section name is ABOVE tabs, not repeated below tabs", () => {
  const layout = read("src/app/app/(shell)/listening/layout.tsx");
  const heading = read("src/components/listening/ListeningSectionHeading.tsx");
  assert.ok(layout.indexOf("<ListeningSectionHeading") < layout.indexOf("<ModuleNavigation"), 
    "section heading must render before the shared four tabs");
  for (const section of ["lessons", "academic", "general", "mcq"]) {
    assert.match(heading, new RegExp(`"/app/listening/${section}"`));
    const page = read(`src/app/app/(shell)/listening/${section}/page.tsx`);
    assert.doesNotMatch(page, /<h1 className="font-display text-2xl text-ink-900">\{t.title\}<\/h1>/,
      "no duplicate section heading below tabs");
  }
  assert.match(heading, /if \(!key\) return null/,
    "test details and lessons still show their own authored headings");
});

test("Academic Listening compact catalogue has four cards across wide laptops", () => {
  const page = read("src/app/app/(shell)/listening/academic/page.tsx");
  assert.match(page, /sm:grid-cols-2 xl:grid-cols-4/);
  assert.match(page, /data-listening-academic-card=\{card.testId\}/);
  assert.match(page, /href=\{`\/app\/listening\/academic\/\$\{card.testId\}`\}/);
  assert.match(page, /data-listening-academic-card-questions/);
  assert.match(page, /data-listening-academic-card-progress/);
  assert.match(page, /data-listening-academic-card-exam/);
  assert.match(page, /data-listening-academic-pagination/);
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
