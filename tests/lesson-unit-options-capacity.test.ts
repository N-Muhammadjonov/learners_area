import test from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase } from "./support/pglite";
import { listUnitOptions } from "../src/lib/content/lesson-staff";

/**
 * C-OPEN-01 regression.
 *
 * The lesson authoring desk offered units from a bare `.limit(500)`. Once a centre
 * authored more than 500 units, unit #501 and everything after it became silently
 * unselectable: a lesson could never be created into them. The curriculum is meant to
 * keep accepting content, so the picker must let every unit be FOUND without loading
 * the whole corpus into one response — a server-filtered search with a bounded page.
 */
test("every unit stays findable beyond the first bounded page", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: { select: typeof import("../src/db/client").db.select };
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [course] = await query<{ id: string }>(
      "insert into courses(title,slug)values('Capacity Course','capacity-course')returning id",
    );
    const [module] = await query<{ id: string }>(
      `insert into course_modules(course_id,title,slug,"order")values($1,'Module A','module-a',1)returning id`,
      [course!.id],
    );

    const total = 620;
    for (let i = 1; i <= total; i += 1) {
      await query(
        `insert into units(module_id,title,slug,"order")values($1,$2,$3,$4)`,
        [module!.id, `Unit ${String(i).padStart(4, "0")}`, `unit-${i}`, i],
      );
    }

    // The default page stays bounded and admits that more exist.
    const firstPage = await listUnitOptions(db);
    assert.ok(firstPage.options.length <= 500, `page not bounded: ${firstPage.options.length}`);
    assert.equal(firstPage.hasMore, true, "more units exist than were offered, unreported");
    assert.equal(firstPage.matching, total, "the true unit count must be reported");

    // Unit 501+ and the final unit must be reachable by searching.
    const late = await listUnitOptions(db, { search: "Unit 0501" });
    assert.equal(late.options.length, 1, "unit 501 could not be found");
    assert.match(late.options[0]!.label, /Unit 0501/);

    const last = await listUnitOptions(db, { search: `Unit ${String(total).padStart(4, "0")}` });
    assert.equal(last.options.length, 1, "the final seeded unit could not be found");
    assert.match(last.options[0]!.label, new RegExp(`Unit 0${total}`));

    // Search is bounded, deduplicated and stably ordered.
    const broad = await listUnitOptions(db, { search: "Unit" });
    assert.ok(broad.options.length <= 500, "search result is not bounded");
    assert.equal(broad.hasMore, true, "a broad search must admit truncation");
    const ids = broad.options.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate units in one page");
    const broadAgain = await listUnitOptions(db, { search: "Unit" });
    assert.deepEqual(broadAgain.options.map((o) => o.id), ids, "ordering is not stable");

    // A search that matches nothing is honest rather than silently showing page one.
    const none = await listUnitOptions(db, { search: "no-such-unit-xyz" });
    assert.equal(none.options.length, 0);
    assert.equal(none.hasMore, false);
    assert.equal(none.matching, 0);
  } finally {
    await close();
  }
});
