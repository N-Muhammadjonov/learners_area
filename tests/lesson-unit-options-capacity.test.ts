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

/**
 * C-OPEN-01 second edge: search alone does not guarantee reachability.
 *
 * The typeahead made unit #501+ findable BY NAME, which is enough only while names
 * discriminate. A centre with 620 units sharing one title inside the same course and
 * module has nothing to type that narrows the result below the page size, so every unit
 * past row 500 is unselectable no matter what the user searches for.
 *
 * The page must therefore offer a real continuation. The order
 * (course title, module order, unit order, id) is total and deterministic, so a keyset
 * cursor walks it exactly once: no duplicates, no omissions, no OFFSET scan.
 */
test("620 identically named units in one module are all reachable by cursor", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: { select: typeof import("../src/db/client").db.select };
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [course] = await query<{ id: string }>(
      "insert into courses(slug,title,publication_state)values('same-name','Same Name Course','published')returning id",
    );
    const [module] = await query<{ id: string }>(
      `insert into course_modules(course_id,slug,title,"order")
       values($1,'only-module','Only Module',1)returning id`,
      [course!.id],
    );
    const total = 620;
    for (let i = 0; i < total; i += 1) {
      await query(
        `insert into units(module_id,slug,title,"order")values($1,$2,'Unit',$3)`,
        [module!.id, `unit-${i + 1}`, i + 1],
      );
    }

    const seen: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const page = await listUnitOptions(db, { search: "Unit", cursor: cursor ?? undefined });
      assert.ok(page.options.length > 0, "a page that claims more must deliver more");
      seen.push(...page.options.map((o) => o.id));
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages < 10, "pagination must terminate");
    } while (cursor);

    assert.equal(seen.length, total, "every unit must be reachable");
    assert.equal(new Set(seen).size, total, "no duplicates across pages");
  } finally {
    await close();
  }
});

test("a cursor walk returns the same units as the unpaginated truth, in the same order", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: { select: typeof import("../src/db/client").db.select };
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    // Two courses so the cross-course ordering component is exercised.
    for (const [slug, title] of [["beta", "Beta Course"], ["alpha", "Alpha Course"]]) {
      const [course] = await query<{ id: string }>(
        "insert into courses(slug,title,publication_state)values($1,$2,'published')returning id",
        [slug, title],
      );
      for (let m = 1; m <= 2; m += 1) {
        const [module] = await query<{ id: string }>(
          `insert into course_modules(course_id,slug,title,"order")
           values($1,$2,$3,$4)returning id`,
          [course!.id, `module-${slug}-${m}`, `Module ${m}`, m],
        );
        for (let u = 1; u <= 3; u += 1) {
          await query(
            `insert into units(module_id,slug,title,"order")values($1,$2,'Unit',$3)`,
            [module!.id, `unit-${slug}-${m}-${u}`, u],
          );
        }
      }
    }

    const whole = await listUnitOptions(db, {});
    const walked: string[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await listUnitOptions(db, { cursor: cursor ?? undefined });
      walked.push(...page.options.map((o) => o.id));
      cursor = page.nextCursor;
    } while (cursor);

    assert.deepEqual(walked, whole.options.map((o) => o.id), "same set, same order");
  } finally {
    await close();
  }
});

test("the last page reports no continuation", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: { select: typeof import("../src/db/client").db.select };
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    const [course] = await query<{ id: string }>(
      "insert into courses(slug,title,publication_state)values('small','Small Course','published')returning id",
    );
    const [module] = await query<{ id: string }>(
      `insert into course_modules(course_id,slug,title,"order")
       values($1,'m','M',1)returning id`,
      [course!.id],
    );
    await query(`insert into units(module_id,slug,title,"order")values($1,'u','Unit',1)`, [module!.id]);

    const page = await listUnitOptions(db, {});
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null, "no continuation when there is nothing left");
  } finally {
    await close();
  }
});

test("a malformed cursor is refused rather than silently ignored", async () => {
  const database = await createTestDatabase();
  const { db, close } = database as unknown as {
    db: { select: typeof import("../src/db/client").db.select };
    close: () => Promise<void>;
  };
  try {
    // Both failure branches matter. Undecodable input is the easy one; the dangerous
    // one is a cursor that decodes cleanly but carries the wrong SHAPE, because a
    // permissive decoder turns that into a silent "start from the beginning".
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const malformed: Array<[string, string]> = [
      ["undecodable", "not-a-cursor"],
      ["valid base64, not JSON", Buffer.from("<<<", "utf8").toString("base64url")],
      ["JSON object, not a tuple", b64({ course: "A", id: "x" })],
      ["tuple too short", b64(["A", 1, 2])],
      ["tuple too long", b64(["A", 1, 2, "x", "extra"])],
      ["wrong member types", b64(["A", "1", "2", "x"])],
      ["null members", b64([null, null, null, null])],
      ["empty string", ""],
    ];
    for (const [label, cursor] of malformed) {
      await assert.rejects(
        () => listUnitOptions(db, { cursor }),
        /cursor/i,
        `a bad cursor (${label}) must not quietly return page 1`,
      );
    }
  } finally {
    await close();
  }
});

