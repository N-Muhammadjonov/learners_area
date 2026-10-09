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

/**
 * C-OPEN-02 second edge: the SAVED-ONLY filter was applied AFTER pagination.
 *
 * `stealingLibrary` fetched at most 301 published rows, trimmed to 300, then dropped
 * unsaved ones in JavaScript. A learner whose saved patterns all sort beyond row 300
 * therefore saw an EMPTY saved-only library while their saved patterns existed, and
 * `matching`/`hasMore` described the unfiltered set rather than the one returned.
 *
 * The saved filter is user-specific, so it belongs in SQL beside publication and the
 * other predicates: returned rows, matching, hasMore, ordering and continuation must
 * all describe the SAME effective filter.
 */
test("saved-only finds saved patterns that sort beyond the first page", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof stealingLibrary>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Saved QA','student')returning id",
    );
    const [other] = await query<{ id: string }>(
      "insert into users(name,role)values('Other QA','student')returning id",
    );

    const ids: string[] = [];
    for (let i = 0; i < 320; i += 1) {
      const [row] = await query<{ id: string }>(
        `insert into writing_language_patterns
           (pattern,"function",task_type,topic,target_band,example,provenance,publication_state,publish_at)
         values($1,'concession','task2','Work',8,$2,'qa-fixture','published',now() - interval '1 day')
         returning id`,
        [`pattern ${String(i).padStart(4, "0")}`, `example ${i}`],
      );
      ids.push(row!.id);
    }

    // Saved ONLY the last 20 — every one of them sorts past row 300.
    const savedIds = ids.slice(300);
    for (const id of savedIds) {
      await query("insert into writing_pattern_bank(user_id,pattern_id)values($1,$2)", [user!.id, id]);
    }
    // Another learner saved patterns on the first page; they must never leak.
    for (const id of ids.slice(0, 5)) {
      await query("insert into writing_pattern_bank(user_id,pattern_id)values($1,$2)", [other!.id, id]);
    }

    const page = await stealingLibrary(user!.id, { fn: "concession", topic: "Work", band: 8, saved: true }, db);

    assert.equal(page.patterns.length, savedIds.length, "every saved pattern must be reachable");
    assert.equal(page.matching, savedIds.length, "matching must describe the saved-only filter");
    assert.equal(page.hasMore, false, "20 saved patterns fit in one page");
    assert.ok(page.patterns.every((p) => p.saved), "saved-only must return only saved patterns");
    assert.deepEqual(
      [...page.patterns].map((p) => p.id).sort(),
      [...savedIds].sort(),
      "exactly the learner's own saved patterns",
    );
    // Stable, deterministic order and no duplicates.
    const seen = new Set(page.patterns.map((p) => p.id));
    assert.equal(seen.size, page.patterns.length, "no duplicates");
    const again = await stealingLibrary(user!.id, { fn: "concession", topic: "Work", band: 8, saved: true }, db);
    assert.deepEqual(again.patterns.map((p) => p.id), page.patterns.map((p) => p.id), "stable order");
  } finally {
    await close();
  }
});

test("saved-only with no saved patterns is an honest empty page", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof stealingLibrary>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Empty QA','student')returning id",
    );
    for (let i = 0; i < 12; i += 1) {
      await query(
        `insert into writing_language_patterns
           (pattern,"function",task_type,topic,target_band,example,provenance,publication_state,publish_at)
         values($1,'concession','task2','Work',8,$2,'qa-fixture','published',now() - interval '1 day')`,
        [`pattern ${i}`, `example ${i}`],
      );
    }
    const page = await stealingLibrary(user!.id, { saved: true }, db);
    assert.equal(page.patterns.length, 0);
    assert.equal(page.matching, 0, "matching must be 0, not the unfiltered total");
    assert.equal(page.hasMore, false);
  } finally {
    await close();
  }
});

test("a large saved-only set stays bounded and says so", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof stealingLibrary>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Big QA','student')returning id",
    );
    for (let i = 0; i < 310; i += 1) {
      const [row] = await query<{ id: string }>(
        `insert into writing_language_patterns
           (pattern,"function",task_type,topic,target_band,example,provenance,publication_state,publish_at)
         values($1,'concession','task2','Work',8,$2,'qa-fixture','published',now() - interval '1 day')
         returning id`,
        [`pattern ${String(i).padStart(4, "0")}`, `example ${i}`],
      );
      await query("insert into writing_pattern_bank(user_id,pattern_id)values($1,$2)", [user!.id, row!.id]);
    }
    const page = await stealingLibrary(user!.id, { saved: true }, db);
    assert.equal(page.patterns.length, 300, "still bounded to one page");
    assert.equal(page.hasMore, true, "and it admits there are more");
    assert.equal(page.matching, 310, "matching counts the saved-only set");
  } finally {
    await close();
  }
});

test("an unpublished saved pattern never appears in the saved-only library", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: Parameters<typeof stealingLibrary>[2];
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [user] = await query<{ id: string }>(
      "insert into users(name,role)values('Pub QA','student')returning id",
    );
    const [draft] = await query<{ id: string }>(
      `insert into writing_language_patterns
         (pattern,"function",task_type,topic,target_band,example,provenance,publication_state)
       values('draft pattern','concession','task2','Work',8,'ex','qa-fixture','draft')
       returning id`,
    );
    const [live] = await query<{ id: string }>(
      `insert into writing_language_patterns
         (pattern,"function",task_type,topic,target_band,example,provenance,publication_state,publish_at)
       values('live pattern','concession','task2','Work',8,'ex','qa-fixture','published',now() - interval '1 day')
       returning id`,
    );
    await query("insert into writing_pattern_bank(user_id,pattern_id)values($1,$2)", [user!.id, draft!.id]);
    await query("insert into writing_pattern_bank(user_id,pattern_id)values($1,$2)", [user!.id, live!.id]);

    const page = await stealingLibrary(user!.id, { saved: true }, db);
    assert.deepEqual(page.patterns.map((p) => p.id), [live!.id], "publication still gates the saved list");
    assert.equal(page.matching, 1);
  } finally {
    await close();
  }
});
