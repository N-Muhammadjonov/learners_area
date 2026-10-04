import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const exam = readFileSync("src/components/reading/ReadingExam.tsx", "utf8");
const attemptPage = readFileSync("src/app/(app)/reading/attempts/[id]/page.tsx", "utf8");

test("ReadingExam keeps the IELTS split-screen production contract", () => {
  assert.match(exam, /data-ielts-exam-shell/);
  assert.match(exam, /lg:grid-cols-\[60fr_1px_40fr\]/);
  assert.match(exam, /data-practice-timer/);
  assert.match(exam, /data-ielts-question-nav/);
  assert.match(exam, /data-submit-all/);
  assert.match(exam, /data-practice-pane="passage"/);
  assert.match(exam, /data-practice-pane="questions"/);
});

test("active Reading attempts use the immersive workspace instead of the regular page header", () => {
  assert.match(attemptPage, /attempt\.status === "in_progress" \? "w-full"/);
  const inProgressBranch = attemptPage.split('attempt.status === "in_progress" ? (')[1]?.split(') : (')[0] ?? "";
  assert.doesNotMatch(inProgressBranch, /<BackLink/);
});

test("academic exam still does not send lexical occurrence payload into the active exam component", () => {
  assert.match(attemptPage, /ACADEMIC_EXAM: no occurrence\/sense data is sent to the active passage/);
  const examCall = attemptPage.split("<ReadingExam")[1]?.split("/>")[0] ?? "";
  assert.doesNotMatch(examCall, /occurrences=/);
});
