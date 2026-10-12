import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { resourceBlocks, typingRuns, users, writingPrompts } from "../src/db/schema";
import { listActivePromptsWithResources, typingSummary } from "../src/lib/data/writing";

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
  qa2ResidueGuard = await createResidueGuard("writing-query-db");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("writing-query-db", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const enabled = process.env.QA2_DATABASE_TESTS === "1";
function isolated() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2", "Writing DB tests must use isolated localhost/learners_qa2 only");
}

test("Writing works with no learner typing attempts and with a prompt resource joined by UUID", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const promptId = randomUUID();
  await db.insert(users).values({
    id: userId,
    name: `QA2 Writing root cause ${userId}`,
    role: "student",
    accountStatus: "active",
  });
  try {
    await db.insert(writingPrompts).values({
      id: promptId,
      taskType: "task1",
      category: `QA2-${userId}`,
      prompt: "Describe the isolated QA chart.",
      targetWordCount: 80,
      publicationState: "published",
    });
    await db.insert(resourceBlocks).values({
      ownerType: "writing",
      ownerId: promptId,
      position: 0,
      type: "text",
      textContent: "QA-only writing material",
      createdByUserId: userId,
    });

    const emptySummary = await typingSummary(userId);
    assert.deepEqual(emptySummary, { count: 0, bestWpm: null, bestAccuracy: null });

    const pageData = await listActivePromptsWithResources();
    assert.ok(pageData.prompts.some((prompt) => prompt.id === promptId));
    assert.equal(pageData.materials.get(promptId)?.[0]?.textContent, "QA-only writing material");

    await db.insert(typingRuns).values({
      userId,
      targetChars: 100,
      typedChars: 90,
      durationMs: 60_000,
      wpm: "90.0",
      accuracy: "90.0",
    });
    assert.deepEqual(await typingSummary(userId), { count: 1, bestWpm: 90, bestAccuracy: 90 });
  } finally {
    await db.delete(resourceBlocks).where(and(eq(resourceBlocks.ownerType, "writing"), eq(resourceBlocks.ownerId, promptId)));
    await db.delete(writingPrompts).where(eq(writingPrompts.id, promptId));
    await db.delete(users).where(eq(users.id, userId));
  }
});
