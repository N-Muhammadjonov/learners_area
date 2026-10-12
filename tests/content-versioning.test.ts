import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { contentVersions, listeningAttempts, listeningTests, users } from "../src/db/schema";
import {
  answerKeyHashOf,
  bindAttempt,
  classifyChange,
  contentHashOf,
  latestVersion,
  parseVersionIdentity,
  pinVersion,
  publishedVersion,
  semanticHashOf,
  versionById,
  versionIdentity,
  versionStatusForPublication,
} from "../src/lib/content/versions";
import {
  bandFor,
  bandForScaled,
  overallBandFromCriteria,
  overallMockBand,
  readingPolicyFor,
  roundToHalfBand,
  SCORE_POLICIES,
  scorePolicy,
  sectionSecondsFor,
  mockTimingPolicy,
} from "../src/lib/content/score-policy";
import { createTestDatabase } from "./support/pglite";

/**
 * Version binding + score policy (Master Prompt 2 §13, §21, §22, §42, §71, §72).
 *
 * The questions this suite answers, in the same order the risk appears:
 *   • when does an edit deserve a NEW version?
 *   • can a published item be edited in place?
 *   • does a historical attempt keep the revision it started with?
 *   • is a band always traceable to the policy that produced it?
 */

const CONTENT = (marker: string, key = "answer") => ({
  questions: [{ number: 1, section: 1, text: `Q1 ${marker}`, instruction: "Write ONE WORD.", options: [], key, alternatives: [], pair: [], evidence: { at: 10, why: "w" } }],
  sections: [{ number: 1, title: "Part 1", transcript: `transcript ${marker}` }],
  audio: { durationSec: 600, assetKey: "audio.full" },
});

test("CV1 a metadata-only edit keeps the version; a semantic edit earns a new one", () => {
  const previous = {
    semanticHash: semanticHashOf("listening", "full_test", CONTENT("same")),
    contentHash: contentHashOf("listening", "full_test", CONTENT("same")),
    answerKeyHash: answerKeyHashOf(CONTENT("same")),
    status: "published" as const,
  };

  const identical = classifyChange({ module: "listening", contentType: "full_test", previous, content: CONTENT("same") });
  assert.equal(identical.kind, "metadata");
  assert.equal(identical.requiresNewVersion, false);

  // A different provenance note is not part of the semantic projection.
  const annotated = classifyChange({ module: "listening", contentType: "full_test", previous, content: { ...CONTENT("same"), note: "added later" } });
  assert.equal(annotated.requiresNewVersion, false, "notes are not assessment semantics");

  const reworded = classifyChange({ module: "listening", contentType: "full_test", previous, content: { ...CONTENT("same"), questions: [{ ...CONTENT("same").questions[0]!, text: "Q1 changed wording" }] } });
  assert.equal(reworded.kind, "semantic");
  assert.equal(reworded.requiresNewVersion, true);

  const reKeyed = classifyChange({ module: "listening", contentType: "full_test", previous, content: CONTENT("same", "different answer") });
  assert.equal(reKeyed.kind, "answer_key", "an answer-key change is named as such, not as generic drift");
  assert.equal(reKeyed.requiresNewVersion, true);
  assert.match(reKeyed.reasons.join(" "), /regrading/);

  const first = classifyChange({ module: "listening", contentType: "full_test", previous: null, content: CONTENT("same") });
  assert.equal(first.kind, "created");
  assert.equal(first.requiresNewVersion, true);

  // Hashes are stable and module-scoped.
  assert.equal(semanticHashOf("listening", "full_test", CONTENT("same")), semanticHashOf("listening", "full_test", JSON.parse(JSON.stringify(CONTENT("same")))));
  assert.notEqual(semanticHashOf("reading", "general_set", CONTENT("same")), semanticHashOf("listening", "full_test", CONTENT("same")));
  assert.equal(versionIdentity({ module: "reading", contentType: "general_set", sourceRef: "reading-105", versionNo: 3 }), "reading:general_set:reading-105@v3");
  assert.deepEqual(parseVersionIdentity("reading:general_set:reading-105@v3"), { module: "reading", contentType: "general_set", sourceRef: "reading-105", versionNo: 3 });
  assert.equal(parseVersionIdentity("garbage"), null);
  assert.equal(versionStatusForPublication("published"), "published");
  assert.equal(versionStatusForPublication("scheduled"), "published");
  assert.equal(versionStatusForPublication("archived"), "archived");
  assert.equal(versionStatusForPublication("draft"), "draft");
});

