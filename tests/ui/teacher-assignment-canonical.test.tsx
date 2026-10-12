import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The teacher-facing assignment builder (§24, §99, §V).
 *
 * What the screen must do, checked on the source because this suite runs with jsdom
 * stubs rather than a browser (§105):
 *
 *   • the content picker is fed by `/api/assignments/assignable` — the same rule the
 *     service uses — so a teacher cannot choose content a learner could not open;
 *   • the choice is sent as (module, contentType, sourceRef, contentVersionId), i.e.
 *     the exact revision that gets pinned, and the legacy writing-prompt link is NOT
 *     sent alongside it;
 *   • free-form follow-up still works when no canonical content is chosen;
 *   • the picker is advisory only: the server is still the one that enforces scope,
 *     publication and revision identity (asserted by `content-assignments`).
 */
const read = (path: string) => readFileSync(path, "utf8");

test("the assignment builder offers canonical content and sends the pinned revision", () => {
  const form = read("src/components/teacher/NewAssignmentForm.tsx");

  assert.match(form, /fetch\("\/api\/assignments\/assignable", \{ cache: "no-store" \}\)/, "the picker reads the staff-only assignable list");
  assert.match(form, /data-assignment-content-select/, "the picker is a real select");
  assert.match(form, /module: chosen\.module,[\s\S]*contentType: chosen\.contentType,[\s\S]*sourceRef: chosen\.sourceRef,[\s\S]*contentVersionId: chosen\.versionId/);
  assert.match(form, /chosen[\s\S]*\? \{[\s\S]*contentVersionId[\s\S]*\}[\s\S]*: \{ relatedWritingPromptId: promptId \|\| null \}/, "canonical content replaces the legacy link, never both");
  assert.match(form, /data-assignment-pinned-revision/, "the teacher sees which revision will be pinned");
  assert.match(form, /disabled=\{busy \|\| Boolean\(chosen\)\}/, "the legacy prompt link is disabled once canonical content is chosen");
  assert.match(form, /data-assignment-content-unavailable/, "a failed picker read is reported, not hidden");
});

test("the i18n copy exists in both locales for every new label", () => {
  const en = read("src/lib/i18n/en.ts");
  const uz = read("src/lib/i18n/uz.ts");
  for (const key of ["assignmentCanonical", "assignmentNoCanonical", "assignmentCanonicalHint", "assignmentLoadingContent", "assignmentNoContent"]) {
    assert.match(en, new RegExp(`${key}:`), `en.teacher.${key}`);
    assert.match(uz, new RegExp(`${key}:`), `uz.teacher.${key}`);
  }
});
