import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { mockAttempts, mockSections, mockTests, users } from "../src/db/schema";
import {
  FORMAL_NAVIGATION,
  PRACTICE_NAVIGATION,
  assembleMockResult,
  bandForSection,
  composeTimingPlan,
  currentMockVersion,
  freezeBindings,
  loadMockComposition,
  mockIsEditable,
  mockPublicationGate,
  navigationPolicyFor,
  saveMockComposition,
  scorePolicyRefFor,
  sectionStateAt,
  startMockAttempt,
  validateMockComposition,
  type MockCompositionInput,
} from "../src/lib/content/mocks";
import { pinVersion } from "../src/lib/content/versions";
import { createTestDatabase } from "./support/pglite";

/**
 * Mock architecture (Master Prompt 2 §12–§21, §62–§65).
 *
 * The claims under test are the ones that make a mock trustworthy:
 *   • it owns no content — it references it;
 *   • it pins exact revisions, so a learner is graded against what they sat;
 *   • invalid compositions cannot be stored or published at all;
 *   • the clock and the sections come from policy data, not from a component.
 */

/** A section that satisfies the formal rules; overrides weaken it deliberately. */
function section(overrides: Record<string, unknown> = {}) {
  return {
    skill: "listening",
    module: "listening",
    contentType: "full_test",
    sourceRef: "listening-academic-1",
    contentVersionId: "11111111-1111-4111-8111-111111111111",
    questionCount: 40,
    ...overrides,
  };
}

function composition(overrides: Partial<MockCompositionInput> = {}): MockCompositionInput {
  return {
    track: "academic",
    kind: "full",
    title: "IELTS Academic Mock 1",
    timingPolicyId: "ielts_full_v1",
    sections: [
      section(),
      section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "reading-academic-1", questionCount: 40 }),
      section({ skill: "writing", module: "writing", contentType: "task1", sourceRef: "writing-acad-t1", questionCount: null }),
      section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "writing-acad-t2", questionCount: null }),
    ],
    ...overrides,
  };
}

const codes = (report: { errors: { code: string }[] }) => report.errors.map((error) => error.code);

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>["db"];
type TestQuery = Awaited<ReturnType<typeof createTestDatabase>>["query"];

/**
 * Real version rows are required: mock_sections has a foreign key to
 * content_versions, which is exactly the guarantee that a mock cannot pin a
 * revision that does not exist.
 */
async function pinFor(
  db: TestDb,
  actorUserId: string,
  { module, contentType, sourceRef, track = "academic" }: { module: string; contentType: string; sourceRef: string; track?: string },
) {
  const written = await db.transaction((tx) =>
    pinVersion(tx, {
      module,
      contentType,
      sourceRef,
      title: sourceRef,
      track,
      content: { marker: sourceRef },
      actorUserId,
      publicationState: "published",
    }),
  );
  return written.version.id;
}

test("MK1 a valid Academic full mock passes composition validation and is ordered Listening → Reading → Writing", () => {
  const report = validateMockComposition(composition());
  assert.deepEqual(report.errors, []);
  assert.equal(report.ok, true);
  assert.equal(report.totalSeconds, 1800 + 3600 + 3600 + 3600, "30 + 60 + 60 + 60 minutes of listening, reading and writing (two tasks)");
  assert.deepEqual(report.questionCounts, { listening: 40, reading: 40 });
});

test("MK2 a full mock without Listening, Reading or Writing is refused, and so is a wrong order", () => {
  assert.ok(codes(validateMockComposition(composition({ sections: [section()] }))).includes("missing_required_skill"));
  const wrongOrder = composition({
    sections: [
      section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "r1" }),
      section(),
      section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "w2" }),
    ],
  });
  assert.ok(codes(validateMockComposition(wrongOrder)).includes("wrong_section_order"));
  const sameTestTwice = composition({
    sections: [section(), section(), section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "r1" }), section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "w2" })],
  });
  assert.ok(codes(validateMockComposition(sameTestTwice)).includes("duplicate_section"));
});