test("CV2 pinning is transactional: a new version supersedes the published one, and a metadata edit touches nothing else", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const pin = (input: Parameters<typeof pinVersion>[1]) => db.transaction((tx) => pinVersion(tx, input));
    const base = {
      module: "listening",
      contentType: "full_test",
      sourceRef: "version-qa-test",
      title: "Version QA",
      content: CONTENT("v1"),
      actorUserId: null,
      publicationState: "published" as const,
    };

    const first = await pin(base);
    assert.equal(first.created, true);
    assert.equal(first.version.versionNo, 1);
    assert.equal(first.version.status, "published");

    const again = await pin(base);
    assert.equal(again.created, false, "the same payload does not create a version a second time");
    assert.equal(again.version.id, first.version.id);

    const relabelled = await pin({ ...base, title: "Version QA (renamed)" });
    assert.equal(relabelled.created, false, "a rename is not a new revision");
    assert.equal(relabelled.version.id, first.version.id);

    const rekeyed = await pin({ ...base, content: CONTENT("v1", "different answer") });
    assert.equal(rekeyed.created, true);
    assert.equal(rekeyed.version.versionNo, 2);
    assert.equal(rekeyed.change.kind, "answer_key");

    const rows = await query<{ version_no: number; status: string }>(`select version_no, status from content_versions where source_ref = 'version-qa-test' order by version_no`);
    assert.deepEqual(rows, [
      { version_no: 1, status: "superseded" },
      { version_no: 2, status: "published" },
    ], "the old revision is superseded, never deleted");

    const published = await publishedVersion("listening", "full_test", "version-qa-test", db);
    assert.equal(published?.versionNo, 2);
    assert.equal((await latestVersion("listening", "full_test", "version-qa-test", db))?.versionNo, 2);
    assert.equal((await versionById(first.version.id, db))?.status, "superseded");
  } finally {
    await database.close();
  }
});

