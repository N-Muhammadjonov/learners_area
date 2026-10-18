import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * THE DAY SURFACE — DAY N, one question at a time, on the ONE staged engine.
 *
 * The behaviour of a day (status, resume, ordering, isolation) is proven against a real database in
 * tests/listening-mcq-program-db.test.ts. What this file proves is the WIRING of the surface, which
 * no database test can see:
 *
 *   D-1  the route exists where the owner's product says it does;
 *   D-2  it renders the SAME staged drill the rest of Listening uses — there is no second engine,
 *        no local stage machine and no staged step taken by this page;
 *   D-3  one question is handed to that engine, chosen by the shared resume rule (never by
 *        incidental order), and the day's own audio is passed through;
 *   D-4  the day's 1…5 navigation carries a position and a stage label — never a question's text,
 *        never an option and never a key;
 *   D-5  a day that is not published does not render at all;
 *   D-6  the catalogue links to that address, and states the day's real numbers.
 *
 * This is a source contract, and it is read as CODE (comments are stripped) so a sentence in a
 * comment can never satisfy it.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DAY = "src/app/app/(shell)/listening/mcq/day/[day]/page.tsx";
const CATALOGUE = "src/app/app/(shell)/listening/mcq/page.tsx";
const ENGINE = "src/components/listening/McqMastery.tsx";
const MASTERY = "src/lib/services/listening/mcq-mastery.ts";

