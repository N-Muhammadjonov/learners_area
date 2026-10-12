import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { grammarExercises, grammarTopics, users, writingPrompts, writingSubmissions } from "../src/db/schema";
import { getTopicMastery } from "../src/lib/data/grammar";

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
  qa2ResidueGuard = await createResidueGuard("grammar-privacy-db");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("grammar-privacy-db", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const enabled = process.env.QA2_DATABASE_TESTS === "1";
test("essay-derived Grammar stays private before and after source expiry", { skip: !enabled }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
  const [owner, other, promptId, submissionId, topicId, privateId, publicId] = Array.from({ length: 7 }, () => randomUUID()) as [string,string,string,string,string,string,string];
  await db.insert(users).values([owner,other].map((id) => ({ id, name: "QA2 grammar privacy", role: "student" as const, accountStatus: "active" as const })));
  try {
    await db.insert(writingPrompts).values({ id: promptId, taskType: "task2", category: "QA", prompt: "Fixture", targetWordCount: 250 });
    await db.insert(writingSubmissions).values({ id: submissionId, userId: owner, promptId, content: "Private learner writing" });
    await db.insert(grammarTopics).values({ id: topicId, title: "QA2 private source", explanation: "Fixture", order: 999 });
    await db.insert(grammarExercises).values([
      { id: privateId, topicId, order: 1, sourceSubmissionId: submissionId, promptText: "Private learner sentence", options: ["is", "are"], correctOption: "is", explanation: "Private explanation" },
      { id: publicId, topicId, order: 2, promptText: "A shared exercise", options: ["is", "are"], correctOption: "is", explanation: "Shared explanation" },
    ]);
    const count = async (id: string) => (await getTopicMastery(id)).find((row) => row.topic.id === topicId)?.totalExercises;
    assert.equal(await count(other), 1, "other learners must only see the shared exercise");
    assert.equal(await count(owner), 2, "the source owner retains both exercises");
    await db.delete(writingSubmissions).where(eq(writingSubmissions.id, submissionId));
    assert.equal(await count(other), 1, "ON DELETE SET NULL must not publish private content");
    assert.equal(await count(owner), 2, "source expiry must not destroy recent personalized learning");
  } finally {
    await db.delete(grammarTopics).where(eq(grammarTopics.id, topicId));
    await db.delete(users).where(inArray(users.id, [owner,other]));
    await db.delete(writingPrompts).where(eq(writingPrompts.id, promptId));
  }
});
