import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { users } from "../src/db/schema";
import { activeRelease, clearRecentSearches, recentSearches, rememberSearch, rows } from "../src/lib/dictionary/store";

import { savedSenseIds } from "../src/lib/dictionary/save";

/**
 * Two distinct preconditions, and the difference between them matters:
 *
 *   QA2_DATABASE_TESTS=1        — the isolated real PostgreSQL (learners_qa2) is in use;
 *   DICTIONARY_RELEASE_TESTS=1  — the FROZEN dictionary catalog has been applied to it.
 *
 * The catalog is an owner asset: a checksum-pinned, counts-pinned artifact that is not
 * in the repository (`scripts/dictionary/bootstrap.ts` refuses any file whose sha256 is
 * not the verified one, and the release is frozen the moment it is validated). Without
 * it there are no `dictionary_entries` at all, so recent searches have nothing to be
 * recent about. Every test in this repository that needs the frozen catalog gates on
 * `DICTIONARY_RELEASE_TESTS`, and this one now does too: a missing owner asset is a
 * reported SKIP, never a red gate that nobody can act on.
 *
 * The other direction is fail-closed. If the catalog IS requested and is not there —
 * no release, no validated stable release, an unreadable manifest — the test FAILS with
 * a precise message. A half-applied or wrongly-applied bootstrap must never be skipped
 * away.
 */
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
  qa2ResidueGuard = await createResidueGuard("dictionary-recent-qa2");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("dictionary-recent-qa2", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

const enabled = process.env.QA2_DATABASE_TESTS === "1" && process.env.DICTIONARY_RELEASE_TESTS === "1";
const skipReason =
  process.env.QA2_DATABASE_TESTS !== "1"
    ? "QA2_DATABASE_TESTS is not 1 (the isolated learners_qa2 database is required)"
    : "frozen dictionary catalog not available (owner asset): apply it with scripts/dictionary/bootstrap.ts <verified nested.json.gz>, then run with DICTIONARY_RELEASE_TESTS=1";

test("dictionary recent searches: last five only, duplicates move to top, private clear preserves other learners and vocabulary", { skip: enabled ? false : skipReason }, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/learners_qa2");
  const a = randomUUID(), b = randomUUID();
  await db.insert(users).values([
    { id: a, name: "Dictionary history QA A", role: "student", accountStatus: "active" },
    { id: b, name: "Dictionary history QA B", role: "student", accountStatus: "active" },
  ]);
  try {
    assert.deepEqual(await savedSenseIds(a, [randomUUID(), randomUUID(), randomUUID()]), [], "opening a multi-sense entry uses a valid parameterized query");
    // Requested, therefore required: report precisely instead of surfacing the store's
    // generic `dictionary_unavailable` from three frames deep.
    const release = await activeRelease().catch(() => null);
    assert.ok(
      release,
      "DICTIONARY_RELEASE_TESTS=1 was set but no validated stable release is active — the frozen catalog was not applied to this database",
    );
    const entries = await rows<{ lexeme_id: string }>(sql`select lexeme_id from dictionary_entries where release_id=${release.active_release_id} order by lexeme_id limit 8`);
    assert.equal(entries.length, 8, "requires the locally verified frozen dictionary bootstrap");
    for (let i = 0; i < 8; i++) await rememberSearch(a, `query ${i}`, "EN", entries[i]!.lexeme_id);
    await rememberSearch(b, "Other learner", "UZ", entries[0]!.lexeme_id);
    const recent = await recentSearches(a);
    assert.deepEqual(recent.map(r => r.query_display), ["query 7", "query 6", "query 5", "query 4", "query 3"]);
    assert.equal((await rows(sql`select * from dictionary_recent_searches where user_id=${a}::uuid`)).length, 5, "storage also caps history");
    await rememberSearch(a, "QUERY 4", "EN", entries[4]!.lexeme_id);
    const reopened = await recentSearches(a);
    assert.equal(reopened.length, 5);
    assert.equal(reopened[0]!.query_display, "QUERY 4");
    assert.equal(reopened.filter(r => String(r.query_display).toLowerCase() === "query 4").length, 1);
    await rememberSearch(a, "shishmoq", "UZ", entries[1]!.lexeme_id);
    await rememberSearch(a, "shishmoq", "UZ", entries[2]!.lexeme_id);
    const sameQuery = await recentSearches(a);
    assert.equal(sameQuery.length, 5);
    assert.equal(sameQuery.filter(r => r.query_display === "shishmoq").length, 2, "different opened entries survive the same Uzbek query");
    const vocabularyBefore = await rows(sql`select id from user_vocabulary where user_id in (${a}::uuid,${b}::uuid) order by id`);
    await clearRecentSearches(a);
    assert.equal((await recentSearches(a)).length, 0);
    assert.deepEqual((await recentSearches(b)).map(r => r.query_display), ["Other learner"]);
    assert.deepEqual(await rows(sql`select id from user_vocabulary where user_id in (${a}::uuid,${b}::uuid) order by id`), vocabularyBefore);
  } finally {
    await db.delete(users).where(eq(users.id, a));
    await db.delete(users).where(eq(users.id, b));
  }
});