test("MK3 an Academic mock cannot quietly include General Training material, and question counts must add up", () => {
  const mixed = composition({
    sections: [
      section(),
      section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "reading-gt-1", track: "general_training", questionCount: 40 }),
      section({ skill: "writing", module: "writing", contentType: "task1", sourceRef: "w", questionCount: null }),
    ],
  });
  assert.ok(codes(validateMockComposition(mixed)).includes("track_mismatch"), "General Training reading inside an Academic mock is a named error");

  const short = composition({
    sections: [
      section({ questionCount: 20 }),
      section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "r", questionCount: 20 }),
      section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "w", questionCount: null }),
    ],
  });
  assert.ok(codes(validateMockComposition(short)).includes("formal_question_count"), "a 20+20 composition is not a 40-question IELTS section");

  // General Training is fine when every section agrees.
  const general = composition({
    track: "general_training",
    title: "IELTS General Training Mock 1",
    sections: [
      section({ sourceRef: "listening-gt-1" }),
      section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "reading-gt-1", track: "general_training", questionCount: 40 }),
      section({ skill: "writing", module: "writing", contentType: "task1", sourceRef: "writing-gt-letter", track: "general_training", questionCount: null }),
      section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "writing-gt-t2", track: "general_training", questionCount: null }),
    ],
  });
  assert.deepEqual(validateMockComposition(general).errors, []);
});

test("MK4 a formal mock must pin exact versions, and a sectional/custom set may follow the latest", () => {
  const unpinned = composition({
    sections: [section({ contentVersionId: null }), section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "r", contentVersionId: null }), section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "w", contentVersionId: null })],
  });
  const report = validateMockComposition(unpinned);
  assert.equal(report.ok, false);
  assert.equal(report.errors.filter((error) => error.code === "version_required").length, 3, "every section is named");
  assert.equal(report.errors[0]?.position, 1, "the composer can point at the section that needs fixing");

  const sectional = validateMockComposition({
    track: "academic",
    kind: "sectional",
    title: "Listening mock 1",
    timingPolicyId: "sectional_v1",
    sections: [section({ contentVersionId: null })],
  });
  assert.equal(sectional.ok, true, "a sectional practice mock has no formal version requirement");

  const custom = validateMockComposition({
    track: "unspecified",
    kind: "custom",
    title: "Monday practice",
    sections: [section({ contentVersionId: null })],
  });
  assert.equal(custom.ok, true);
  assert.ok(custom.warnings.some((warning) => warning.code === "unpinned_reference"), "an unpinned practice set says so");
});

test("MK5 navigation is assessment policy: formal mocks cannot pause, practice mocks can, and contradictions are refused", () => {
  assert.deepEqual(navigationPolicyFor("full"), FORMAL_NAVIGATION);
  assert.deepEqual(navigationPolicyFor("sectional"), PRACTICE_NAVIGATION);
  assert.equal(navigationPolicyFor("full", { canPause: true }).canPause, true, "an explicit override is allowed by the model…");
  assert.ok(
    codes(validateMockComposition(composition({ navigation: { canPause: true } }))).includes("formal_cannot_pause"),
    "…and then refused for a formal mock, with the reason named",
  );
  assert.ok(
    codes(validateMockComposition(composition({ navigation: { canReturnToPreviousSection: true, sectionLocks: true } }))).includes("contradictory_navigation"),
  );
  // A practice mock may relax the formal rules without complaint.
  assert.deepEqual(
    validateMockComposition({ track: "academic", kind: "sectional", title: "Relaxed", timingPolicyId: "sectional_v1", navigation: PRACTICE_NAVIGATION, sections: [section()] }).errors,
    [],
  );
  assert.ok(codes(validateMockComposition(composition({ timingPolicyId: "nope" }))).includes("unknown_timing_policy"));
  assert.ok(codes(validateMockComposition(composition({ timingPolicyId: null }))).includes("timing_policy_required"));
});

test("MK6 the timing plan is derived, cumulative, and survives a refresh by construction", () => {
  const plan = composeTimingPlan(composition());
  assert.deepEqual(
    plan.sections.map((entry) => [entry.skill, entry.startsAtSeconds, entry.endsAtSeconds]),
    [
      ["listening", 0, 1800],
      ["reading", 1800, 5400],
      ["writing", 5400, 9000],
      ["writing", 9000, 12600],
    ],
  );
  assert.equal(plan.totalSeconds, 12600);
  // Same inputs, same plan: nothing here reads a clock, so re-rendering cannot shift it.
  assert.deepEqual(composeTimingPlan(composition()), plan);

  assert.deepEqual(sectionStateAt(plan, 0), { position: 1, remainingSeconds: 1800, expired: false });
  assert.deepEqual(sectionStateAt(plan, 1799), { position: 1, remainingSeconds: 1, expired: false });
  assert.deepEqual(sectionStateAt(plan, 1800), { position: 2, remainingSeconds: 3600, expired: false }, "the second the listening clock ends, reading begins");
  assert.equal(sectionStateAt(plan, 12600), null, "past the last section there is no active section, only a submitted paper");
  assert.equal(sectionStateAt(plan, -1), null);
});

