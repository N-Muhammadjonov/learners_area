import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { sharedSpeakingChannels, usesSharedSpeakingBank } from "../src/lib/speaking/study-support";
import { db } from "../src/db/client";
import { speakingPrompts } from "../src/db/schema";
import { listActivePrompts, listLivePartnerQuestions } from "../src/lib/data/speaking-practice";

import { after, before } from "node:test";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";

/*
 * Fixtures this file creates are removed when it finishes, exception-safely, and only rows that did
 * not exist when it started can be removed — so seeded records are unreachable by construction.
 * The QA2 database is shared by every gated file, so one file’s leftovers change what the next one
 * observes; this is what makes two consecutive runs against the same database meaningful.
 */
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("speaking-shared-bank");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("speaking-shared-bank", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

test("either Practice or Partner publication selects both channels without duplicate channel entries", () => {
  assert.deepEqual(sharedSpeakingChannels(["practice_alone"]), ["practice_alone", "live_partner"]);
  assert.deepEqual(new Set(sharedSpeakingChannels(["live_partner", "practice_alone"])), new Set(["practice_alone", "live_partner"]));
  assert.deepEqual(sharedSpeakingChannels(["ai"]), ["ai"]);
  assert.equal(usesSharedSpeakingBank(["live_partner"]), true);
  assert.equal(usesSharedSpeakingBank(["ai"]), false);
});
test("native Practice and Partner return the same saved question IDs, but Partner never receives study helpers", { skip: process.env.QA2_DATABASE_TESTS !== "1" }, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, "localhost"); assert.equal(target.pathname, "/learners_qa2");
  const ids: string[] = [randomUUID(), randomUUID()];
  try {
    await db.insert(speakingPrompts).values(ids.map((id, i) => ({ id, part: "part1" as const, category: "part1" as const, topic: "Isolated shared-bank QA", promptText: `Shared question ${i}?`, availableIn: [i ? "live_partner" : "practice_alone"], studySupport: { vocabularyHtml: "PRIVATE PRACTICE HELPER", modelAnswerHtml: "SAMPLE", ideasHtml: "IDEAS", vocabulary: [] }, publicationState: "published" as const })));
    const practice = (await listActivePrompts()).filter(p => ids.includes(p.id));
    const partner = (await listLivePartnerQuestions()).questions.filter(p => ids.includes(p.id));
    assert.deepEqual(new Set(practice.map(p => p.id)), new Set(ids));
    assert.deepEqual(new Set(partner.map(p => p.id)), new Set(ids));
    assert.ok(practice.every(p => p.studySupport.vocabularyHtml === "PRIVATE PRACTICE HELPER"));
    assert.ok(partner.every(p => !("studySupport" in p)));
    assert.doesNotMatch(JSON.stringify(partner), /PRIVATE PRACTICE HELPER|SAMPLE|IDEAS/);
  } finally { await db.delete(speakingPrompts).where(inArray(speakingPrompts.id, ids)); }
});
