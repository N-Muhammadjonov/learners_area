import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { READING_DESTINATIONS, readingLegacyDestination } from "../src/lib/reading/destinations";
const read = (path: string) => readFileSync(path, "utf8");
test("READ-HUB five canonical products, History secondary, no mixed catalogue", () => {
  assert.deepEqual(READING_DESTINATIONS, ["lessons", "academic", "general", "question-types", "retention"]);
  const page = read("src/app/app/(shell)/reading/page.tsx");
  assert.match(page, /data-reading-destination=/);
  assert.match(page, /data-reading-history-entry/);
  assert.doesNotMatch(page, /listLibrary|listGeneralSets|General Training|readingHubCounts/);
});
test("READ-HUB old tabs canonicalize without interpreting the obsolete General Training tab as practice", () => {
  for (const [tab, target] of Object.entries({academic:"academic",practice:"academic","general-reading":"general",types:"question-types",retention:"retention"})) {
    assert.equal(readingLegacyDestination({ tab }), `/app/reading/${target}`);
  }
  assert.equal(readingLegacyDestination({tab:"general"}), "/app/reading");
  assert.equal(readingLegacyDestination({}), null);
  assert.equal(readingLegacyDestination({type:"MH",page:"2"}), "/app/reading/general?type=MH&page=2");
});
test("READ-TYPE-INDEX registry projection and EXISTS membership keep one passage once", () => {
  const source = read("src/lib/data/reading-type-index.ts");
  assert.match(source, /questionTypesFor\("reading"\)/);
  assert.match(source, /questionType\(code, "reading"\) \?\? resolveQuestionType/);
  assert.match(source, /count\(distinct p.id\)/);
  assert.match(source, /exists \(select 1 from reading_questions/);
  assert.match(source, /limit \$\{READING_TYPE_PAGE_SIZE \+ 1\} offset/);
  assert.doesNotMatch(source, /insert\(|\.values\(/);
});
test("READ-ACADEMIC bound catalogue applies formal membership before pagination", () => {
  const source = read("src/lib/data/general-reading.ts");
  assert.match(source, /count\(\*\).*general_reading_passages.*=3/);
  assert.match(source, /passage_no not in \(1,2,3\)/);
  assert.ok(source.indexOf("validPassages, formal") < source.indexOf(".limit(25)"));
  assert.match(source, /reading_assessments a join reading_attempts/);
});
