import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RETENTION_LEVELS } from "../src/lib/retention/levels";
import { decodeMeasurementDraft } from "../src/lib/retention/measurement-draft";
import { validateMeasurementStructure } from "../src/lib/retention/measurement";
import { evaluateClaim } from "../src/lib/retention/evaluator";
import { splitEvidenceUnits, unitTokens } from "../src/lib/retention/normalize";
import { buildAttemptPayload } from "../src/lib/retention/payload";
import { startOrResumeAttempt, submitAttempt } from "../src/lib/data/retention-attempts";
import { createRetentionText, listRetentionInventory } from "../src/lib/data/retention-bank";
import { importRetentionV4 } from "../scripts/retention-v4-import";
import { readRetentionV4Source, canonicalJson, sha256 } from "../scripts/retention-v4-source";
import { bodyOfWords, createTestDatabase, simpleStructure } from "./support/pglite";

test("owner V4 retains all 75 distinct source bodies, 15 per declared level, and all literal scoring alternatives", () => {
  const items = readRetentionV4Source();
  assert.equal(items.length, 75);
  assert.equal(new Set(items.map(item => item.bodyText)).size, 75);
  let phrases = 0;
  for (const level of RETENTION_LEVELS) {
    const original = readFileSync(`content/retention-v4/${level}.jsonl`, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const bucket = items.filter(item => item.level === level);
    assert.equal(bucket.length, 15);
    bucket.forEach((item, index) => {
      assert.equal(item.sourceId, `${level}-${String(index + 1).padStart(3, "0")}`);
      assert.equal(item.bodyText, original[index].bodyText);
      assert.equal(item.wordCount, original[index].declaredWordCount);
      assert.deepEqual(item.scoringStructure.claims.map(c => c.acceptedPhrases), original[index].scoringStructure.claims.map((c: { acceptedPhrases: string[] }) => c.acceptedPhrases));
      assert.ok(decodeMeasurementDraft(JSON.stringify(item.scoringStructure)), `${item.sourceId}: editable without truncation`);
      assert.equal(item.structureSha256, sha256(canonicalJson(item.scoringStructure)));
      phrases += item.scoringStructure.claims.reduce((sum, claim) => sum + claim.acceptedPhrases.length, 0);
    });
  }
  assert.equal(phrases, 8217);
});

test("V4 accepts 32 phrases without removing the bounded limit or strict data-only schema", () => {
  const structure = structuredClone(readRetentionV4Source()[0]!.scoringStructure);
  const claim = structure.claims[0]!;
  claim.acceptedPhrases = Array.from({ length: 32 }, (_, index) => `Literal authored paraphrase ${index}`);
  assert.equal(validateMeasurementStructure(structure).claims[0]!.acceptedPhrases.length, 32);
  assert.ok(decodeMeasurementDraft(JSON.stringify(structure)));
  claim.acceptedPhrases.push("One phrase beyond the limit");
  assert.throws(() => validateMeasurementStructure(structure));
  assert.equal(decodeMeasurementDraft(JSON.stringify(structure)), null);
  const executable = { ...structure, script: "process.exit(0)" };
  assert.throws(() => validateMeasurementStructure(executable));
});

test("V4 reports existing partial phrase scores explicitly without rewriting owner content or the evaluator", () => {
  const issues = [];
  let checked = 0;
  for (const item of readRetentionV4Source()) for (const claim of item.scoringStructure.claims) {
    for (const phrase of claim.acceptedPhrases) {
      checked++;
      const result = evaluateClaim(claim, splitEvidenceUnits(phrase).map(unitTokens));
      if (result.awardedPoints !== claim.points) issues.push({ id: item.sourceId, claim: claim.id,
        phrase, points: result.awardedPoints, status: result.status });
    }
  }
  const evidence = JSON.parse(readFileSync("content/retention-v4/known-phrase-limitations.json", "utf8"));
  assert.equal(checked, 8217);
  assert.equal(evidence.status, "KNOWN_EXISTING_MATCHER_LIMITATIONS");
  assert.deepEqual(issues, evidence.issues);
  assert.equal(issues.length, 50, "a scorer change requires a separate review of the recorded limitations");
});

test("V4 imports once per body, preserves existing attempts and rotation, and rolls back conflicts", async t => {
  const database = await createTestDatabase();
  try {
    const [owner, learner] = await database.query<{ id: string }>(
      "insert into users(name,role,account_status,email) values ('V4 owner','owner','active','retention.v4.owner@example.test'),('V4 learner','student','active','retention.v4.learner@example.test') returning id",
    );
    const items = readRetentionV4Source();
    const old = await createRetentionText({ level: "A2", bodyText: bodyOfWords(110), scoringStructure: simpleStructure("previous content"), actorUserId: owner!.id }, database.db);
    const started = await startOrResumeAttempt({ userId: learner!.id, level: "A2", now: new Date("2026-10-19T00:00:00Z") }, database.db);
    const snapshot = () => database.query("select to_jsonb(a) row from retention_attempts a union all select to_jsonb(r) from retention_rotation_state r");
    const before = await snapshot();
    const first = await importRetentionV4(items, owner!.id, database.db);
    assert.equal(first.filter(row => row.action === "created").length, 75);
    assert.deepEqual(await snapshot(), before, "the import must never modify learner work or rotation");
    const second = await importRetentionV4(items, owner!.id, database.db);
    assert.equal(second.filter(row => row.action === "unchanged").length, 75);
    assert.deepEqual(second.map(row => [row.textId, row.versionId]), first.map(row => [row.textId, row.versionId]));
    const inventory = await listRetentionInventory(database.db);
    assert.deepEqual(inventory.map(row => row.activeCount), [16, 15, 15, 15, 15]);
    assert.equal((await database.query<{ n: number }>("select count(*)::int n from retention_text_versions"))[0]!.n, 76);
    assert.equal((await database.query<{ n: number }>("select count(*)::int n from audit_log where action='content.import.created'"))[0]!.n, 75);
    const oldRow = await database.query<{ current_version_id: string }>("select current_version_id from retention_texts where id=$1", [old.textId]);
    assert.equal(oldRow[0]!.current_version_id, started.attempt.retentionTextVersionId);

    await t.test("non-owners cannot import", async () => {
      await assert.rejects(() => importRetentionV4(items, learner!.id, database.db), /active_owner_required/);
    });
    await t.test("a late conflict rolls back earlier creates instead of leaving a partial batch", async () => {
      const changed = structuredClone(items);
      changed[0]!.bodyText = changed[0]!.bodyText.replace("Sara", "Rita");
      changed[0]!.bodySha256 = sha256(changed[0]!.bodyText);
      changed[74]!.structureSha256 = "wrong-structure-hash";
      await assert.rejects(() => importRetentionV4(changed, owner!.id, database.db), /existing_content_conflict/);
      assert.equal((await database.query<{ n: number }>("select count(*)::int n from retention_texts"))[0]!.n, 76);
    });
    await t.test("all fifteen texts in a level rotate without repetition and the rubric stays server-side", async () => {
      const seen = new Set<string>();
      for (let index = 0; index < 15; index++) {
        const now = new Date(Date.parse("2026-10-19T01:00:00Z") + index * 360_000);
        const current = await startOrResumeAttempt({ userId: learner!.id, level: "B1", now }, database.db);
        const textId = current.attempt.retentionTextId!;
        assert.equal(seen.has(textId), false);
        seen.add(textId);
        const item = items.find(row => first.find(result => result.sourceId === row.sourceId)!.textId === textId)!;
        const payload = await buildAttemptPayload(current.attempt, now, database.db);
        assert.equal(payload.phase, "reading");
        assert.equal("scoringStructure" in payload, false);
        if (payload.phase === "reading") assert.equal(payload.bodyText, item.bodyText);
        const done = await submitAttempt({ userId: learner!.id, attemptId: current.attempt.id,
          recallText: item.scoringStructure.claims.map(claim => claim.label).join("\n"),
          now: new Date(now.getTime() + 150_000) }, database.db);
        assert.equal(done.attempt.score, 100);
      }
      assert.equal(seen.size, 15);
    });
  } finally {
    await database.close();
  }
});
