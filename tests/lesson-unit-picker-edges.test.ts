import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { listUnitOptions, resolveUnitOptions } from "../src/lib/content/lesson-staff";

/**
 * Package A2 + A4: the unit picker's remaining edges.
 *
 * A2 — 620 units sharing one course, module and unit title must still be told apart.
 * A4 — a cursor is a POSITION, not a capability. It must be validated hard enough that
 *      no caller-supplied string can restart the walk silently, reach the database as a
 *      bad literal, or resume a walk under a filter it was not minted for.
 */

type Harness = {
  db: { select: typeof import("../src/db/client").db.select };
  query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
  close: () => Promise<void>;
};

async function seedIdenticalUnits(count: number) {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as Harness;
  const [course] = await query<{ id: string }>(
    "insert into courses(title,slug)values('Edge Course','edge-course')returning id",
  );
  const [module] = await query<{ id: string }>(
    `insert into course_modules(course_id,title,slug,"order")values($1,'Edge Module','edge-module',1)returning id`,
    [course!.id],
  );
  const ids: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const [row] = await query<{ id: string }>(
      `insert into units(module_id,title,slug,"order")values($1,'Identical Unit',$2,$3)returning id`,
      [module!.id, `identical-${i}`, i],
    );
    ids.push(row!.id);
  }
  return { db, query, close, ids };
}

test("A2: identically titled units are distinguished by their authored unit order", async () => {
  const { db, close, ids } = await seedIdenticalUnits(620);
  try {
    // Walk the whole corpus so the LAST unit is included, not just the first page.
    const seen: { id: string; label: string }[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await listUnitOptions(db, { cursor: cursor ?? undefined });
      seen.push(...page.options);
      cursor = page.nextCursor;
    } while (cursor);

    assert.equal(seen.length, 620, "every identically titled unit must be offered");

    // The whole point: no two options may read the same, or an author choosing from
    // the list is choosing blind.
    const labels = new Set(seen.map((option) => option.label));
    assert.equal(labels.size, 620, `labels collide: only ${labels.size} distinct of 620`);

    // The discriminator must be the CANONICAL curriculum field (units.order), not an
    // invented identifier and not the opaque row id.
    assert.match(seen[0]!.label, /Edge Course › Edge Module › 1\. Identical Unit/);
    assert.match(seen[619]!.label, /Edge Course › Edge Module › 620\. Identical Unit/);
    for (const option of seen) {
      assert.ok(!option.label.includes(option.id), "a raw row id is not a curriculum discriminator");
    }

    // The number shown must match the position actually walked, or it misleads.
    seen.forEach((option, index) => {
      const shown = Number(/› (\d+)\. /.exec(option.label)?.[1]);
      assert.equal(shown, index + 1, `option ${index} is labelled ${shown}`);
    });

    // And the label must still identify a REAL, selectable unit.
    assert.equal(new Set(ids).size, 620);
    assert.deepEqual([...new Set(seen.map((o) => o.id))].length, 620);
  } finally {
    await close();
  }
});

