import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { stealingLibrary } from "../src/lib/services/writing/stealing";

/**
 * C-OPEN-02 regression.
 *
 * The language-stealing library read patterns with a bare `.limit(300)`. One filter
 * combination holding more than 300 live patterns was therefore truncated SILENTLY:
 * the learner was shown 300 rows with nothing indicating that more matched. The read
 * must stay bounded (we do not want an unbounded list in one response), but the caller
 * must be told the truth so the UI can ask for narrower filters.
 */
test("a filter matching more than 300 live patterns reports that it was truncated", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof stealingLibrary>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Stealing QA','student')returning id",
    );

    // 320 live patterns that all match one filter combination.
    const total = 320;
    for (let i = 0; i < total; i += 1) {
      await query(
        `insert into writing_language_patterns
           (pattern,"function",task_type,topic,target_band,example,provenance,publication_state,publish_at)
         values($1,'concession','task2','Work',8,$2,'qa-fixture','published',now() - interval '1 day')`,
        [`pattern ${String(i).padStart(4, "0")}`, `example ${i}`],
      );
    }

    const page = await stealingLibrary(user!.id, { fn: "concession", topic: "Work", band: 8 }, db);

    assert.ok(
      page.patterns.length <= 300,
      `the response must stay bounded, got ${page.patterns.length}`,
    );
    assert.equal(
      page.hasMore,
      true,
      "more patterns match than were returned, and the caller was not told",
    );
    assert.equal(page.matching, total, "the true number of matching patterns must be reported");

    // No duplicates and a stable, deterministic order.
    const ids = page.patterns.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate rows in one page");
    const again = await stealingLibrary(user!.id, { fn: "concession", topic: "Work", band: 8 }, db);
    assert.deepEqual(again.patterns.map((p) => p.id), ids, "ordering is not stable");

    // A narrower filter must come back complete and honest.
    const narrow = await stealingLibrary(user!.id, { fn: "concession", topic: "Work", band: 7 }, db);
    assert.equal(narrow.patterns.length, 0);
    assert.equal(narrow.hasMore, false, "an unfiltered-but-small result must not claim truncation");
    assert.equal(narrow.matching, 0);
  } finally {
    await close();
  }
});
