import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPEAKING_HUB_CARDS } from "../src/lib/speaking/hub";
import { groupByTopic, partCounts, parsePart, resolveTopic, UNTITLED_TOPIC } from "../src/lib/speaking/practice-browse";
import { buildExaminerScript, PART1_QUESTIONS } from "../src/lib/speaking/ai-session";
import { breadcrumbsFor, parentFor } from "../src/lib/nav/routes";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

const read = (p: string) => readFileSync(p, "utf8");
const page = (r: string) => read(`src/app/(app)/${r}/page.tsx`);

test("S1 Speaking hub has exactly four entries in owner order", () => {
  assert.deepEqual(SPEAKING_HUB_CARDS.map((c) => c.key), ["partner", "practice", "ai", "lessons"]);
  assert.deepEqual(SPEAKING_HUB_CARDS.map((c) => c.href), ["/speaking/live-partner", "/speaking/practice", "/speaking/ai", "/speaking/lessons"]);
  for (const d of [en, uz]) for (const c of SPEAKING_HUB_CARDS) {
    const card = d.speakingHub.cards[c.key];
    for (const v of Object.values(card)) assert.ok(v.trim().length > 0);
  }
  assert.equal(en.speakingHub.cards.partner.title, "Speak with a partner");
  assert.equal(en.speakingHub.cards.practice.title, "Practice on your own");
  assert.equal(en.speakingHub.cards.ai.title, "Practice with AI");
  assert.equal(en.speakingHub.cards.lessons.title, "Speaking lessons");
});

test("S2 the hub has no Shadowing entry, no material feed and no 'No materials' state", () => {
  const hub = page("speaking");
  assert.match(hub, /SPEAKING_HUB_CARDS\.map/);
  assert.doesNotMatch(hub, /shadowing|noMaterials|EmptyState|listActiveMaterials|SpeakingMaterials/i);
  assert.match(hub, /md:grid-cols-2/, "2x2 on desktop, one column on mobile");
  assert.match(hub, /motion-reduce:/);
});

test("S3 Speaking lessons is its own page carrying the materials and Shadowing", () => {
  const lessons = page("speaking/lessons");
  assert.match(lessons, /listActiveMaterialsForEntry\(\)/);
  assert.match(lessons, /href="\/speaking\/shadowing"/);
  assert.match(lessons, /lessonsEmptyTitle/);
  assert.match(lessons, /<BackLink fallbackHref="\/speaking"/);
  assert.equal(parentFor("/speaking/shadowing", en)?.href, "/speaking/lessons");
  assert.match(page("speaking/shadowing"), /<BackLink fallbackHref="\/speaking\/lessons"/);
});

test("S4 Live Partner keeps OFFLINE-on-open, mic preflight, the state machine, and gains Back", () => {
  const lp = page("speaking/live-partner");
  assert.match(lp, /<BackLink fallbackHref="\/speaking"/);
  assert.match(lp, /never changes presence/);
  const client = read("src/components/speaking/LivePartnerClient.tsx");
  for (const s of ["offline", "available", "outgoing_invite", "incoming_invite", "connecting", "in_call", "reconnecting"]) assert.ok(client.includes(`"${s}"`), s);
  assert.match(client, /MicStatus = "unknown" \| "checking" \| "ok" \| "denied" \| "missing"/);
  assert.equal(parentFor("/speaking/live-partner", en)?.href, "/speaking");
});

const bank = [
  { id: "a", part: "part1", topic: "Hometown" }, { id: "b", part: "part1", topic: "hometown " }, { id: "c", part: "part1", topic: "Work" },
  { id: "d", part: "part1", topic: null }, { id: "e", part: "part2", topic: "A trip" }, { id: "f", part: "part3", topic: "a trip" },
  { id: "g", part: "part3", topic: "Cities" }, { id: "h", part: "general", topic: "x" },
];

test("S5 Practice on your own groups Part → Topic → Questions without hiding untitled rows", () => {
  assert.deepEqual(partCounts(bank), { part1: 4, part2: 1, part3: 2 });
  const g = groupByTopic(bank, "part1");
  assert.deepEqual(g.map((x) => [x.key, x.prompts.map((p) => p.id)]), [["hometown", ["a", "b"]], ["work", ["c"]], [UNTITLED_TOPIC, ["d"]]]);
  assert.equal(resolveTopic(g, "nope"), null);
  assert.equal(parsePart("part4"), null);
  assert.equal(parsePart("part2"), "part2");
});

test("S6 every question owns its recorder; one microphone at a time; release on unmount", () => {
  const studio = read("src/components/speaking/PracticeStudio.tsx");
  assert.match(studio, /topic\.prompts\.map\(\(p, i\) => \([\s\S]*<QuestionRecorder [^>]*prompt=\{p\}/);
  assert.match(studio, /<li key=\{p\.id\}>/);
  assert.doesNotMatch(studio, /<select|createRecorder/);
  assert.match(studio, /window\.history\.pushState/);
  const rec = read("src/components/speaking/QuestionRecorder.tsx");
  assert.match(rec, /disabled=\{lockedBy !== null && lockedBy !== prompt\.id\}/);
  assert.match(rec, /useEffect\(\(\) => \(\) => \{ stopTimer\(\); recorderRef\.current\?\.cancel\(\)/);
  assert.match(rec, /recordAgain/);
  assert.match(rec, /<audio controls src=\{playbackUrl\}/);
  assert.match(rec, /data-speak-cue-card/);
  assert.match(rec, /practice_started/, "starting practice still takes partner presence offline");
});

test("S7 the AI examiner script follows IELTS structure from the bank only", () => {
  const first = <T,>(xs: readonly T[]) => xs[0]!;
  assert.deepEqual(buildExaminerScript(bank, "full", first).map((p) => p.id), ["a", "b", "e", "f"]);
  assert.deepEqual(buildExaminerScript(bank, "part3", first).map((p) => p.id), ["f"]);
  assert.deepEqual(buildExaminerScript([], "full", first), []);
  assert.ok(PART1_QUESTIONS >= 3);
});

test("S8 Practice with AI is honest: no client-side transcript, band, or OpenAI call", () => {
  const ai = read("src/components/speaking/AiExaminerSession.tsx");
  assert.doesNotMatch(ai, /openai|band\s*[:=]|transcript\s*[:=]|Math\.random\(\)\s*\*\s*9/i);
  assert.match(ai, /data-ai-readiness/);
  assert.match(ai, /isStaff && /);
  const readiness = read("src/lib/speaking/ai-readiness.ts");
  assert.match(readiness, /import "server-only"/);
  assert.match(readiness, /isRiwi\(config\.aiPrimaryProvider\) \? null/);
  assert.match(readiness, /requiredSecrets\.every/);
  assert.match(page("speaking/ai"), /<BackLink fallbackHref="\/speaking"/);
});

test("S9 Speaking routes have breadcrumbs back to Speaking", () => {
  for (const r of ["/speaking/ai", "/speaking/lessons", "/speaking/practice", "/speaking/history", "/speaking/live-partner"]) {
    const crumbs = breadcrumbsFor(r, en);
    assert.equal(crumbs[0]?.href, "/speaking", r);
  }
});

test("S10 new Speaking copy is complete in Uzbek Latin (no Cyrillic)", () => {
  const blob = JSON.stringify([uz.speakingHub, uz.speakingAi, uz.speakingPractice]);
  assert.doesNotMatch(blob, /[\u0400-\u04FF]/);
  for (const k of Object.keys(en.speakingAi)) assert.ok(k in uz.speakingAi, k);
});