test("D-1 the day route exists at /app/listening/mcq/day/<n> and is dynamic", () => {
  assert.ok(existsSync(new URL(`../${DAY}`, import.meta.url)), "the day page exists");
  const source = code(DAY);
  assert.match(source, /export const dynamic = "force-dynamic"/, "a day is read per request, never cached across learners");
  assert.match(source, /requireActiveUser\(\)/, "the route authenticates");
  assert.match(source, /mcqDayFor\(/, "and reads the day through the programme reader");
});

test("D-2 the day renders the ONE staged engine — no second engine, no stage machine of its own", () => {
  const source = code(DAY);
  assert.match(source, /import \{ McqMastery \} from "@\/components\/listening\/McqMastery"/, "the canonical drill is reused");
  assert.match(source, /<McqMastery/, "and rendered");

  // The page does not talk to the drill API itself, and keeps no staged state.
  assert.doesNotMatch(source, /fetch\(/, "the page issues no request of its own");
  assert.doesNotMatch(source, /useScopedResponse|useState|"use client"/, "it is a server component, not a second client engine");
  assert.doesNotMatch(source, /\/api\/listening\/mcq/, "the staged API is the engine's business");
  // No stage machine here: the only stage this page knows is the shared final-stage constant.
  for (const stage of ["revealed", "committed", "chosen"])
    assert.doesNotMatch(source, new RegExp(`"${stage}"`), `the page must not restate the "${stage}" stage`);
  assert.match(source, /MCQ_FINAL_STAGE/, "completion is decided by the engine's own last stage");
  assert.doesNotMatch(source, /(length|count)\s*===\s*5/, "completion is never \"five rows exist\"");

  // The engine itself is the single definition of the staged flow.
  const mastery = code(MASTERY);
  assert.match(mastery, /export const MCQ_STAGES = \["listen", "notes", "committed", "revealed", "chosen", "reasoned"\]/, "one ordered flow");
  assert.match(mastery, /export function optionsVisible/, "options are a server decision with one implementation");
  assert.match(code(ENGINE), /questions: Question\[\]/, "the engine takes the question set (here: exactly one)");
});

test("D-3 one question is handed to the engine, chosen by the shared resume rule, with the day's own audio", () => {
  const source = code(DAY);
  // The resume rule lives in the programme module, so the page and its tests cannot disagree.
  assert.match(source, /mcqActivePosition\(questions, /, "the first unfinished question is the default");
  assert.match(source, /const activeIndex = activePosition - 1;/, "position and question cannot disagree");
  assert.match(source, /questions=\{\[\{/, "exactly ONE question is passed to the engine");
  assert.match(source, /order: activeIndex \+ 1/, "its authored position is what the engine states");
  assert.match(source, /stage: \(active\.stage \?\? "listen"\)/, "the learner's persisted stage is the stage they resume at");
  assert.match(source, /audioUrl=\{active\.audioUrl \?\? day\.audioUrl\}/, "the authored question recording, with the existing day recording as fallback");

  // No re-sorting: the day arrives in the item's authored order and is used as it is.
  assert.doesNotMatch(source, /\.sort\(/, "the day's order is authored; the surface never re-sorts it");
  for (const field of ["createdAt", "uuid", "title.localeCompare"])
    assert.doesNotMatch(source, new RegExp(field), `ordering must never come from ${field}`);
});

test("D-4 the day's 1…5 navigation leaks no question content — only a position and a stage", () => {
  const source = code(DAY);
  const nav = source.slice(source.indexOf("data-listening-mcq-day-nav"), source.indexOf("</nav>"));
  assert.ok(nav.length > 0, "the day has its own sequence navigation");
  assert.match(nav, /data-listening-mcq-day-step=\{position\}/, "each step is a position");
  assert.match(nav, /aria-current=\{current \? "step" : undefined\}/, "the current step is announced, not only coloured");
  assert.match(nav, /aria-label=/, "each step is labelled for a screen reader");
  assert.match(nav, /question\.stage === null \? t\.notStarted/, "and the label states the learner's own stage");
  // Nothing about the question itself travels through the navigation.
  for (const leak of ["questionText", "options", "correctAnswer", "explanation", "chosenAnswer"])
    assert.ok(!nav.includes(leak), `the navigation must not carry ${leak}`);
  // The step label uses the position, not the question's text or its database id.
  assert.match(nav, /t\.questionOf\.replace/, "the label is \"Question n of total\"");
});

test("D-5 an unpublished day does not render, and nothing is invented to fill it", () => {
  const source = code(DAY);
  assert.match(source, /const day = await mcqDayFor\(dayNumber, user, \{ includeDrafts: staff \}\)/, "staff preview a draft; a learner never does");
  assert.match(source, /if \(!day\) notFound\(\)/, "a day that is not published is not found");
  // The empty branch is a truthful message, never a fabricated five-question day.
  const empty = source.slice(source.indexOf("data-listening-mcq-day-empty"), source.indexOf(") : ("));
  assert.match(empty, /t\.notFoundTitle/, "an empty day says so");
  assert.ok(!/questionText|McqMastery/.test(empty), "and never renders questions that do not exist");
});

test("D-6 the day states its own progress, and the catalogue links to it by authored day number", () => {
  const day = code(DAY);
  assert.match(day, /data-listening-mcq-day-progress=\{`\$\{day\.status\.completed\}\/\$\{day\.status\.total\}`\}/, "progress comes from the derived status");
  assert.match(day, /data-listening-mcq-day-status=\{day\.status\.state\}/, "so does the state");
  assert.match(day, /t\.practiceComplete/, "a finished day says the practice is complete");
  assert.match(day, /MCQ_FINAL_STAGE \? t\.completed/, "which is the final stage, nothing weaker");
  assert.match(day, /BackLink fallbackHref="\/app\/listening\/mcq" label=\{t\.backToDays\}/, "and it can go back to the days list");

  const catalogue = code(CATALOGUE);
  assert.match(catalogue, /mcqProgramDays\(/, "the catalogue reads the programme");
  assert.match(catalogue, /href=\{`\/app\/listening\/mcq\/day\/\$\{card\.day\}`\}/, "one address per day, built from the stored day number");
  assert.match(catalogue, /data-listening-mcq-card-questions/, "each authored day still shows its own real question count");
  assert.match(catalogue, /data-listening-mcq-card-status=\{card\.status\.state\}/, "individual learner progress stays visible");
  assert.doesNotMatch(catalogue, /data-listening-mcq-days-published|data-listening-mcq-days-completed|MCQ_DAY_QUESTION_COUNT/,
    "owner-requested module-header programme counts are hidden without changing real day cards");
  assert.match(catalogue, /data-listening-mcq-empty/, "an empty programme has an honest empty state");
  assert.match(catalogue, /\{staff && </, "and only staff are told where days come from — a learner never gets a dead admin link");
});