test("CV3 an attempt stays bound to the revision it started with, even after the answer key changes", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Version QA owner', 'owner') returning id`);
    const [student] = await query<{ id: string }>(`insert into users (name, role) values ('Version QA student', 'student') returning id`);
    const [test] = await query<{ id: string }>(
      `insert into listening_tests (created_by_user_id, title, audio_type, publication_state) values ($1, 'Version QA test', 'audio', 'published') returning id`,
      [owner!.id],
    );

    const used = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "listening",
        contentType: "full_test",
        sourceRef: "attempt-binding-qa",
        title: "Attempt binding QA",
        content: CONTENT("original", "original answer"),
        actorUserId: owner!.id,
        publicationState: "published",
        targetType: "listening_test",
        targetId: test!.id,
      }),
    );

    const [attempt] = await query<{ id: string }>(
      `insert into listening_attempts (user_id, test_id, status, score, total_questions, content_version_id, score_policy_version)
       values ($1, $2, 'completed', 1, 1, $3, 'v1') returning id`,
      [student!.id, test!.id, used.version.id],
    );

    // The owner re-keys the test AFTER the attempt.
    const revised = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "listening",
        contentType: "full_test",
        sourceRef: "attempt-binding-qa",
        title: "Attempt binding QA",
        content: CONTENT("original", "a different answer"),
        actorUserId: owner!.id,
        publicationState: "published",
        targetType: "listening_test",
        targetId: test!.id,
      }),
    );
    assert.equal(revised.version.versionNo, 2);

    const [row] = await query<{ content_version_id: string; score_policy_version: string }>(
      `select content_version_id, score_policy_version from listening_attempts where id = $1`,
      [attempt!.id],
    );
    assert.equal(row!.content_version_id, used.version.id, "the attempt still points at the revision it answered");
    assert.notEqual(row!.content_version_id, revised.version.id);
    assert.equal(row!.score_policy_version, "v1", "the band stays traceable to its conversion policy");

    // The signature only accepts tables that actually carry the binding column, so
    // "bound the attempt to the wrong table" is a compile error, not a silent no-op.
    const rebound = await db.transaction((tx) => bindAttempt(tx, listeningAttempts, attempt!.id, revised.version.id));
    assert.deepEqual(rebound, { ok: true }, "an explicit rebind is allowed for the owner who asks for it");
    const [moved] = await query<{ content_version_id: string }>(`select content_version_id from listening_attempts where id = $1`, [attempt!.id]);
    assert.equal(moved!.content_version_id, revised.version.id);
    await db.transaction((tx) => bindAttempt(tx, listeningAttempts, attempt!.id, used.version.id));

    const forged = await db.transaction((tx) => bindAttempt(tx, listeningAttempts, attempt!.id, crypto.randomUUID()));
    assert.deepEqual(forged, { ok: false, reason: "version_not_found" }, "a forged version id is refused, never written");
    const [afterForged] = await query<{ content_version_id: string }>(`select content_version_id from listening_attempts where id = $1`, [attempt!.id]);
    assert.equal(afterForged!.content_version_id, used.version.id, "a refused bind leaves the attempt where it was");
    const malformed = await db.transaction((tx) => bindAttempt(tx, listeningAttempts, attempt!.id, "not-a-uuid"));
    assert.deepEqual(malformed, { ok: false, reason: "invalid_version_id" });
    const [stillBound] = await query<{ content_version_id: string }>(`select content_version_id from listening_attempts where id = $1`, [attempt!.id]);
    assert.equal(stillBound!.content_version_id, used.version.id);

    // Deleting a version must not delete the attempt.
    await query(`delete from content_versions where id = $1`, [used.version.id]);
    const [survivor] = await query<{ id: string; content_version_id: string | null }>(`select id, content_version_id from listening_attempts where id = $1`, [attempt!.id]);
    assert.equal(survivor!.id, attempt!.id);
    assert.equal(survivor!.content_version_id, null, "the binding degrades to unknown, never to a lost attempt");
  } finally {
    await database.close();
  }
});

test("CV4 a version row records what changed, who changed it and against which import", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const [owner] = await query<{ id: string }>(`insert into users (name, role) values ('Provenance QA', 'owner') returning id`);
    const [record] = await query<{ id: string }>(
      `insert into content_imports (module, content_type, schema_version, import_version, source_ref, content_hash, content_version, status, target_type, legacy_runtime)
       values ('reading', 'general_set', 1, 1, 'provenance-qa', $1, 1, 'created', 'general_reading_set', false) returning id`,
      ["d".repeat(64)],
    );
    const written = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "reading",
        contentType: "general_set",
        sourceRef: "provenance-qa",
        title: "Provenance QA set",
        track: "academic",
        content: { passages: [{ passageNo: 1, title: "P", body: "B", questions: [] }] },
        publicationState: "draft",
        actorUserId: owner!.id,
        contentImportId: record!.id,
        provenance: { source: "ai_authoring", note: "generated draft" },
        note: "first import",
      }),
    );
    const [row] = await db
      .select()
      .from(contentVersions)
      .where(eq(contentVersions.id, written.version.id));
    assert.equal(row!.changeKind, "created");
    assert.equal(row!.track, "academic");
    assert.equal(row!.contentImportId, record!.id);
    assert.equal(row!.createdByUserId, owner!.id);
    assert.equal(row!.status, "draft");
    assert.equal(row!.publishedAt, null);
    assert.equal((row!.provenance as { source?: string })?.source, "ai_authoring");
    assert.equal(row!.note, "first import");
    assert.match(row!.contentHash, /^[0-9a-f]{64}$/);
    assert.match(row!.semanticHash, /^[0-9a-f]{64}$/);
    assert.notEqual(row!.contentHash, row!.semanticHash, "the two hashes answer different questions");

    // A draft that changes keeps a single version row per revision, numbered up.
    const second = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "reading",
        contentType: "general_set",
        sourceRef: "provenance-qa",
        title: "Provenance QA set",
        track: "academic",
        content: { passages: [{ passageNo: 1, title: "P", body: "B changed", questions: [] }] },
        publicationState: "draft",
        actorUserId: owner!.id,
      }),
    );
    assert.equal(second.version.versionNo, 2);
    const statuses = await query<{ version_no: number; status: string }>(`select version_no, status from content_versions where source_ref = 'provenance-qa' order by version_no`);
    assert.deepEqual(statuses, [{ version_no: 1, status: "draft" }, { version_no: 2, status: "draft" }], "only a published revision gets superseded");
  } finally {
    await database.close();
  }
});

