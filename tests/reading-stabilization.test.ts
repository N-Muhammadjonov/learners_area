import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  closeDropdownAfterSelection,
  closeReadingDropdownsOnEscape,
  closeReadingDropdownsOutside,
} from "../src/lib/reading/dropdowns";
import { NAVIGATION_FEEDBACK_DELAY_MS } from "../src/lib/nav/progress";
import { readingAnswersForSubmission } from "../src/lib/reading/submission";
import {
  DEFAULT_READING_MINUTES,
  readingAttemptExpired,
  readingDurationSeconds,
  readingRemainingSeconds,
} from "../src/lib/reading/timer";

const startedAt = Date.parse("2026-09-29T10:00:00.000Z");

test("navigation feedback waits 280ms and cleans up its pending timer", () => {
  assert.equal(NAVIGATION_FEEDBACK_DELAY_MS, 280);
  const component = readFileSync(new URL("../src/components/shell/LinkPending.tsx", import.meta.url), "utf8");
  assert.match(component, /setTimeout\(\(\) => setVisible\(true\), NAVIGATION_FEEDBACK_DELAY_MS\)/);
  assert.match(component, /return \(\) => clearTimeout\(timeout\)/);
  assert.match(component, /motion-reduce:animate-none/);
});

test("Reading timer uses authored duration, falls back safely, and never grows into elapsed days", () => {
  assert.equal(readingDurationSeconds(20), 1_200);
  assert.equal(readingDurationSeconds(60), 3_600);
  assert.equal(readingDurationSeconds(4), DEFAULT_READING_MINUTES * 60);
  assert.equal(readingDurationSeconds(91), DEFAULT_READING_MINUTES * 60);
  assert.equal(readingDurationSeconds(Number.NaN), DEFAULT_READING_MINUTES * 60);
  assert.equal(readingRemainingSeconds(startedAt, 1_200, startedAt), 1_200);
  assert.equal(readingRemainingSeconds(startedAt, 1_200, startedAt + 1_000), 1_199);
  assert.equal(readingRemainingSeconds(startedAt, 1_200, startedAt + 1_200_000), 0);
  assert.equal(readingRemainingSeconds(startedAt, 1_200, startedAt + 86_400_000), 0);
  assert.equal(readingAttemptExpired(startedAt, 20, startedAt + 1_199_999), false);
  assert.equal(readingAttemptExpired(startedAt, 20, startedAt + 1_200_000), true);
});

test("an expired Reading submission ignores client answers and grades only saved drafts", () => {
  const client = [{ questionId: "q1", answer: "changed after expiry" }];
  const saved = [{ questionId: "q1", answer: "saved before expiry" }, { questionId: "q2", answer: "" }];
  assert.deepEqual([...readingAnswersForSubmission(false, client, saved)], [["q1", "changed after expiry"]]);
  assert.deepEqual([...readingAnswersForSubmission(true, client, saved)], [["q1", "saved before expiry"], ["q2", ""]]);
});

test("Reading filter dropdown selection, Escape focus restore, and outside click close", () => {
  const dom = new JSDOM(`
    <details open><summary>Topic</summary><ul><li><a href="/reading?topic=work">Work</a></li></ul></details>
    <details open><summary>Type</summary><ul><li><a href="/reading?type=matching">Matching</a></li></ul></details>
    <button id="outside">Outside</button>
  `);
  const { document } = dom.window;
  const dropdowns = [...document.querySelectorAll("details")];
  const topic = dropdowns[0]!;
  const type = dropdowns[1]!;

  closeDropdownAfterSelection(topic, topic.querySelector("a"));
  assert.equal(topic.open, false, "selecting a URL-backed option closes its menu immediately");

  type.open = true;
  const escaped = closeReadingDropdownsOnEscape({ key: "Escape", preventDefault() {} }, dropdowns);
  assert.equal(escaped, true);
  assert.equal(type.open, false);
  assert.equal(document.activeElement, type.querySelector("summary"), "Escape returns focus to the trigger");

  topic.open = true;
  closeReadingDropdownsOutside(dropdowns, document.querySelector("#outside"));
  assert.equal(topic.open, false, "a pointer event outside the menu closes it");
  dom.window.close();
});

test("Reading dropdown positioning is right-aligned and constrained to the viewport", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const styles = css.slice(css.indexOf(".dropdown-menu {"), css.indexOf(".dropdown-item {"));
  assert.match(styles, /right:\s*0/);
  assert.match(styles, /max-width:\s*calc\(100vw - 2rem\)/);
  assert.match(styles, /min\(320px, calc\(100dvh - 2rem\)\)/);
  assert.match(styles, /min\(300px, calc\(100vw - 2rem\)\)/);
});
