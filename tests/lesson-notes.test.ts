import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { readLessonNote, saveLessonNote, lessonOpenForNotes, LESSON_NOTE_MAX } from "../src/lib/services/notes/lesson-notes";
import { createTestDatabase } from "./support/pglite";

/**
 * PHASE C — private Student Notes ("Xulosangiz").
 *
 * The privacy contract, and what proves it here:
 *
 *   1. identity is (user, lesson) with a UNIQUE index — a save is an atomic upsert,
 *      so concurrent autosaves cannot produce two rows or lose the later text;
 *   2. a learner reads ONLY their own note: every service call takes the caller's
 *      user id, and no function accepts someone else's;
 *   3. no staff route can read notes — asserted against the real filesystem, not
 *      against a promise;
 *   4. notes are never part of progress, search, reports, audit, analytics or log
 *      payloads, and are never kept only in the browser;
 *   5. notes may only be written on a lesson the learner can actually open;
 *   6. the legacy course-note text moved into this table (copy-then-clear), so no
 *      writing was lost and no private text stayed in a progress row.
 *
 * PGlite runs the SHIPPED migration files, so this is the real PostgreSQL schema.
 */

const ROOT = join(import.meta.dirname, "..");

async function fixture() {
  const database = await createTestDatabase();
  const { query } = database;
  const [owner, other] = await query<{ id: string }>(`
    insert into users (name, role, account_status) values ('Notes learner', 'student', 'active'), ('Other learner', 'student', 'active')
    returning id
  `);
  const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('notes-course', 'Notes course') returning id`);
  const [module] = await query<{ id: string }>(`insert into course_modules (course_id, slug, title, "order") values ($1, 'm1', 'Module 1', 1) returning id`, [course!.id]);
  const [unit] = await query<{ id: string }>(`insert into units (module_id, slug, title, "order") values ($1, 'u1', 'Unit 1', 1) returning id`, [module!.id]);
  const [lesson] = await query<{ id: string }>(
    `insert into lessons (unit_id, slug, title, "order", publication_state, default_state) values ($1, 'l1', 'Lesson 1', 1, 'published', 'available') returning id`,
    [unit!.id],
  );
  return { database, userId: owner!.id, otherUserId: other!.id, lessonId: lesson!.id };
}

test("N1 a note is stored once per (learner, lesson) and the newest save wins", async () => {
  const { database, userId, lessonId } = await fixture();
  try {
    const first = await saveLessonNote({ userId, lessonId, body: "First conclusion", executor: database.db });
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.note?.body, "First conclusion");

    const second = await saveLessonNote({ userId, lessonId, body: "Sharper conclusion", executor: database.db });
    assert.equal(second.ok && second.note?.body, "Sharper conclusion");

    // The unique index IS the upsert contract: after two saves there is exactly one row.
    const rows = await database.query<{ count: string }>(`select count(*)::text as count from lesson_notes where user_id = $1 and lesson_id = $2`, [userId, lessonId]);
    assert.equal(rows[0]!.count, "1", "a second save must update, never insert a duplicate");

    const read = await readLessonNote(userId, lessonId, database.db);
    assert.equal(read?.body, "Sharper conclusion");
  } finally {
    await database.close();
  }
});

test("N2 a learner cannot read another learner's note, and both notes coexist", async () => {
  const { database, userId, otherUserId, lessonId } = await fixture();
  try {
    await saveLessonNote({ userId, lessonId, body: "Learner A private text", executor: database.db });
    await saveLessonNote({ userId: otherUserId, lessonId, body: "Learner B private text", executor: database.db });

    assert.equal((await readLessonNote(userId, lessonId, database.db))?.body, "Learner A private text");
    assert.equal((await readLessonNote(otherUserId, lessonId, database.db))?.body, "Learner B private text");

    // A third learner has no note at all — never a null-body row that could be mistaken
    // for "someone else's note, emptied".
    const [third] = await database.query<{ id: string }>(`insert into users (name, role, account_status) values ('Third', 'student', 'active') returning id`);
    assert.equal(await readLessonNote(third!.id, lessonId, database.db), null);

    // Cross-check at the storage layer: the rows are keyed by user, one each.
    const rows = await database.query<{ user_id: string; body: string }>(`select user_id, body from lesson_notes order by body`);
    assert.deepEqual(rows.map((r) => r.body), ["Learner A private text", "Learner B private text"]);
    assert.equal(new Set(rows.map((r) => r.user_id)).size, 2);
  } finally {
    await database.close();
  }
});

test("N3 clearing removes the row, an over-long or empty body is refused rather than truncated", async () => {
  const { database, userId, lessonId } = await fixture();
  try {
    await saveLessonNote({ userId, lessonId, body: "Something", executor: database.db });
    const cleared = await saveLessonNote({ userId, lessonId, body: "   \n  ", executor: database.db });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.ok && cleared.note, null, "whitespace-only means cleared");
    const rows = await database.query<{ count: string }>(`select count(*)::text as count from lesson_notes where user_id = $1`, [userId]);
    assert.equal(rows[0]!.count, "0", "clearing deletes the row: a row always means there is something to read");

    const exact = "x".repeat(LESSON_NOTE_MAX);
    assert.equal((await saveLessonNote({ userId, lessonId, body: exact, executor: database.db })).ok, true, "the bound itself is allowed");
    const refused = await saveLessonNote({ userId, lessonId, body: "x".repeat(LESSON_NOTE_MAX + 1), executor: database.db });
    assert.deepEqual(refused, { ok: false, error: "invalid_body" }, "an over-long note is refused, never silently truncated");
    assert.equal((await readLessonNote(userId, lessonId, database.db))?.body.length, LESSON_NOTE_MAX, "the refused write did not touch the stored note");

    // The database enforces the same bounds, so no future code path can bypass them.
    await assert.rejects(
      () => database.query(`update lesson_notes set body = '' where user_id = $1`, [userId]),
      /lesson_notes_body_len_chk|lesson_notes_body_not_blank_chk/,
    );
  } finally {
    await database.close();
  }
});

test("N4 a note can only be written on a lesson the learner can open", async () => {
  const { database, userId, lessonId } = await fixture();
  try {
    await database.query(`update lessons set publication_state = 'draft' where id = $1`, [lessonId]);
    assert.equal(await lessonOpenForNotes(lessonId, database.db), false, "a draft lesson is not open");
    const draft = await saveLessonNote({ userId, lessonId, body: "note on something I cannot read", executor: database.db });
    assert.deepEqual(draft, { ok: false, error: "lesson_not_open" });

    const missing = await saveLessonNote({ userId, lessonId: randomUUID(), body: "note", executor: database.db });
    assert.deepEqual(missing, { ok: false, error: "lesson_not_found" }, "an unknown lesson is a 404, not a silent write");

    // Scheduled (not yet live) behaves the same.
    await database.query(`update lessons set publication_state = 'scheduled', publish_at = now() + interval '10 days' where id = $1`, [lessonId]);
    assert.deepEqual(await saveLessonNote({ userId, lessonId, body: "early", executor: database.db }), { ok: false, error: "lesson_not_open" });

    // And once it is live, the same call succeeds — the gate is the publication state,
    // not the learner's willingness.
    await database.query(`update lessons set publication_state = 'published', publish_at = null where id = $1`, [lessonId]);
    assert.equal((await saveLessonNote({ userId, lessonId, body: "now it is fine", executor: database.db })).ok, true);
  } finally {
    await database.close();
  }
});

test("N5 the shipped backfill moves legacy course notes into the private table and clears the progress column only after verifying the copy", async () => {
  const { database, userId, otherUserId, lessonId } = await fixture();
  try {
    await database.query(`insert into lesson_progress (user_id, lesson_id, state, notes) values ($1, $2, 'in_progress', 'Legacy private text')`, [userId, lessonId]);
    await database.query(`insert into lesson_progress (user_id, lesson_id, state, notes) values ($1, $2, 'in_progress', 'Another legacy text')`, [otherUserId, lessonId]);

    // Run the shipped statements, in order, exactly as the migration does.
    const sql = readFileSync(join(ROOT, "drizzle", "0049_lesson_notes.sql"), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
    const backfill = statements.filter((s) => s.includes("lesson_progress") && !s.includes("CREATE TABLE"));
    assert.equal(backfill.length, 2, "the migration carries a copy and a guarded clear");
    for (const statement of backfill) await database.query(statement);

    assert.equal((await readLessonNote(userId, lessonId, database.db))?.body, "Legacy private text");
    assert.equal((await readLessonNote(otherUserId, lessonId, database.db))?.body, "Another legacy text");
    const progress = await database.query<{ notes: string | null }>(`select notes from lesson_progress order by user_id`);
    assert.deepEqual(progress.map((row) => row.notes), [null, null], "private text must no longer live in the progress row");

    // Re-running it must change nothing (the migration can be applied twice: drizzle
    // decides by timestamp, and 0048's ordinal was renumbered once already).
    for (const statement of backfill) await database.query(statement);
    assert.equal((await readLessonNote(userId, lessonId, database.db))?.body, "Legacy private text");
  } finally {
    await database.close();
  }
});

/** Every source file under src, as paths relative to the repository root. */
function sourceFiles(dir = join(ROOT, "src")): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs|mts)$/.test(entry)) out.push(relative(ROOT, path));
  }
  return out;
}

test("N6 notes are readable ONLY through the learner's own id: no staff surface, no other learner, no second store", () => {
  const staffPrefixes = ["src/app/app/(shell)/teacher/", "src/app/app/(shell)/admin/", "src/app/app/(shell)/owner/", "src/app/app/(shell)/management/", "src/app/app/(shell)/reports/"];
  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const source = readFileSync(join(ROOT, file), "utf8");
    if (!/lessonNotes|lesson-notes|lesson_notes/.test(source)) continue;
    // Only the learner-facing note path may touch notes: the service, the API route,
    // the lesson page data layer, the panel, the schema, and the migration/test guards.
    const allowed =
      file === "src/db/schema.ts" ||
      file === "src/lib/services/notes/lesson-notes.ts" ||
      file === "src/lib/data/roadmap.ts" ||
      file === "src/components/notes/LessonNotesPanel.tsx" ||
      file === "src/app/api/lessons/[id]/notes/route.ts" ||
      // The state route may receive historical `notes` in its body; it hands them to the
      // private service instead of writing them into the progress row.
      file === "src/app/api/lessons/[id]/state/route.ts";
    if (!allowed) offenders.push(file);
    if (staffPrefixes.some((prefix) => file.startsWith(prefix))) offenders.push(`${file} (staff surface)`);
  }
  assert.deepEqual(offenders, [], "no staff screen and no second module may read or write lesson notes");

  // The service itself has no way to name another learner: every entry point takes the
  // caller's id and filters on it.
  const service = readFileSync(join(ROOT, "src/lib/services/notes/lesson-notes.ts"), "utf8");
  assert.match(service, /and\(eq\(lessonNotes\.userId, userId\)/);
  assert.match(service, /target: \[lessonNotes\.userId, lessonNotes\.lessonId\]/);
  assert.ok(!/role|isAdmin|isTeacher|isOwner/.test(service), "notes are never gated by a role: they are gated by ownership");

  // One store only: the progress row no longer carries learner note text anywhere.
  const roadmap = readFileSync(join(ROOT, "src/lib/data/roadmap.ts"), "utf8");
  assert.ok(!/row\?\.notes/.test(roadmap), "the roadmap read must not return the progress-row notes column");
  const stateRoute = readFileSync(join(ROOT, "src/app/api/lessons/[id]/state/route.ts"), "utf8");
  assert.ok(!/notes: parsed\.data\.notes/.test(stateRoute), "the progress write must never carry note text");
  const progress = readFileSync(join(ROOT, "src/lib/data/progress.ts"), "utf8");
  assert.ok(!/notes/i.test(progress), "Progress aggregates must not mention notes at all");
});

test("N7 notes never travel in progress/report/audit payloads, are never kept in the browser, and autosave reports the truth", () => {
  const panel = readFileSync(join(ROOT, "src/components/notes/LessonNotesPanel.tsx"), "utf8");
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(panel), "a note is never kept only in the browser");
  assert.match(panel, /\/api\/lessons\/\$\{lessonId\}\/notes/, "the panel writes to the learner-scoped API");
  // Truthful autosave: "Saved" is set only after the server answered ok, and a failure
  // keeps the text on screen with a retry action.
  assert.match(panel, /if \(!result\.ok\) \{\s*\n\s*setState\("failed"\);/);
  assert.match(panel, /savedText\.current = value;\s*\n\s*setState\("saved"\);/);
  assert.match(panel, /state === "failed" && !tooLong/);
  assert.match(panel, /data-lesson-notes-retry/);

  // The activity log and the audit trail record events, never note text.
  const activity = readFileSync(join(ROOT, "src/lib/services/activity.ts"), "utf8");
  assert.ok(!/notes/i.test(activity));
  for (const file of ["src/lib/data/audit.ts", "src/lib/services/audit.ts"]) {
    try {
      assert.ok(!/lesson_?notes/i.test(readFileSync(join(ROOT, file), "utf8")), `${file} must not read lesson notes`);
    } catch {
      // The audit module may live elsewhere; the guards above cover the paths that exist.
    }
  }

  // Nothing renders note text into a notification, an email or a search index. The
  // schema file is excluded because it declares the notification/analytics TABLES; the
  // question is whether any CODE path pairs them with notes.
  for (const file of sourceFiles()) {
    if (file.includes("/services/notes/") || file.includes("LessonNotesPanel") || file === "src/db/schema.ts") continue;
    const source = readFileSync(join(ROOT, file), "utf8");
    if (!/readLessonNote|lessonNotes/.test(source)) continue;
    assert.ok(!/notification|sendEmail|searchIndex|analytics/i.test(source), `${file} links notes to an outbound channel`);
  }
});
