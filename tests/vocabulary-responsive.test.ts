import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

/**
 * Vocabulary responsive contract.
 *
 * The owner-reported defect was the Uzbek mastery label overflowing its card on
 * narrow widths. The label is real state, so the answer is never to shorten or
 * hide it: a badge may wrap, and every container that holds it may shrink to the
 * viewport. These assertions pin that contract at the source and CSS level —
 * an actual pixel check still needs a browser.
 */

const ROOT = new URL("..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

test("the mastery badge wraps instead of overflowing a narrow card", () => {
  const css = read("src/app/globals.css");
  const badge = css.slice(css.indexOf(".badge {"), css.indexOf(".badge-locked"));
  assert.match(badge, /max-width:\s*100%/, "the badge may never be wider than its container");
  assert.match(badge, /overflow-wrap:\s*anywhere/, "a long label breaks inside the badge");

  const panel = read("src/components/vocabulary/VocabWordsPanel.tsx");
  assert.match(panel, /className="card min-w-0 p-3"/, "the summary card may shrink with its column");
  assert.match(
    panel,
    /break-words text-xs uppercase tracking-wide text-ink-300/,
    "the uppercased summary label may break inside the card",
  );
  assert.match(
    panel,
    /flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-2/,
    "the badge column is capped at the row width",
  );
  assert.match(panel, /<span className="break-words">\{t\.mastery\[row\.state\]\}<\/span>/);
  assert.doesNotMatch(panel, /whitespace-nowrap[^>]*\{t\.mastery/);
});

test("the labels that motivated the rule are still present and honest in both locales", () => {
  assert.equal(uz.vocabulary.mastery.mastered, "O'zlashtirilgan");
  assert.equal(en.vocabulary.mastery.mastered, "Mastered");
  assert.ok(uz.vocabulary.mastery.mastered.length >= 12);
  // Several Uzbek labels are long; the rule is generic rather than one exception.
  const longLabels = Object.values(uz.vocabulary.mastery).filter((label) => label.length >= 12);
  assert.ok(longLabels.length >= 2, "more than one Uzbek mastery label needs the wrapping contract");
});
