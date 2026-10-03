import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WRITING_TABS, nextTabIndex, parseWritingTab } from "../src/lib/writing/tabs";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

const read = (p: string) => readFileSync(p, "utf8");

test("W9 eight URL-backed Writing tabs in owner order; unknown tab falls back to lessons", () => {
  assert.deepEqual([...WRITING_TABS], ["lessons", "exam", "translation", "typing", "topic-vocabulary", "grade", "activation", "language-stealing"]);
  assert.equal(parseWritingTab("grade"), "grade");
  assert.equal(parseWritingTab("nope"), "lessons");
  assert.equal(parseWritingTab(undefined), "lessons");
  for (const d of [en, uz]) for (const k of WRITING_TABS) assert.ok(d.writingWorkspace.tabs[k].length > 0);
});

test("W10 tablist ARIA + Left/Right/Home/End keyboard model", () => {
  assert.equal(nextTabIndex(7, "ArrowRight", 8), 0);
  assert.equal(nextTabIndex(0, "ArrowLeft", 8), 7);
  assert.equal(nextTabIndex(3, "Home", 8), 0);
  assert.equal(nextTabIndex(3, "End", 8), 7);
  assert.equal(nextTabIndex(3, "a", 8), null);
  const nav = read("src/components/writing/workspace/WritingNav.tsx");
  for (const s of ['role="tablist"', 'role="tab"', "aria-selected={selected}", 'aria-controls="writing-panel"', "tabIndex={selected ? 0 : -1}"]) assert.ok(nav.includes(s), s);
  const page = read("src/app/(app)/writing/page.tsx");
  assert.match(page, /role="tabpanel" id="writing-panel" aria-labelledby=\{`writing-tab-\$\{tab\}`\}/);
});

test("W11 the Grade result page reads persisted results only and switches feedback language without re-grading", () => {
  const page = read("src/app/(app)/writing/grade/[id]/page.tsx");
  assert.match(page, /getGradeView\(id, user\.id\)/);
  assert.doesNotMatch(page, /runGrade|evaluateAndPersist|resolveEvaluation|openai/i);
  assert.match(page, /\?fl=\$\{other\}/);
  assert.match(page, /analysis\.examinerComment\[fl\]/);
  assert.match(page, /evaluation\.criteria\.map/);
  assert.match(en.writingWorkspace.grade.estimateLabel, /not an official IELTS score/);
  assert.doesNotMatch(JSON.stringify(uz.writingWorkspace), /[\u0400-\u04FF‘’]/);
});

test("W12 Grade form: no automatic retry, idempotency key per draft, draft restored only after hydration", () => {
  const form = read("src/components/writing/workspace/GradeForm.tsx");
  assert.match(form, /idempotencyKey: idem/);
  assert.match(form, /useEffect\(\(\) => \{\s*try \{\s*const d = JSON\.parse\(window\.localStorage/);
  assert.equal((form.match(/await request</g) ?? []).length, 1);
  const tab = read("src/components/writing/workspace/WritingGradeTab.tsx");
  assert.match(tab, /data-grade-ai-unavailable/);
});
