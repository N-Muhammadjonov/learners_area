import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { foldApostrophes } from "../src/lib/text/lexical-normalize";

/**
 * The canonical Learners Area convention for Uzbek user-facing text is the ASCII
 * apostrophe `'` (U+0027): "O'quv rejangizni", "yo'q", "so'z", "to'g'ri".
 *
 * Typographic variants — U+2018, U+2019, U+02BB, U+02BC — are NOT used in
 * Learners Area-controlled text, because the same word then renders differently
 * depending on which keyboard or copy/paste produced it.
 *
 * Input that learners or teachers type (vocabulary notes, chat text, imported
 * quotations) is normalised to ASCII on the way in — see INPUT_NORMALISERS below —
 * so the app accepts those marks without ever emitting them itself.
 */

/** U+2018, U+2019, U+02BB, U+02BC, U+02B9, U+2032 */
const TYPOGRAPHIC_MARKS = /[\u2018\u2019\u02bb\u02bc\u02b9\u2032]/;

/**
 * Files that legitimately mention the typographic marks: they are normaliser
 * regexes that convert what a keyboard produced into the ASCII form. They are
 * inputs, not UI copy, and must stay permissive.
 */
const INPUT_NORMALISERS = new Set([
  "src/lib/services/grammar/mastery.ts",
  "src/lib/services/vocabulary/dedupe.ts",
  // Grades typed answers (games and the translation challenge): folds whichever
  // apostrophe a keyboard produced into the ASCII form before comparing, and
  // runs in the browser and on the server from one shared rule. An input, not UI
  // copy. The games screen no longer carries its own copy of this rule.
  "src/lib/services/vocabulary/grading.ts",
  "src/lib/data/video-lessons.ts",
]);

/**
 * Generated from the original owner-authored HTML under content/listening by
 * scripts/listening-course-spec.ts. Like that imported HTML (outside src), its
 * exact prompts are source content, not app copy. They also identify persisted
 * progress units, so normalising their punctuation would change their identity.
 * Keep this exclusion to the one generated manifest; all app copy stays scanned.
 */
const IMPORTED_SOURCE_MANIFESTS = new Set([
  "src/lib/listening/original-listening-course.json",
]);

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("no Learners Area-controlled source file emits a typographic apostrophe", () => {
  const offenders: string[] = [];
  for (const file of walk("src")) {
    if (!/\.(ts|tsx|mjs|js|json|css)$/.test(file)) continue;
    if (INPUT_NORMALISERS.has(file)) continue;
    if (IMPORTED_SOURCE_MANIFESTS.has(file)) continue;
    const source = readFileSync(file, "utf8");
    source.split("\n").forEach((line, index) => {
      if (TYPOGRAPHIC_MARKS.test(line)) {
        offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test("the Uzbek dictionary spells the tutuq belgisi with the ASCII apostrophe", () => {
  const uz = readFileSync("src/lib/i18n/uz.ts", "utf8");
  for (const word of ["yo'q", "so'z", "to'g'ri", "bo'lishi", "ko'rish", "O'quv"]) {
    assert.ok(uz.includes(word), `expected the ASCII spelling ${word} in uz.ts`);
  }
  assert.ok(
    !TYPOGRAPHIC_MARKS.test(uz),
    "uz.ts must not contain U+2018/U+2019/U+02BB/U+02BC"
  );
});

test("Uzbek strings outside the dictionary use the ASCII apostrophe too", () => {
  const expectations: [string, string][] = [
    ["src/lib/auth/account-status.ts", "Ko'rib chiqilmoqda"],
    ["src/lib/auth/account-status.ts", "To'xtatilgan"],
    ["src/lib/auth/roles.ts", "O'qituvchi"],
    // The Reading type label moved to the canonical registry-backed label module.
    ["src/lib/reading-labels.ts", "Ko'p tanlovli"],
    ["src/lib/services/vocabulary/packs.ts", "nojo'ya ta'sir"],
    ["src/db/seed.ts", "o'zlari"],
  ];
  for (const [file, expected] of expectations) {
    const source = readFileSync(file, "utf8");
    assert.ok(source.includes(expected), `${file} should contain ${expected}`);
  }
});

test("the login screen greets the reader with the ASCII apostrophe", () => {
  const uz = readFileSync("src/lib/i18n/uz.ts", "utf8");
  const subtitle = uz.match(/loginSubtitle: "([^"]+)"/)?.[1] ?? "";
  assert.match(subtitle, /^O'quv rejangizni/, `loginSubtitle was ${JSON.stringify(subtitle)}`);
  assert.ok(!TYPOGRAPHIC_MARKS.test(subtitle), "the typographic mark must not appear here");
});

test("the English dictionary keeps its own apostrophes", () => {
  const en = readFileSync("src/lib/i18n/en.ts", "utf8");
  // Contractions are correct in English; this only proves the rule above is
  // scoped to Uzbek and does not silently rewrite the other locale.
  assert.ok(en.includes("isn't") || en.includes("it's"));
});

test("the marks accepted from keyboards are still normalised to ASCII", () => {
  // The rule above must not be "solved" by refusing the marks a learner's
  // keyboard produces; they are folded into the ASCII form on the way in.
  // A normaliser either folds with its own regex, or delegates to the ONE shared
  // Uzbek apostrophe fold (src/lib/text/lexical-normalize.ts, owner decision for
  // search, dedup and grading). The shared fold is then proven by behaviour.
  for (const file of INPUT_NORMALISERS) {
    const source = readFileSync(file, "utf8");
    assert.ok(
      /\.replace\(\/\[[^\]]*[\u2018\u2019][^\]]*\]\/g/.test(source)
        || /import \{[^}]*\b(foldApostrophes|normalizeLexical)\b[^}]*\} from "@\/lib\/text\/lexical-normalize"/.test(source),
      `${file} should still fold typographic marks to the ASCII apostrophe`
    );
  }
  assert.equal(foldApostrophes("o\u2018qish o\u2019qish o\u02bbqish g\u02bboya g\u2018oya"), "o'qish o'qish o'qish g'oya g'oya");
  assert.equal(foldApostrophes("\u201cquoted\u201d \u2013 dash"), "\u201cquoted\u201d \u2013 dash", "unrelated punctuation is untouched");
});
// Key parity between the two dictionaries is enforced by the type system:
// `src/lib/i18n/index.ts` declares `Record<Locale, Dictionary>`, so a key missing
// from either file fails `tsc`. No runtime duplicate of that rule is needed here.
