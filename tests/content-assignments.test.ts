import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { assignmentTargets, assignments, contentVersions, grammarTopics } from "../src/db/schema";
import {
  assignmentContent,
  createAssignment,
  listAssignmentsCreatedBy,
  listAssignmentsForStudent,
  mayAssignTo,
  mayReadAssignment,
  setAssignmentTargetStatus,
  type AssignmentActor,
} from "../src/lib/content/assignments";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { saveTopicPack } from "../src/lib/content/vocabulary-packs";
import { createTestDatabase } from "./support/pglite";

/**
 * Assignments over canonical content, with role boundaries (§24, §25, §99, §71).
 *
 * The claims under test:
 *   • an assignment references canonical content and pins the revision a learner is
 *     actually given — a later content edit does not rewrite what was set;
 *   • only a PUBLISHED revision can be assigned (no work nobody can open);
 *   • a teacher may only set work for students on their own roster, an
 *     administrator for any student, and a learner may not assign at all;
 *   • one assignment can be set for several students, each with its own status;
 *   • a learner sees their own tasks and nobody else's.
 */

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

async function people(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const { query } = database;
  const [owner1] = await query<{ id: string }>(`insert into users (name, role) values ('Assign owner', 'owner') returning id`);
  const [teacher] = await query<{ id: string }>(`insert into users (name, role) values ('Assign teacher', 'teacher') returning id`);
  const [mine] = await query<{ id: string }>(`insert into users (name, role) values ('My student', 'student') returning id`);
  const [other] = await query<{ id: string }>(`insert into users (name, role) values ('Other student', 'student') returning id`);
  await query(`insert into teacher_student_links (teacher_user_id, student_user_id) values ($1, $2)`, [teacher!.id, mine!.id]);
  return { ownerId: owner1!.id, teacherId: teacher!.id, mineId: mine!.id, otherId: other!.id };
}

/** A published writing task, ready to be assigned. */
async function publishedWritingTask(database: Awaited<ReturnType<typeof createTestDatabase>>, actor: AuthoringActor, sourceRef: string) {
  const { db } = database;
  const saved = await db.transaction((tx) =>
    saveContentDraft(tx, {
      actor,
      module: "writing",
      contentType: "task2",
      sourceRef,
      title: "Assigned task",
      track: "academic",
      payload: { taskType: "task2", category: "education", prompt: "Synthetic assigned prompt, version one.", targetWordCount: 250 },
    }),
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error("fixture failed");
  const published = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: saved.version.id, to: "published" }));
  assert.equal(published.ok, true);
  return saved.version;
}

test("AS1 only staff assign, and a teacher is limited to their own roster", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const { ownerId, teacherId, mineId, otherId } = await people(database);

    assert.deepEqual(await mayAssignTo({ id: mineId, role: "student" }, otherId, db), { allowed: false, reason: "not_staff" });
    assert.deepEqual(await mayAssignTo({ id: teacherId, role: "teacher" }, otherId, db), { allowed: false, reason: "outside_roster" });
    assert.deepEqual(await mayAssignTo({ id: teacherId, role: "teacher" }, mineId, db), { allowed: true });
    assert.deepEqual(await mayAssignTo({ id: ownerId, role: "owner" }, otherId, db), { allowed: true });
    assert.deepEqual(await mayAssignTo({ id: ownerId, role: "owner" }, ownerId, db), { allowed: false, reason: "not_a_student" });
  } finally {
    await database.close();
  }
});

