import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { migrateTestDatabase } from "./support/pglite";

const BEFORE_0045 = "0044_riwi_owner_history_indexes.sql";

test("0045 upgrades a populated Coach database without rewriting historical evaluations or grade snapshots", async () => {
  const client = new PGlite();
  const userId = "11111111-2222-4333-8444-555555555555";
  const evaluationId = "22222222-3333-4444-8555-666666666666";
  const sourceId = "33333333-4444-4555-8666-777777777777";
  const gradeId = "44444444-5555-4666-8777-888888888888";

  try {
    await migrateTestDatabase(client, { through: BEFORE_0045 });
    await client.query("INSERT INTO users (id, name) VALUES ($1, 'Legacy assessment learner')", [userId]);
    await client.query(
      `INSERT INTO evaluations (
        id, user_id, evaluation_type, source_type, source_id,
        provider_id, provider_display_name, provider_type, provider_version,
        prompt_version, rubric_version, checked_by_name
      ) VALUES ($1, $2, 'writing', 'writing_submission', $3,
        'riwi', 'RIWI', 'internal', '1.0.0', 'legacy-prompt-v1', 'legacy-rubric-v1', 'RIWI')`,
      [evaluationId, userId, sourceId],
    );
    await client.query(
      `INSERT INTO writing_grade_requests (
        id, user_id, task_type, question_text, essay_text, word_count, idempotency_key
      ) VALUES ($1, $2, 'task1', 'Describe the chart shown.', 'A saved legacy essay.', 4, 'legacy-grade-key')`,
      [gradeId, userId],
    );

    await migrateTestDatabase(client, { after: BEFORE_0045 });

    const evaluation = (await client.query<{
      provider_id: string;
      prompt_version: string;
      rubric_version: string;
      assessment_contract_key: string | null;
      owner_policy_scope: string | null;
      owner_policy_version: number | null;
      teaching_feedback: unknown;
    }>(
      `SELECT provider_id, prompt_version, rubric_version, assessment_contract_key,
        owner_policy_scope, owner_policy_version, teaching_feedback
       FROM evaluations WHERE id = $1`,
      [evaluationId],
    )).rows[0];
    assert.ok(evaluation);
    assert.equal(evaluation.provider_id, "riwi");
    assert.equal(evaluation.prompt_version, "legacy-prompt-v1");
    assert.equal(evaluation.rubric_version, "legacy-rubric-v1");
    assert.equal(evaluation.assessment_contract_key, null, "historical rows remain honestly unversioned by contract");
    assert.equal(evaluation.owner_policy_scope, null);
    assert.equal(evaluation.owner_policy_version, null);
    assert.equal(evaluation.teaching_feedback, null);

    const grade = (await client.query<{ question_text: string; essay_text: string; task_category: string | null }>(
      "SELECT question_text, essay_text, task_category FROM writing_grade_requests WHERE id = $1",
      [gradeId],
    )).rows[0];
    assert.deepEqual(grade, {
      question_text: "Describe the chart shown.",
      essay_text: "A saved legacy essay.",
      task_category: null,
    });

    const policyTables = (await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('riwi_assessment_policies', 'riwi_assessment_policy_versions')
       ORDER BY table_name`,
    )).rows.map((row) => row.table_name);
    assert.deepEqual(policyTables, ["riwi_assessment_policies", "riwi_assessment_policy_versions"]);
  } finally {
    await client.close();
  }
});
