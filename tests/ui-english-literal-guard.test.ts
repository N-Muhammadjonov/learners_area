// UZ/EN localization guard (2026-10-03 sweep). Visible learner/staff copy must come
// from the dictionaries, so a hard-coded English JSX text node, label, placeholder,
// alt or aria-label in src/**/*.tsx fails here. The allowlist is explicit and
// justified: TypeScript generics, language names, IELTS proper terms and content
// series titles are not translatable UI copy.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "Promise", // `=> Promise<…>` generic, not text
  "English", // language name shown in its own language
  "Task 1", "Task 2", "Mock", "Band", // IELTS proper terms used in both locales
  // Listening import series titles (content names, identical in UZ and EN)
  "Essential Recordings", "Academic Listening", "General Listening", "Question types", "MCQ Mastery",
]);

const TEXT = />\s*([A-Z][A-Za-z][^<>{}]{2,}?)\s*</g;
const ATTR = /\b(?:placeholder|aria-label|title|alt|label)="([A-Z][^"]{2,})"/g;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (path.endsWith(".tsx")) yield path;
  }
}

export function findEnglishLiterals(source: string): string[] {
  const found: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    for (const re of [TEXT, ATTR]) {
      for (const m of line.matchAll(re)) {
        const value = m[1]!.trim();
        if (!ALLOWED.has(value)) found.push(value);
      }
    }
  }
  return found;
}

test("EL1 no hard-coded English UI copy in src/**/*.tsx outside the justified allowlist", () => {
  const offenders: string[] = [];
  for (const file of walk("src")) {
    for (const value of findEnglishLiterals(readFileSync(file, "utf8"))) offenders.push(`${file}: ${value}`);
  }
  assert.deepEqual(offenders, [], `use the UZ/EN dictionary:\n${offenders.join("\n")}`);
});

test("EL2 the guard itself detects text nodes and attributes, and honours the allowlist", () => {
  assert.deepEqual(findEnglishLiterals(`<p>No course configured yet.</p>`), ["No course configured yet."]);
  assert.deepEqual(findEnglishLiterals(`<img alt="Listening map" />`), ["Listening map"]);
  assert.deepEqual(findEnglishLiterals(`<p>{dict.formCopy.noCourse}</p><option>Task 1</option>`), []);
});