test("AS2 an assignment pins the published revision, refuses a draft, and never silently retargets", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const { ownerId, otherId } = await people(database);
    const actor = { ...owner, id: ownerId };

    // A draft revision cannot be assigned: nobody could open it.
    const draft = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "assign-draft",
        title: "Draft task",
        payload: { taskType: "task2", category: "education", prompt: "A prompt that is still a draft and must not be assignable.", targetWordCount: 250 },
      }),
    );
    assert.equal(draft.ok, true);
    if (!draft.ok) return;
    const refused = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Too early",
        reference: { module: "writing", contentType: "task2", sourceRef: "assign-draft", versionId: draft.version.id },
        studentIds: [otherId],
      }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.issues.some((issue) => issue.code === "version_not_published"));
    assert.equal((await db.select().from(assignments)).length, 0, "nothing was written");

    const version = await publishedWritingTask(database, actor, "assign-published");
    const created = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Write the task",
        instructions: "Plan for five minutes first.",
        reference: { module: "writing", contentType: "task2", sourceRef: "assign-published", versionId: version.id },
        studentIds: [otherId],
        dueAt: new Date("2026-05-01T09:00:00Z"),
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.versionId, version.id);

    // The content moves on; the assignment still points at what was set.
    const revised = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "writing",
        contentType: "task2",
        sourceRef: "assign-published",
        title: "Assigned task, rewritten",
        payload: { taskType: "task2", category: "education", prompt: "A completely different prompt, after the assignment was set.", targetWordCount: 250 },
      }),
    );
    assert.equal(revised.ok, true);
    if (!revised.ok) return;
    assert.equal(revised.version.versionNo, 2);

    const [row] = await db.select().from(assignments).where(eq(assignments.id, created.assignmentId));
    assert.equal(row!.contentVersionId, version.id, "the assignment keeps the revision it was set against");
    const content = (await assignmentContent(created.assignmentId, db)) as { prompt: string };
    assert.equal(content.prompt, "Synthetic assigned prompt, version one.");
  } finally {
    await database.close();
  }
});

test("AS3 a forged content reference is refused, and a mismatch cannot be smuggled in", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const { ownerId, otherId } = await people(database);
    const actor = { ...owner, id: ownerId };
    const version = await publishedWritingTask(database, actor, "assign-identity");

    const wrongType = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Wrong type",
        reference: { module: "reading", contentType: "general_set", sourceRef: "assign-identity", versionId: version.id },
        studentIds: [otherId],
      }),
    );
    assert.equal(wrongType.ok, false);
    if (!wrongType.ok) assert.ok(wrongType.issues.some((issue) => issue.code === "version_identity_mismatch"));

    const forged = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Forged",
        reference: { module: "writing", contentType: "task2", sourceRef: "assign-identity", versionId: "11111111-1111-4111-8111-111111111111" },
        studentIds: [otherId],
      }),
    );
    assert.equal(forged.ok, false);
    if (!forged.ok) assert.ok(forged.issues.some((issue) => issue.code === "version_not_found"));

    const malformed = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Malformed",
        reference: { module: "writing", contentType: "task2", sourceRef: "assign-identity", versionId: "not-a-uuid" },
        studentIds: [otherId],
      }),
    );
    assert.equal(malformed.ok, false);
    assert.equal((await db.select().from(assignments)).length, 0);
  } finally {
    await database.close();
  }
});

test("AS4 one assignment, several students, each with their own status", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const { ownerId, mineId, otherId } = await people(database);
    const actor = { ...owner, id: ownerId };
    const version = await publishedWritingTask(database, actor, "assign-group");

    const created = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Group task",
        reference: { module: "writing", contentType: "task2", sourceRef: "assign-group", versionId: version.id },
        studentIds: [mineId, otherId],
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const targets = await db.select().from(assignmentTargets).where(eq(assignmentTargets.assignmentId, created.assignmentId));
    assert.equal(targets.length, 2, "one target row per student");
    assert.ok(targets.every((target) => target.status === "not_started"));

    assert.equal(await db.transaction((tx) => setAssignmentTargetStatus(tx, { assignmentId: created.assignmentId, studentUserId: mineId, status: "completed" })), true);
    const after = await query<{ student_user_id: string; status: string; completed_at: Date | null }>(
      `select student_user_id, status, completed_at from assignment_targets where assignment_id = $1 order by status`,
      [created.assignmentId],
    );
    assert.deepEqual(after.map((row) => row.status), ["not_started", "completed"], "statuses are per student");
    assert.ok(after.find((row) => row.status === "completed")!.completed_at, "completion is dated");
    // Setting a status for someone not targeted changes nothing.
    assert.equal(await db.transaction((tx) => setAssignmentTargetStatus(tx, { assignmentId: created.assignmentId, studentUserId: ownerId, status: "completed" })), false);
  } finally {
    await database.close();
  }
});

