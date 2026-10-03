// §25 Progress scalability: trends stay exact past the historical 1 000-row cap.
// The old implementation fetched `.limit(1_000)` rows per source, so 1 205 estimates
// in one week reported count=1000 and a truncated mean. Now aggregated in SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { evaluations, users } from "../src/db/schema";
import { getProgressTrends } from "../src/lib/data/progress-trends";

const enabled = process.env.QA2_DATABASE_TESTS === "1";

test("PS1 1 205 band estimates in one week: exact count and pooled mean (no truncation)", { skip: !enabled && "set QA2_DATABASE_TESTS=1" }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
  const me = randomUUID();
  const other = randomUUID();
  await db.insert(users).values([
    { id: me, name: "PS1 learner", role: "student", accountStatus: "active", email: `ps1.${me}@qa.invalid` },
    { id: other, name: "PS1 other", role: "student", accountStatus: "active", email: `ps1.${other}@qa.invalid` },
  ] as never);
  try {
    const now = new Date();
    const N = 1205;
    // 603 × 6.0 and 602 × 7.0 → mean 6.4996… → 6.5 at one decimal; a 1000-row cap would differ in count.
    const rows = Array.from({ length: N }, (_, i) => ({
      userId: me, evaluationType: "writing" as never, sourceType: "writing_submission", sourceId: randomUUID(),
      providerId: "qa", providerDisplayName: "QA", providerType: "internal" as const, providerVersion: "1", promptVersion: "1", rubricVersion: "1",
      checkedByName: "QA", overallEstimate: i % 2 === 0 ? 6 : 7, createdAt: new Date(now.getTime() - (i % 50) * 1000),
    }));
    for (let i = 0; i < rows.length; i += 400) await db.insert(evaluations).values(rows.slice(i, i + 400) as never);
    await db.insert(evaluations).values({ ...rows[0]!, userId: other, sourceId: randomUUID(), overallEstimate: 9 } as never);

    const t = await getProgressTrends(me, now);
    const week = t.writing!.at(-1)!;
    assert.equal(week.count, N, "every estimate counted");
    assert.equal(week.value, Math.round(((603 * 6 + 602 * 7) / N) * 10) / 10);
    assert.equal(t.writing!.reduce((n, w) => n + w.count, 0), N, "no estimate lost or duplicated across weeks");
  } finally {
    await db.delete(users).where(inArray(users.id, [me, other]));
  }
});
