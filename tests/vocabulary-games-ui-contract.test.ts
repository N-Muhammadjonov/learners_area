import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const panel = readFileSync(join(ROOT, "src/components/vocabulary/VocabGamesPanel.tsx"), "utf8");
const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
const en = readFileSync(join(ROOT, "src/lib/i18n/en.ts"), "utf8");
const uz = readFileSync(join(ROOT, "src/lib/i18n/uz.ts"), "utf8");
const flashcards = panel.slice(panel.indexOf("function Flashcards("), panel.indexOf("// 2. Multiple choice"));
const race = panel.slice(panel.indexOf("function TypingRace("), panel.indexOf("function RaceMetric("));

test("Flashcards use a truthful source heading and a definition-only remaining queue", () => {
  assert.match(panel, /sourceHeading=\{source\}/);
  assert.match(flashcards, /data-flashcard-source/);
  assert.match(flashcards, /<p>\{word\.definitionEn\}<\/p>/);
  assert.doesNotMatch(flashcards.slice(flashcards.indexOf("data-flashcard-queue"), flashcards.indexOf("data-flashcard-scene")), /word\.term/);
  assert.match(css, /\.flashcard-queue-item p\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
});

test("Flashcards use the reference stage proportions and responsive queue layout", () => {
  assert.match(css, /\.flashcard-layout\s*\{\s*grid-template-columns:\s*minmax\(200px,\s*220px\)\s+minmax\(0,\s*1fr\);\s*gap:\s*1\.25rem/);
  assert.match(css, /\.flashcard-queue\s*\{[\s\S]*?max-height:\s*640px/);
  assert.match(css, /\.flashcard-stage\s*\{[\s\S]*?min-height:\s*500px/);
  assert.match(css, /\.flashcard-scene\s*\{[\s\S]*?width:\s*min\(100%,\s*780px\);[\s\S]*?height:\s*460px/);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*?\.flashcard-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*?\.flashcard-stage\s*\{\s*min-height:\s*555px/);
  assert.match(css, /@media \(max-width:\s*820px\)[\s\S]*?\.flashcard-scene\s*\{\s*width:\s*100%;\s*height:\s*470px/);
  assert.match(css, /@media \(max-width:\s*520px\)[\s\S]*?\.flashcard-stage\s*\{\s*min-height:\s*565px/);
  assert.match(css, /@media \(max-width:\s*520px\)[\s\S]*?\.flashcard-scene\s*\{\s*height:\s*475px/);
  assert.match(css, /@media \(max-width:\s*520px\)[\s\S]*?\.flashcard-flip-button\s*\{[^}]*width:\s*100%;\s*min-width:\s*0/);
});

test("Flashcards expose the real 3D flip, keyboard controls, and isolated pronunciation", () => {
  assert.match(flashcards, /data-flashcard-inner/);
  assert.match(flashcards, /data-flashcard-flip/);
  assert.match(flashcards, /aria-keyshortcuts="Enter Space"/);
  assert.match(flashcards, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(flashcards, /<div className="flashcard-face flashcard-face-back"[\s\S]*?<Speaker word=\{current\.term\}/);
  assert.match(flashcards, /data-mark="known"/);
  assert.match(flashcards, /data-mark="notYet"/);
  const speaker = panel.slice(panel.indexOf("function Speaker("), panel.indexOf("function ResultBanner("));
  assert.match(speaker, /data-flashcard-pronounce/);
  assert.match(speaker, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(speaker, /setFlipped|setMarks|setIndex|answer\(/);
  assert.match(flashcards, /data-flipped=\{flipped \? "true" : "false"\}/);
  assert.match(flashcards, /setFlipped\(\(value\) => !value\)/);
  assert.match(flashcards, /data-flashcard-face="definition"[\s\S]*?data-flashcard-face="answer"/);
  assert.match(flashcards, /data-flashcard-side-announcement[\s\S]*?cardSideLabel/);
  assert.match(css, /\.flashcard-3d-card\[data-flipped="true"\] \.flashcard-3d-inner[\s\S]*?transform: rotateY\(180deg\)/);
  assert.match(css, /-webkit-perspective:\s*1200px;[\s\S]*?perspective:\s*1200px/);
  assert.match(css, /-webkit-transform-style:\s*preserve-3d;[\s\S]*?transform-style:\s*preserve-3d/);
  assert.match(css, /transition:\s*transform \.52s cubic-bezier\(\.2,\.7,\.2,1\)/);
  const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf("Definition-first Vocabulary Flashcards")), css.indexOf(".race-answer-box"));
  assert.match(reducedMotion, /transform:\s*none !important/);
  assert.match(reducedMotion, /transition:\s*opacity 120ms linear/);
  assert.match(reducedMotion, /\.flashcard-3d-card\[data-flipped="true"\] \.flashcard-face-back \{ opacity: 1/);
  assert.doesNotMatch(reducedMotion, /rotateY\(180deg\)/);
});

test("Flashcard choices get unmistakable day/night feedback without awarding mastery", () => {
  const decideStart = flashcards.indexOf("function decide");
  const decide = flashcards.slice(decideStart, flashcards.indexOf("function startPass", decideStart));
  assert.match(decide, /answer\(current\.id, \{ kind: "self", known \}\)/);
  assert.match(decide, /},\s*520\)/);
  assert.match(decide, /},\s*560\)/);
  assert.match(flashcards, /aria-pressed=\{marks\[current\.id\] === "known"\}/);
  assert.match(flashcards, /aria-pressed=\{marks\[current\.id\] === "notYet"\}/);
  assert.match(flashcards, /data-flashcard-complete[\s\S]*?t\.games\.reviewAll/);
  assert.match(flashcards, /t\.games\.reviewNotYet\.replace/);
  assert.doesNotMatch(flashcards, /Finish.*Show result/i);
  assert.match(css, /\.flashcard-mark-button\[data-mark="known"\]\[aria-pressed="true"\][\s\S]*?background:\s*rgb\(var\(--band-good\)\)/);
  assert.match(css, /\.flashcard-mark-button\[data-mark="notYet"\]\[aria-pressed="true"\][\s\S]*?background:\s*rgb\(var\(--band-bad\)\)/);
  assert.match(css, /\[data-theme="night"\] \.flashcard-mark-button/);
  assert.match(css, /\.flashcard-mark-feedback\.is-not-yet\s*\{\s*color:\s*rgb\(var\(--band-bad\)\)/);
});

test("Typing Race focuses the stable input, starts on real text, auto-advances, and renders per-letter verdicts", () => {
  assert.match(race, /if \(startedAt === null && \/\\S\/\.test\(next\)\)/);
  assert.match(race, /inputRef\.current\?\.focus\(\)/);
  assert.match(race, /window\.setTimeout\(advance, delay\)/);
  assert.match(race, /race-answer-box--correct/);
  assert.match(race, /race-answer-box--incorrect/);
  assert.match(race, /data-race-feedback/);
  const boxesPosition = race.indexOf("data-race-answer-boxes");
  const verdictPosition = race.indexOf("data-race-feedback");
  const inputPosition = race.indexOf("data-race-input");
  assert.ok(boxesPosition >= 0 && boxesPosition < verdictPosition && verdictPosition < inputPosition, "the verdict appears between the answer boxes and input");
  assert.match(race, /race-feedback--correct/);
  assert.match(race, /race-feedback--incorrect/);
  assert.match(race, /race-feedback__icon/);
  const raceStyles = css.slice(css.indexOf(".race-answer-box {"), css.indexOf("/* Global interaction contract"));
  assert.match(raceStyles, /\.race-feedback--correct \.race-feedback__title \{ color: rgb\(var\(--band-good\)\); \}/);
  assert.match(raceStyles, /\.race-feedback--incorrect \.race-feedback__title \{ color: rgb\(var\(--band-bad\)\); \}/);
  assert.match(css, /--band-good: 30 127 92;[\s\S]*?--band-bad: 194 73 45;/);
  assert.match(css, /\[data-theme="night"\]\s*\{[\s\S]*?--band-good: 119 213 154;[\s\S]*?--band-bad: 255 133 122;/);
  assert.match(en, /raceCorrect: "Correct — well done\."/);
  assert.match(en, /raceIncorrect: "Not quite\."/);
  assert.match(uz, /raceCorrect: "To'g'ri — barakalla\."/);
  assert.match(uz, /raceIncorrect: "To'g'ri emas\."/);
  assert.match(raceStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?transition-delay: 0ms !important/);
  assert.match(raceStyles, /\.race-answer-box--correct, \.race-answer-box--incorrect \{ transform: none; \}/);
  assert.doesNotMatch(race, /data-race-next/);
  assert.match(race, /function skip\(\)[\s\S]*?setStatus\("skipped"\)/);
  assert.doesNotMatch(race, /function skip\(\)[\s\S]*?answer\(/);
});