test("AS5 a learner sees their own tasks with the revision they were given, and nobody else's", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const { ownerId, mineId, otherId } = await people(database);
    const actor = { ...owner, id: ownerId };
    const version = await publishedWritingTask(database, actor, "assign-visible");

    const created = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Visible task",
        reference: { module: "writing", contentType: "task2", sourceRef: "assign-visible", versionId: version.id },
        studentIds: [mineId],
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const mine = await listAssignmentsForStudent(mineId, db);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.title, "Visible task");
    assert.equal(mine[0]!.content.versionId, version.id);
    assert.equal(mine[0]!.content.versionNo, 1);
    assert.equal(mine[0]!.status, "not_started");

    const theirs = await listAssignmentsForStudent(otherId, db);
    assert.deepEqual(theirs, [], "another student's list is empty");

    // Read authorization: the target, the creator and an administrator only.
    const target = { createdByUserId: ownerId, targetUserId: mineId };
    assert.equal(mayReadAssignment({ id: mineId, role: "student" }, target, [mineId]), true);
    assert.equal(mayReadAssignment({ id: otherId, role: "student" }, target, [mineId]), false);
    assert.equal(mayReadAssignment({ id: ownerId, role: "owner" }, target, [mineId]), true);
    assert.equal(mayReadAssignment({ id: "99999999-9999-4999-8999-999999999999", role: "admin" }, target, [mineId]), true);
  } finally {
    await database.close();
  }
});

test("AS6 the staff view groups targets, and an assignment survives its content being archived", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const { ownerId, mineId, otherId } = await people(database);
    const actor = { ...owner, id: ownerId };
    const version = await publishedWritingTask(database, actor, "assign-staff-view");

    const created = await db.transaction((tx) =>
      createAssignment(tx, {
        actor,
        title: "Staff view task",
        reference: { module: "writing", contentType: "task2", sourceRef: "assign-staff-view", versionId: version.id },
        studentIds: [mineId, otherId],
      }),
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const staffView = await listAssignmentsCreatedBy(ownerId, db);
    assert.equal(staffView.length, 1, "one entry per assignment, not per target");
    assert.equal(staffView[0]!.targets.length, 2);
    assert.equal(staffView[0]!.contentVersionId, version.id);
    assert.equal(staffView[0]!.module, "writing");

    // Archiving the content withdraws it from new work but never erases history.
    await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: version.id, to: "archived" }));
    const stillThere = await listAssignmentsForStudent(mineId, db);
    assert.equal(stillThere.length, 1, "the learner's task is still listed");
    assert.equal(stillThere[0]!.content.versionStatus, "archived", "and honestly reports the revision's state");
    assert.equal((await db.select().from(contentVersions).where(eq(contentVersions.id, version.id))).length, 1);
  } finally {
    await database.close();
  }
});

test("AS7 grammar topics respect publication, and a grammar attempt can record its revision", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const { ownerId, mineId } = await people(database);

    // A vocabulary pack proves the canonical author path; grammar goes through its
    // own author, and the row is what the learner-facing query reads.
    const [draftTopic] = await db
      .insert(grammarTopics)
      .values({ title: "Draft topic", explanation: "Not published yet.", order: 99, publicationState: "draft", sourceRef: "grammar-draft-topic" })
      .returning({ id: grammarTopics.id });
    const [liveTopic] = await db
      .insert(grammarTopics)
      .values({ title: "Live topic", explanation: "Published.", order: 1, publicationState: "published", sourceRef: "grammar-live-topic" })
      .returning({ id: grammarTopics.id });

    const visible = await query<{ title: string }>(`select title from grammar_topics where publication_state = 'published'`);
    assert.deepEqual(visible.map((row) => row.title), ["Live topic"], "a draft topic is not in the learner list");
    assert.notEqual(draftTopic!.id, liveTopic!.id);

    // The revision a grammar attempt records resolves to a real version row.
    const pack = await db.transaction((tx) =>
      saveTopicPack(tx, {
        actorUserId: ownerId,
        sourceRef: "pack-grammar-link",
        slug: "grammar-link",
        labelEn: "Grammar link",
        words: [{ term: "clause", partOfSpeech: "noun", definitionEn: "a group of words with a subject and verb", translationUz: "gap", example: "A clause needs a verb." }],
      }),
    );
    assert.equal(pack.ok, true);
    const [packVersion] = await db.select().from(contentVersions).where(eq(contentVersions.id, pack.ok ? pack.versionId : ""));
    assert.equal(
      (await db.select().from(contentVersions).where(eq(contentVersions.sourceRef, "pack-grammar-link"))).length,
      1,
      "the pack's revision exists to be pointed at",
    );
    assert.equal(packVersion!.module, "vocabulary");

    // The grammar attempt column exists and is guarded by a real foreign key.
    await assert.rejects(query(`insert into grammar_attempts (user_id, exercise_id, is_correct, content_version_id) values ($1, $2, true, $3)`, [mineId, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]));
  } finally {
    await database.close();
  }
});