/**
 * C-OPEN-01, remaining requirement list.
 *
 * A broad term that matches more than one page must still be walkable to the end, and
 * walking it must never leak a non-matching unit or mislabel which course a unit
 * belongs to. Picking the wrong course is the quiet failure here: the desk shows only
 * a label, so a cursor that lost its course ordering would let staff author a lesson
 * into another centre's curriculum without any visible error.
 */
test("a broad search matching more than one page is walkable without leaks or mislabels", async () => {
  const database = await createTestDatabase();
  const { db, query, close } = database as unknown as {
    db: { select: typeof import("../src/db/client").db.select };
    query: <T>(sql: string, params?: unknown[]) => Promise<T[]>;
    close: () => Promise<void>;
  };
  try {
    // Three courses so the ordering key actually has to carry the course component,
    // and a decoy course whose units must never appear for this term.
    const courseNames = ["Alpha Centre", "Beta Centre", "Gamma Centre"];
    const expected: { id: string; course: string }[] = [];

    for (const [c, courseTitle] of courseNames.entries()) {
      const [course] = await query<{ id: string }>(
        "insert into courses(title,slug)values($1,$2)returning id",
        [courseTitle, `course-${c}`],
      );
      const [module] = await query<{ id: string }>(
        `insert into course_modules(course_id,title,slug,"order")values($1,'Module','module',1)returning id`,
        [course!.id],
      );
      for (let u = 1; u <= 210; u += 1) {
        const [unit] = await query<{ id: string }>(
          `insert into units(module_id,title,slug,"order")values($1,$2,$3,$4)returning id`,
          [module!.id, "Shared Listening Unit", `unit-${c}-${u}`, u],
        );
        expected.push({ id: unit!.id, course: courseTitle });
      }
    }

    const [decoy] = await query<{ id: string }>(
      "insert into courses(title,slug)values('Decoy Centre','decoy')returning id",
    );
    const [decoyModule] = await query<{ id: string }>(
      `insert into course_modules(course_id,title,slug,"order")values($1,'Module','module',1)returning id`,
      [decoy!.id],
    );
    await query(`insert into units(module_id,title,slug,"order")values($1,'Reading Only','reading-only',1)`, [
      decoyModule!.id,
    ]);

    // 630 matches across three courses: more than one bounded page.
    const seen: { id: string; course: string; label: string }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listUnitOptions(db, { search: "Shared Listening", ...(cursor ? { cursor } : {}) });
      assert.ok(page.options.length <= page.pageSize, "a page must stay bounded");
      seen.push(...page.options.map((o) => ({ id: o.id, course: o.course, label: o.label })));
      cursor = page.nextCursor;
      pages += 1;
      assert.ok(pages <= 10, "the walk must terminate");
    } while (cursor);

    assert.ok(pages > 1, "630 matches must not fit in one page, or this proves nothing");
    assert.equal(seen.length, expected.length, "every matching unit must be reachable");
    assert.equal(new Set(seen.map((u) => u.id)).size, expected.length, "no unit may be served twice");

    // No leak: the decoy unit never appears.
    assert.ok(!seen.some((u) => u.label.includes("Reading Only")), "a non-matching unit must not appear");

    // No wrong-course selection: each id keeps the course it was created under, and
    // the label agrees with the reported course.
    const courseById = new Map(expected.map((u) => [u.id, u.course]));
    for (const unit of seen) {
      assert.equal(unit.course, courseById.get(unit.id), `unit ${unit.id} reported the wrong course`);
      assert.ok(unit.label.startsWith(`${unit.course} ›`), `label must name the owning course: ${unit.label}`);
    }

    // Courses stay grouped in order across the page boundary.
    const order = seen.map((u) => u.course);
    assert.deepEqual([...new Set(order)], courseNames, "courses must stay in a stable total order across pages");
    assert.deepEqual(order, [...order].sort((a, b) => a.localeCompare(b)), "course grouping must not interleave");
  } finally {
    await close();
  }
});
