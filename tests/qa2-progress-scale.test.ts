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

// PS2/PS3 (2026-10-03): other silent row windows found in the same sweep.
test("PS2 streak counts Tashkent days, not a 400-event window: 3 busy days of 500 events each = 3", { skip: !enabled && "set QA2_DATABASE_TESTS=1" }, async () => {
  const { getActivityStreak } = await import("../src/lib/data/dashboard");
  const { activityEvents } = await import("../src/db/schema");
  const { tashkentDayKey } = await import("../src/lib/time");
  const me = randomUUID();
  await db.insert(users).values({ id: me, name: "PS2", role: "student", accountStatus: "active", email: `ps2.${me}@qa.invalid` } as never);
  try {
    const noonToday = new Date(`${tashkentDayKey(new Date())}T07:00:00Z`); // 12:00 Tashkent
    const rows = [0, 1, 2].flatMap((d) => Array.from({ length: 500 }, (_, i) => ({
      userId: me, type: "qa_scale", payload: {}, createdAt: new Date(noonToday.getTime() - d * 86_400_000 - i * 1000),
    })));
    for (let i = 0; i < rows.length; i += 500) await db.insert(activityEvents).values(rows.slice(i, i + 500) as never);
    assert.equal(await getActivityStreak(me), 3);
  } finally {
    await db.delete(users).where(inArray(users.id, [me]));
  }
});

test("PS3 own-library search finds the 2 101st word of a library (no 2 000-row cap; last in heap order)", { skip: !enabled && "set QA2_DATABASE_TESTS=1" }, async () => {
  const { searchLibrary } = await import("../src/lib/services/vocabulary/engine");
  const { lexemes, userVocabulary } = await import("../src/db/schema");
  const me = randomUUID();
  const tag = me.slice(0, 8);
  await db.insert(users).values({ id: me, name: "PS3", role: "student", accountStatus: "active", email: `ps3.${me}@qa.invalid` } as never);
  const lex = await db.insert(lexemes).values(Array.from({ length: 2101 }, (_, i) => ({
    term: i === 2100 ? `zqoldest${tag}` : `zqw${tag}x${i}`, senseKey: `qa-${tag}-${i}`, definitionEn: "qa",
  })) as never).returning({ id: lexemes.id }).catch((e: { cause?: Error }) => { throw new Error(`lexeme seed: ${e.cause?.message}`); });
  try {
    const base = Date.now();
    const uv = lex.map((l, i) => ({ userId: me, lexemeId: l.id, createdAt: new Date(base - (2101 - i) * 1000) }));
    for (let i = 0; i < uv.length; i += 700) await db.insert(userVocabulary).values(uv.slice(i, i + 700) as never);
    const hits = await searchLibrary(me, `zqoldest${tag}`);
    assert.equal(hits[0]?.row.term, `zqoldest${tag}`);
  } finally {
    await db.delete(users).where(inArray(users.id, [me]));
    await db.delete(lexemes).where(inArray(lexemes.id, lex.map((l) => l.id)));
  }
});