test("MK7 a saved composition is stored by reference, bumps its version, and an invalid one is never stored", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Mock QA owner', 'owner') returning id`);
    const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('ielts-qa', 'IELTS QA') returning id`);
    const listeningVersion = await pinFor(db, owner!.id, { module: "listening", contentType: "full_test", sourceRef: "listening-academic-1" });
    const readingVersion = await pinFor(db, owner!.id, { module: "reading", contentType: "general_set", sourceRef: "reading-academic-1" });
    const writingVersion = await pinFor(db, owner!.id, { module: "writing", contentType: "task2", sourceRef: "writing-acad-t2" });

    const input = composition({
      sections: [
        section({ contentVersionId: listeningVersion }),
        section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "reading-academic-1", contentVersionId: readingVersion, questionCount: 40 }),
        section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "writing-acad-t2", contentVersionId: writingVersion, questionCount: null }),
      ],
    });

    const rejected = await db.transaction((tx) => saveMockComposition(tx, { courseId: course!.id, composition: { ...input, title: "" }, actorUserId: owner!.id }));
    assert.equal(rejected.ok, false);
    const afterReject = await query<{ count: string }>(`select count(*)::text as count from mock_tests`);
    assert.equal(afterReject[0]!.count, "0", "a refused composition leaves no partial mock behind");

    const saved = await db.transaction((tx) => saveMockComposition(tx, { courseId: course!.id, composition: input, actorUserId: owner!.id }));
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.version, 1);

    const loaded = await loadMockComposition(saved.mockId, db);
    assert.ok(loaded);
    assert.equal(loaded!.mock.track, "academic");
    assert.equal(loaded!.mock.kind, "full");
    assert.equal(loaded!.sections.length, 3);
    assert.deepEqual(
      loaded!.sections.map((entry) => [entry.skill, entry.sourceRef]),
      [["listening", "listening-academic-1"], ["reading", "reading-academic-1"], ["writing", "writing-acad-t2"]],
      "sections are references in order, and no content was copied",
    );
    assert.equal(loaded!.mock.scorePolicies?.reading, `reading_academic@v1`);
    assert.equal(loaded!.mock.scorePolicies?.listening, "listening@v1");
    assert.equal(loaded!.mock.navigation?.canPause, false, "a formal mock records its navigation policy");

    // Re-composing bumps the version instead of mutating history.
    const recomposed = await db.transaction((tx) =>
      saveMockComposition(tx, { courseId: course!.id, mockId: saved.mockId, composition: input, actorUserId: owner!.id }),
    );
    assert.equal(recomposed.ok, true);
    if (recomposed.ok) assert.equal(recomposed.version, 2);
    const rows = await query<{ version: number }>(`select version from mock_tests where id = $1`, [saved.mockId]);
    assert.equal(rows[0]!.version, 2);
    const sectionRows = await query<{ count: string }>(`select count(*)::text as count from mock_sections where mock_test_id = $1`, [saved.mockId]);
    assert.equal(sectionRows[0]!.count, "3", "replacing sections does not append duplicates");
    // One position per slot: the unique index is the guard.
    await assert.rejects(query(`insert into mock_sections (mock_test_id, position, skill, module, content_type, source_ref) values ($1, 1, 'listening', 'listening', 'full_test', 'x')`, [saved.mockId]));
  } finally {
    await database.close();
  }
});

test("MK8 publication is gated: a draft mock is not startable, an archived pinned revision blocks publishing, and a live mock is frozen", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Mock gate owner', 'owner') returning id`);
    const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('ielts-gate', 'IELTS gate') returning id`);
    const listeningVersion = await pinFor(db, owner!.id, { module: "listening", contentType: "full_test", sourceRef: "gate-listening" });
    const readingVersion = await pinFor(db, owner!.id, { module: "reading", contentType: "general_set", sourceRef: "gate-reading" });
    const writingVersion = await pinFor(db, owner!.id, { module: "writing", contentType: "task2", sourceRef: "gate-writing" });

    const saved = await db.transaction((tx) =>
      saveMockComposition(tx, {
        courseId: course!.id,
        actorUserId: owner!.id,
        composition: {
          track: "academic",
          kind: "full",
          title: "Gate mock",
          timingPolicyId: "ielts_full_v1",
          sections: [
            section({ sourceRef: "gate-listening", contentVersionId: listeningVersion }),
            section({ skill: "reading", module: "reading", contentType: "general_set", sourceRef: "gate-reading", contentVersionId: readingVersion, questionCount: 40 }),
            section({ skill: "writing", module: "writing", contentType: "task2", sourceRef: "gate-writing", contentVersionId: writingVersion, questionCount: null }),
          ],
        },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    // Draft: no version to start, and not editable-blocked either.
    assert.equal(await currentMockVersion(saved.mockId, db), null, "a draft mock cannot be started");
    assert.equal(await mockIsEditable(saved.mockId, db), true, "a draft can still be edited");

    const newerRevision = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "reading",
        contentType: "general_set",
        sourceRef: "gate-reading",
        title: "Gate reading",
        track: "academic",
        // A genuinely different revision of the same content (reading projects passages/questions).
        content: { passages: [{ passageNo: 1, body: "A newer body" }], questions: [] },
        actorUserId: owner!.id,
        publicationState: "published",
      }),
    );
    await query(`update mock_tests set publication_state = 'published' where id = $1`, [saved.mockId]);
    // The mock still pins the ORIGINAL (published) revision, so archiving a newer
    // revision elsewhere does not break it.
    const gate = await mockPublicationGate(saved.mockId, db);
    assert.equal(gate.canPublish, true, "the pinned revision is still readable and was not archived");

    // Archive the pinned revision itself and publication is refused with the reason.
    await query(`update content_versions set status = 'archived' where id = $1`, [readingVersion]);
    const blocked = await mockPublicationGate(saved.mockId, db);
    assert.equal(blocked.canPublish, false);
    assert.ok(blocked.reasons.some((reason) => reason.code === "version_archived"));
    assert.equal(await currentMockVersion(saved.mockId, db), 1, "a published mock exposes the composition version it was saved as");
    assert.equal(await mockIsEditable(saved.mockId, db), false, "a live mock is frozen while it is published");
    assert.notEqual(newerRevision.version.id, readingVersion, "the newer revision is a different revision");
    const [binding] = await query<{ content_version_id: string }>(
      `select content_version_id from mock_sections where mock_test_id = $1 and position = 2`,
      [saved.mockId],
    );
    assert.equal(binding!.content_version_id, readingVersion, "the mock still pins the revision it was composed with");
  } finally {
    await database.close();
  }
});

test("MK9 a mock attempt keeps the composition version and the per-section bindings it started with", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Mock binding owner', 'owner') returning id`);
    const [student] = await query<{ id: string }>(`insert into users (name, role) values ('Mock binding student', 'student') returning id`);
    const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('ielts-bind', 'IELTS bind') returning id`);
    const referenceId = await pinFor(db, owner!.id, { module: "listening", contentType: "full_test", sourceRef: "bind-listening" });
    const reference = { version: { id: referenceId } };
    const saved = await db.transaction((tx) =>
      saveMockComposition(tx, {
        courseId: course!.id,
        actorUserId: owner!.id,
        composition: {
          track: "academic",
          kind: "sectional",
          title: "Sectional listening",
          timingPolicyId: "sectional_v1",
          sections: [section({ sourceRef: "bind-listening", contentVersionId: reference.version.id })],
        },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const loaded = await loadMockComposition(saved.mockId, db);
    const bindings = freezeBindings(loaded!.sections);
    const [attempt] = await query<{ id: string }>(
      `insert into mock_attempts (user_id, mock_test_id, mock_version, status, started_at, content_version_bindings)
       values ($1, $2, $3, 'in_progress', now(), $4::jsonb) returning id`,
      [student!.id, saved.mockId, saved.version, JSON.stringify(bindings)],
    );
    assert.deepEqual(bindings, { "1": reference.version.id });

    // The owner re-composes the mock afterwards.
    const recomposed = await db.transaction((tx) =>
      saveMockComposition(tx, {
        courseId: course!.id,
        mockId: saved.mockId,
        actorUserId: owner!.id,
        composition: {
          track: "academic",
          kind: "sectional",
          title: "Sectional listening",
          timingPolicyId: "sectional_v1",
          sections: [section({ sourceRef: "bind-listening", contentVersionId: reference.version.id, questionCount: 30 })],
        },
      }),
    );
    assert.equal(recomposed.ok, true);

    const [row] = await query<{ mock_version: number; content_version_bindings: Record<string, string> }>(
      `select mock_version, content_version_bindings from mock_attempts where id = $1`,
      [attempt!.id],
    );
    assert.equal(row!.mock_version, 1, "the attempt records the composition version it started");
    assert.deepEqual(row!.content_version_bindings, { "1": reference.version.id }, "the bindings are frozen with the attempt");
    const [mockRow] = await query<{ version: number }>(`select version from mock_tests where id = $1`, [saved.mockId]);
    assert.equal(mockRow!.version, 2, "the composition moved on without touching the attempt");
  } finally {
    await database.close();
  }
});

test("MK10 section bands stay inspectable and the overall appears only when every section has one", () => {
  assert.equal(bandForSection("listening", 30, 40, "academic"), 7);
  assert.equal(bandForSection("reading", 33, 40, "academic"), 7.5);
  assert.equal(bandForSection("reading", 40, 40, "general_training"), 9);
  assert.equal(bandForSection("writing", 5, 10, "academic"), null, "Writing is criterion-evaluated, never converted from a raw count");
  assert.equal(bandForSection("listening", 8, 10, "academic"), 7.5, "8/10 scales to 32/40, which is band 7.5");
  assert.equal(bandForSection("listening", null, 40, "academic"), null);

  const partial = assembleMockResult(
    [
      { skill: "listening", sourceRef: "l1", raw: 30, total: 40, band: 7, contentVersionId: null, attemptId: null },
      { skill: "reading", sourceRef: "r1", raw: 23, total: 40, band: 6, contentVersionId: null, attemptId: null },
      { skill: "writing", sourceRef: "w1", raw: null, total: null, band: 6.5, contentVersionId: null, attemptId: null },
    ],
    "academic",
  );
  assert.equal(partial.sections.length, 3, "every section remains in the result, evaluated or not");
  assert.deepEqual(partial.sections.map((entry) => entry.band), [7, 6, 6.5]);
  assert.equal(partial.overallBand, 6.5, "mean of 7, 6, 6.5 rounds to the nearest half band");
  assert.equal(partial.rawScore, null, "no fabricated raw total when a section has no raw score");

  const incomplete = assembleMockResult(
    [
      { skill: "listening", sourceRef: "l1", raw: 30, total: 40, band: 7, contentVersionId: null, attemptId: null },
      { skill: "reading", sourceRef: "r1", raw: 23, total: 40, band: null, contentVersionId: null, attemptId: null },
    ],
    "academic",
  );
  assert.equal(incomplete.overallBand, null, "no overall band while a section is unevaluated — never a fake number");
  assert.equal(incomplete.sections[0]!.band, 7, "the section that IS evaluated still reports its band");
});

test("MK11 the score policy reference a mock records names both the policy and its version", () => {
  assert.equal(scorePolicyRefFor("reading", "academic"), "reading_academic@v1");
  assert.equal(scorePolicyRefFor("reading", "general_training"), "reading_general_training@v1");
  assert.equal(scorePolicyRefFor("listening", "academic"), "listening@v1");
  assert.equal(scorePolicyRefFor("writing", "academic"), "writing@criterion-v1");
});

test("MK12 deleted mock content cannot strand an attempt: sections cascade, attempts keep their own record", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Mock cascade owner', 'owner') returning id`);
    const [student] = await query<{ id: string }>(`insert into users (name, role) values ('Mock cascade student', 'student') returning id`);
    const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('ielts-cascade', 'IELTS cascade') returning id`);
    const saved = await db.transaction((tx) =>
      saveMockComposition(tx, {
        courseId: course!.id,
        actorUserId: owner!.id,
        composition: {
          track: "academic",
          kind: "sectional",
          title: "Cascade mock",
          timingPolicyId: "sectional_v1",
          sections: [section({ contentVersionId: null })],
        },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    await query(`insert into mock_attempts (user_id, mock_test_id, mock_version, status, section_results) values ($1, $2, 1, 'submitted', $3::jsonb)`, [
      student!.id,
      saved.mockId,
      JSON.stringify([{ skill: "listening", sourceRef: "listening-academic-1", raw: 30, total: 40, band: 7, contentVersionId: null, attemptId: null }]),
    ]);

    // Deleting the mock removes its sections (they are meaningless alone)…
    await query(`delete from mock_tests where id = $1`, [saved.mockId]);
    const sectionsLeft = await query<{ count: string }>(`select count(*)::text as count from mock_sections`);
    assert.equal(sectionsLeft[0]!.count, "0");
    const attemptsLeft = await query<{ count: string }>(`select count(*)::text as count from mock_attempts`);
    assert.equal(attemptsLeft[0]!.count, "1", "…but the learner's recorded result survives independently");
    const rows = await db.select().from(mockAttempts).where(eq(mockAttempts.status, "submitted"));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.sectionResults?.[0]?.band, 7);
    assert.equal(rows[0]!.mockVersion, 1);
    assert.equal((await db.select().from(mockSections).where(eq(mockSections.mockTestId, saved.mockId))).length, 0);
    assert.equal((await db.select().from(mockTests).where(eq(mockTests.id, saved.mockId))).length, 0);
    assert.equal((await db.select().from(users).where(eq(users.id, owner!.id))).length, 1);
  } finally {
    await database.close();
  }
});

test("MK13 starting an attempt copies the published version, the section revisions and a readable snapshot", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Start owner', 'owner') returning id`);
    const [student] = await query<{ id: string }>(`insert into users (name, role) values ('Start student', 'student') returning id`);
    const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('ielts-start', 'IELTS start') returning id`);
    const listeningVersion = await pinFor(db, owner!.id, { module: "listening", contentType: "full_test", sourceRef: "start-listening" });
    const saved = await db.transaction((tx) =>
      saveMockComposition(tx, {
        courseId: course!.id,
        actorUserId: owner!.id,
        composition: {
          track: "academic",
          kind: "sectional",
          title: "Startable sectional",
          timingPolicyId: "sectional_v1",
          sections: [section({ sourceRef: "start-listening", contentVersionId: listeningVersion })],
        },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    // Not published → not startable, and nothing is written.
    assert.deepEqual(await db.transaction((tx) => startMockAttempt(tx, { mockId: saved.mockId, userId: student!.id })), {
      ok: false,
      reason: "mock_not_published",
    });
    assert.equal((await query<{ count: string }>(`select count(*)::text as count from mock_attempts`))[0]!.count, "0");

    const startedAt = new Date("2026-04-01T09:00:00Z");
    await query(`update mock_tests set publication_state = 'published' where id = $1`, [saved.mockId]);
    const started = await db.transaction((tx) => startMockAttempt(tx, { mockId: saved.mockId, userId: student!.id, now: startedAt }));
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.mockVersion, 1);
    assert.deepEqual(started.bindings, { "1": listeningVersion });

    // Re-composing after the fact must not rewrite what the learner started.
    await query(`update mock_tests set publication_state = 'draft' where id = $1`, [saved.mockId]);
    const recomposed = await db.transaction((tx) =>
      saveMockComposition(tx, {
        courseId: course!.id,
        mockId: saved.mockId,
        actorUserId: owner!.id,
        composition: {
          track: "academic",
          kind: "sectional",
          title: "Startable sectional, rewritten",
          timingPolicyId: "sectional_v1",
          sections: [section({ sourceRef: "start-listening", contentVersionId: listeningVersion, label: "Now with a label" })],
        },
      }),
    );
    assert.equal(recomposed.ok, true);

    const [row] = await db.select().from(mockAttempts).where(eq(mockAttempts.id, started.attemptId));
    assert.equal(row!.mockVersion, 1, "the attempt keeps the version it started");
    assert.deepEqual(row!.contentVersionBindings, { "1": listeningVersion });
    assert.equal(row!.mockSnapshot?.title, "Startable sectional", "the snapshot is not retroactively rewritten");
    assert.equal(row!.mockSnapshot?.kind, "sectional");
    assert.equal(row!.mockSnapshot?.timingPolicyId, "sectional_v1");

    // A published composition refuses section edits outright.
    await query(`update mock_tests set publication_state = 'published' where id = $1`, [saved.mockId]);
    assert.equal(await mockIsEditable(saved.mockId, db), false);
    const refused = await db.transaction((tx) =>
      saveMockComposition(tx, {
        courseId: course!.id,
        mockId: saved.mockId,
        actorUserId: owner!.id,
        composition: { track: "academic", kind: "sectional", title: "Nope", timingPolicyId: "sectional_v1", sections: [section({ sourceRef: "start-listening", contentVersionId: listeningVersion })] },
      }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.report.errors.some((error) => error.code === "mock_published"));
    const [after] = await query<{ title: string; version: number }>(`select title, version from mock_tests where id = $1`, [saved.mockId]);
    assert.equal(after!.title, "Startable sectional, rewritten", "the refused write changed nothing");
    assert.equal(after!.version, 2);
  } finally {
    await database.close();
  }
});
