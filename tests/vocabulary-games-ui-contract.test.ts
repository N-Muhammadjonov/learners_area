import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const panel = readFileSync(join(ROOT, "src/components/vocabulary/VocabGamesPanel.tsx"), "utf8");
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const flashcards = panel.slice(panel.indexOf("function Flashcards("), panel.indexOf("// 2. Multiple choice"));
const race = panel.slice(panel.indexOf("function TypingRace("), panel.indexOf("function RaceMetric("));

test("Flashcards use a truthful source heading and a definition-only remaining queue", () => {
  assert.match(panel, /sourceHeading=\{source\}/);
  assert.match(flashcards, /data-flashcard-source/);
  assert.match(flashcards, /<p>\{word\.definitionEn\}<\/p>/);
  assert.doesNotMatch(flashcards.slice(flashcards.indexOf("data-flashcard-queue"), flashcards.indexOf("data-flashcard-scene")), /word\.term/);
});

test("Flashcards expose a 3D definition/answer flip and isolated pronunciation control", () => {
  assert.match(flashcards, /data-flashcard-inner/);
  assert.match(flashcards, /data-flashcard-flip/);
  assert.match(flashcards, /data-mark="known"/);
  assert.match(flashcards, /data-mark="notYet"/);
  const speaker = panel.slice(panel.indexOf("function Speaker("), panel.indexOf("function ResultBanner("));
  assert.match(speaker, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(flashcards, /Finish.*Show result/i);
  assert.match(css, /\.flashcard-3d-card\[data-flipped="true"\] \.flashcard-3d-inner \{[^}]*rotateY\(180deg\)/);
});

test("Typing Race focuses the stable input, starts on real text, auto-advances, and renders per-letter verdicts", () => {
  assert.match(race, /if \(startedAt === null && \/\\S\/\.test\(next\)\)/);
  assert.match(race, /inputRef\.current\?\.focus\(\)/);
  assert.match(race, /window\.setTimeout\(advance, delay\)/);
  assert.match(race, /race-answer-box--correct/);
  assert.match(race, /race-answer-box--incorrect/);
  assert.match(race, /data-race-feedback/);
  assert.doesNotMatch(race, /data-race-next/);
  assert.match(race, /function skip\(\)[\s\S]*?setStatus\("skipped"\)/);
  assert.doesNotMatch(race, /function skip\(\)[\s\S]*?answer\(/);
});