test("A4: every malformed cursor is refused, never a silent restart and never a DB error", async () => {
  const { db, close } = await seedIdenticalUnits(3);
  try {
    const encode = (payload: unknown) => Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

    const malformed: [string, string][] = [
      ["empty string", ""],
      ["whitespace only", "   "],
      ["not base64url at all", "not a cursor!!"],
      ["base64 with forbidden characters", "YWJj+/=="],
      ["oversized", "A".repeat(5000)],
      ["valid base64url, invalid JSON", Buffer.from("{nope", "utf8").toString("base64url")],
      ["JSON object, not a tuple", encode({ course: "x" })],
      ["tuple too short", encode([1, "", "Edge Course", 1])],
      ["tuple too long", encode([1, "", "Edge Course", 1, 1, "x", "extra"])],
      ["legacy unversioned 4-tuple", encode(["Edge Course", 1, 1, "00000000-0000-4000-8000-000000000000"])],
      ["unsupported version", encode([99, "", "Edge Course", 1, 1, "00000000-0000-4000-8000-000000000000"])],
      ["non-integer module order", encode([1, "", "Edge Course", 1.5, 1, "00000000-0000-4000-8000-000000000000"])],
      ["string where a number belongs", encode([1, "", "Edge Course", "1", 1, "00000000-0000-4000-8000-000000000000"])],
      ["out-of-range order", encode([1, "", "Edge Course", 1, 9e18, "00000000-0000-4000-8000-000000000000"])],
      ["null order", encode([1, "", "Edge Course", null, 1, "00000000-0000-4000-8000-000000000000"])],
      ["id is not a UUID", encode([1, "", "Edge Course", 1, 1, "not-a-uuid"])],
      ["id is a SQL fragment", encode([1, "", "Edge Course", 1, 1, "' or '1'='1"])],
      ["course is not a string", encode([1, "", 42, 1, 1, "00000000-0000-4000-8000-000000000000"])],
    ];

    for (const [label, cursor] of malformed) {
      await assert.rejects(
        () => listUnitOptions(db, { cursor }),
        (error: unknown) => {
          assert.ok(error instanceof Error, `${label}: expected an Error`);
          // A cursor fault must be reported AS a cursor fault — that is what the route
          // turns into a 400. Anything else is a 500 leaking from the database.
          assert.match(error.message, /cursor/i, `${label}: not reported as a cursor fault`);
          return true;
        },
        `a bad cursor (${label}) must not quietly return page 1`,
      );
    }
  } finally {
    await close();
  }
});

test("A4: a cursor is bound to the search it was minted under", async () => {
  const { db, close } = await seedIdenticalUnits(620);
  try {
    const filtered = await listUnitOptions(db, { search: "Identical" });
    assert.ok(filtered.nextCursor, "a 620-row search must page");

    // Same term: the walk continues.
    const continued = await listUnitOptions(db, { search: "Identical", cursor: filtered.nextCursor! });
    assert.ok(continued.options.length > 0, "the same search must resume");

    // Different term, and no term at all: the position is meaningless there, because
    // the row the cursor names is not necessarily in the other result set. Resuming
    // anyway would skip rows the caller has never seen while reporting a clean page.
    for (const [label, opts] of [
      ["a different search", { search: "Edge Module", cursor: filtered.nextCursor! }],
      ["no search", { cursor: filtered.nextCursor! }],
    ] as const) {
      await assert.rejects(
        () => listUnitOptions(db, opts),
        /cursor/i,
        `a cursor replayed under ${label} must be refused`,
      );
    }
  } finally {
    await close();
  }
});

test("A1 support: a unit off the first page can still be resolved to its label by id", async () => {
  const { db, close, ids } = await seedIdenticalUnits(620);
  try {
    const firstPage = await listUnitOptions(db);
    const lateId = ids[619]!;
    assert.ok(
      !firstPage.options.some((option) => option.id === lateId),
      "precondition: unit #620 must NOT be on the first page",
    );

    // This is what a reopened lesson needs: one row, by id, without the corpus.
    const resolved = await resolveUnitOptions(db, [lateId]);
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0]!.id, lateId);
    assert.match(resolved[0]!.label, /Edge Course › Edge Module › 620\. Identical Unit/);

    // It must agree exactly with the label the listing would have produced.
    let walked: { id: string; label: string } | undefined;
    let cursor: string | null | undefined;
    do {
      const page = await listUnitOptions(db, { cursor: cursor ?? undefined });
      walked = page.options.find((option) => option.id === lateId) ?? walked;
      cursor = page.nextCursor;
    } while (cursor && !walked);
    assert.equal(resolved[0]!.label, walked?.label, "resolve and list must label a unit identically");

    // Junk and unknown ids resolve to nothing rather than erroring or leaking.
    assert.deepEqual(await resolveUnitOptions(db, ["not-a-uuid", "' or 1=1 --"]), []);
    assert.deepEqual(await resolveUnitOptions(db, ["00000000-0000-4000-8000-000000000000"]), []);
    assert.deepEqual(await resolveUnitOptions(db, []), []);

    // Bounded: a caller cannot turn the label lookup into a corpus dump.
    const flood = await resolveUnitOptions(db, ids);
    assert.ok(flood.length <= 50, `label lookup must stay bounded, got ${flood.length}`);
  } finally {
    await close();
  }
});