test("CV5 the reading attempt table carries the binding column the version store writes", async () => {
  const database = await createTestDatabase();
  try {
    const { query } = database;
    const columns = await query<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
        where table_schema = 'public' and table_name in ('reading_attempts','listening_attempts','writing_submissions','speaking_attempts','mock_attempts')
          and column_name in ('content_version_id','score_policy_version') order by table_name, column_name`,
    );
    const pairs = columns.map((row) => `${row.column_name}:${row.is_nullable === "YES" ? "nullable" : "required"}`);
    assert.deepEqual(pairs.slice().sort(), [
      "content_version_id:nullable",
      "content_version_id:nullable",
      "content_version_id:nullable",
      "content_version_id:nullable",
      "score_policy_version:nullable",
      "score_policy_version:nullable",
      "score_policy_version:nullable",
    ], "every assessment attempt can record what it was graded against");
  } finally {
    await database.close();
  }
});

test("CV6 every band boundary maps to exactly one band, and out-of-range counts are refused", () => {
  for (const policy of Object.values(SCORE_POLICIES)) {
    const seen = new Set<number>();
    for (let raw = 0; raw <= policy.total; raw++) {
      const result = bandFor(policy, raw);
      assert.ok(result, `${policy.id}: raw ${raw} must have a band`);
      assert.equal(result!.policyId, policy.id);
      assert.equal(result!.policyVersion, policy.version);
      assert.ok(result!.band >= 0 && result!.band <= 9, `${policy.id}: band ${result!.band} in range`);
      assert.equal(seen.has(result!.band) && false, false);
    }
    // No gap, no overlap: the ranges tile 0..total exactly.
    const ranges = [...policy.bands].sort((a, b) => a.min - b.min);
    assert.equal(ranges[0]!.min, 0, `${policy.id}: the lowest range starts at 0`);
    assert.equal(ranges.at(-1)!.max, policy.total, `${policy.id}: the highest range ends at ${policy.total}`);
    for (let index = 1; index < ranges.length; index++)
      assert.equal(ranges[index]!.min, ranges[index - 1]!.max + 1, `${policy.id}: ranges must tile without a gap`);
    // Outside the policy's own range: refused, never clamped into a plausible number.
    assert.equal(bandFor(policy, -1), null);
    assert.equal(bandFor(policy, policy.total + 1), null);
    assert.equal(bandFor(policy, 20.5), null, "a fractional raw score is a bug, not a band");
    assert.equal(bandFor(policy, 40, { total: 39 }), null, "a count from a different test shape is refused");
  }

  // Boundary values, stated explicitly, because these are the ones that ship.
  assert.equal(bandFor(scorePolicy("listening"), 39)?.band, 9);
  assert.equal(bandFor(scorePolicy("listening"), 38)?.band, 8.5);
  assert.equal(bandFor(scorePolicy("listening"), 30)?.band, 7);
  assert.equal(bandFor(scorePolicy("listening"), 23)?.band, 6);
  assert.equal(bandFor(scorePolicy("listening"), 0)?.band, 0);
  assert.equal(bandFor(scorePolicy("reading_academic"), 33)?.band, 7.5);
  assert.equal(bandFor(scorePolicy("reading_general_training"), 40)?.band, 9);
  assert.equal(readingPolicyFor("academic").id, "reading_academic");
  assert.equal(readingPolicyFor("general_training").id, "reading_general_training");
  assert.equal(readingPolicyFor(null).id, "reading_academic", "an unspecified track converts by the academic table and says so");
  assert.equal(bandForScaled(scorePolicy("listening"), 10, 10)?.band, 9, "a short practice set scales to the policy");
  assert.equal(bandForScaled(scorePolicy("listening"), 11, 10), null);
});

test("CV7 criterion evaluations and mock sections aggregate by explicit rules, never by guesswork", () => {
  assert.equal(roundToHalfBand(6.25), 6.5);
  assert.equal(roundToHalfBand(6.1), 6);
  assert.equal(roundToHalfBand(6.75), 7);
  assert.equal(roundToHalfBand(9.4), 9, "no band above 9 exists");
  assert.equal(overallBandFromCriteria([7, 7, 6.5, 6]), 6.5, "mean 6.625 rounds to the nearest half band");
  assert.equal(overallBandFromCriteria([6, 6, null, 6]), null, "a missing criterion is not a zero");
  assert.equal(overallBandFromCriteria([]), null);

  assert.equal(overallMockBand([{ skill: "listening", band: 7 }, { skill: "reading", band: 6.5 }, { skill: "writing", band: 6 }, { skill: "speaking", band: 6.5 }]), 6.5);
  assert.equal(overallMockBand([{ skill: "listening", band: 7 }, { skill: "reading", band: null }]), null, "no overall band while a section is unevaluated");
  assert.equal(overallMockBand([]), null);
  // Section scores stay independently inspectable: the aggregate is derived, not stored.
  const sections = [{ skill: "listening", band: 8 }, { skill: "reading", band: 6 }];
  assert.equal(overallMockBand(sections), 7);
  assert.deepEqual(sections.map((section) => section.band), [8, 6]);

  const timing = mockTimingPolicy("ielts_full_v1");
  assert.ok(timing);
  assert.equal(timing!.serverAuthoritative, true);
  assert.equal(sectionSecondsFor(timing!, "listening"), 1800);
  assert.equal(sectionSecondsFor(timing!, "reading"), 3600);
  assert.equal(sectionSecondsFor(timing!, "speaking"), null, "speaking is not part of the timed paper");
  assert.equal(sectionSecondsFor(mockTimingPolicy("sectional_v1")!, "writing"), 3600, "a sectional mock has one timed section");
  assert.equal(mockTimingPolicy("nope"), null);
});

test("CV8 a version id is validated before it is trusted, and an unknown one resolves to nothing", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const pinned = await db.transaction((tx) =>
      pinVersion(tx, {
        module: "reading",
        contentType: "general_set",
        sourceRef: "lookup-qa",
        title: "Lookup QA",
        content: { passages: [] },
        actorUserId: null,
        publicationState: "published",
      }),
    );
    assert.equal((await versionById(pinned.version.id, db))?.sourceRef, "lookup-qa");
    assert.equal(await versionById(crypto.randomUUID(), db), null);
    assert.equal(await publishedVersion("reading", "general_set", "does-not-exist", db), null);
    assert.equal(await latestVersion("reading", "general_set", "does-not-exist", db), null);
    // A forged version id cannot be used to reference someone else's material:
    // it simply does not resolve, and every caller must treat null as "refuse".
    assert.equal(await versionById("not-a-uuid", db), null);
  } finally {
    await database.close();
  }
});
