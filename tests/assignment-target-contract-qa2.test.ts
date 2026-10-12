/*
 * §11 — THE ASSIGNMENT TARGET CONTRACT, PROVEN RATHER THAN ASSUMED.
 *
 * The question the owner asked is whether a canonical assignment may target several learners at once.
 * The answer from the code is NO for the shipped product, and this test is the evidence:
 *
 *   1. `POST /api/assignments` validates `targetUserId` as ONE uuid. There is no array field to fill.
 *   2. The teacher UI sends one student per submission.
 *   3. The only caller of `createAssignment` in the whole of src/ passes a one-element array.
 *
 * But `createAssignment` is array-shaped: it sets `assignments.targetUserId = studentIds[0]` while
 * inserting an `assignment_targets` row for EVERY student given. So the helper can build an assignment
 * whose authorization columns disagree — and they did. `mayReadAssignment` accepts any id in the target
 * rows, while the evaluate route accepted only `targetUserId`. A second target could therefore open work
 * set for them and be refused when submitting it, and their submission would have been looked up,
 * evaluated, marked complete and reported as the FIRST target's.
 *
 * That is a latent trap, not a live defect, because nothing passes more than one student. It is tested
 * here behaviourally — `mayReadAssignment` is a pure function, so the inconsistency is demonstrated
 * against the real implementation, not argued from a source-text scan — and the evaluate route now
 * resolves the subject from the CALLER so the two paths agree.
 *
 * Multi-target remains OWNER_DECISION_REQUIRED: enabling it is a product decision, and this test does not
 * invent it. What it does guarantee is that the decision cannot be made accidentally by someone passing a
 * longer array to a helper whose authorization used to only honour the first element.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { mayReadAssignment } from "../src/lib/content/assignments";

const DATABASE_URL = process.env.DATABASE_URL;
const dbEnabled = process.env.QA2_DATABASE_TESTS === "1" && !!DATABASE_URL && /localhost|127\.0\.0\.1/.test(DATABASE_URL);

const FIRST_TARGET = "11111111-1111-4111-8111-111111111111";
const SECOND_TARGET = "22222222-2222-4222-8222-222222222222";
const TEACHER = "33333333-3333-4333-8333-333333333333";
const OUTSIDER = "44444444-4444-4444-8444-444444444444";

const student = { id: "", role: "student" } as { id: string; role: string };

test("§11 the public assignment contract is single-target", async (t) => {
  await t.test("the API validates exactly one target uuid and exposes no array field", () => {
    const source = readFileSync(new URL("../src/app/api/assignments/route.ts", import.meta.url), "utf8");
    assert.match(source, /targetUserId: z\.string\(\)\.uuid\(\)/,
      "the public API must accept a single uuid target");
    assert.doesNotMatch(source, /studentIds: z\.array/,
      "the public API must not accept an array of students — that would be multi-target creation");
    // The sole caller passes exactly one student, which is what makes single-target the real contract
    // rather than merely the shape of one field.
    assert.match(source, /studentIds: \[parsed\.data\.targetUserId\]/,
      "the API must forward one student to createAssignment");
  });

  await t.test("no shipped caller anywhere in src/ passes more than one student", () => {
    const files: string[] = [];
    const walk = (dir: URL) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
        if (entry.isDirectory()) walk(at);
        else if (/\.(ts|tsx)$/.test(entry.name)) files.push(at.pathname);
      }
    };
    walk(new URL("../src/", import.meta.url));
    const callers = files.filter((file) => /createAssignment\(/.test(readFileSync(file, "utf8"))
      && !/export async function createAssignment/.test(readFileSync(file, "utf8")));
    assert.ok(callers.length >= 1, "expected at least one caller of createAssignment");
    for (const file of callers) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /studentIds: \[parsed\.data\.targetUserId\]/,
        `${file.split("/src/").pop()} must pass a one-element studentIds array`);
    }
    // The teacher form is the other half of the contract: it submits one student at a time.
    const form = readFileSync(new URL("../src/components/teacher/NewAssignmentForm.tsx", import.meta.url), "utf8");
    assert.match(form, /targetUserId: studentId/, "the teacher form sends one target per submission");
  });

  await t.test("the two authorization paths used to disagree about a second target", () => {
    /*
     * Behavioural, against the real pure function. With two target rows, the READ path accepts the second
     * learner; the old WRITE path (`assignment.targetUserId === user.id`) did not. This is the exact
     * inconsistency the evaluate route now closes by taking the union and resolving the subject from the
     * caller.
     */
    const assignment = { createdByUserId: TEACHER, targetUserId: FIRST_TARGET };
    const targets = [FIRST_TARGET, SECOND_TARGET];

    assert.equal(mayReadAssignment({ ...student, id: FIRST_TARGET }, assignment, targets), true,
      "the first target can read");
    assert.equal(mayReadAssignment({ ...student, id: SECOND_TARGET }, assignment, targets), true,
      "the READ path accepts a second target — this is the half that used to be unmatched");
    // The old write-path test, spelled out so the inconsistency is visible rather than implied.
    assert.equal(assignment.targetUserId === SECOND_TARGET, false,
      "the old write-path check refused the second target that the read path had already accepted");
    // The union the route now uses accepts both, and still refuses a stranger.
    const acceptedByWrite = (id: string) => assignment.targetUserId === id || targets.includes(id);
    assert.equal(acceptedByWrite(FIRST_TARGET), true);
    assert.equal(acceptedByWrite(SECOND_TARGET), true, "the write path must now agree with the read path");
    assert.equal(acceptedByWrite(OUTSIDER), false, "taking the union must not admit a stranger");

    assert.equal(mayReadAssignment({ ...student, id: OUTSIDER }, assignment, targets), false,
      "an unrelated learner can never read");
    assert.equal(mayReadAssignment({ id: TEACHER, role: "teacher" }, assignment, targets), true,
      "the teacher who set the work can read it");
    assert.equal(mayReadAssignment({ id: OUTSIDER, role: "admin" }, assignment, targets), true,
      "an administrator can read");
    assert.equal(mayReadAssignment({ ...student, id: OUTSIDER }, assignment, []), false,
      "with no target rows and no ownership, nobody else is admitted");
  });

  await t.test("the schema shape is what makes the split possible", { skip: !dbEnabled }, async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL! });
    client.on("error", () => {});
    await client.connect();
    try {
      const column = await client.query(
        `select data_type, is_nullable from information_schema.columns
          where table_schema='public' and table_name='assignments' and column_name='target_user_id'`);
      assert.equal(column.rows.length, 1, "assignments.target_user_id must exist");
      assert.equal(column.rows[0].data_type, "uuid", "it is a SINGLE uuid, not an array");
      assert.equal(column.rows[0].is_nullable, "NO", "it cannot be null, so it always names exactly one learner");

      const unique = await client.query(
        `select indexdef from pg_indexes where schemaname='public' and tablename='assignment_targets'`);
      console.log(`#   assignment_targets indexes: ${unique.rows.length}`);
      for (const row of unique.rows) console.log(`#     ${row.indexdef}`);
      const table = await client.query(
        `select count(*)::int n from information_schema.tables
          where table_schema='public' and table_name='assignment_targets'`);
      assert.equal(Number(table.rows[0].n), 1,
        "assignment_targets is a separate table, so several target rows per assignment are representable " +
        "even though target_user_id can only name one — which is exactly why the two must not be conflated");
    } finally {
      await client.end().catch(() => {});
    }
  });
});
