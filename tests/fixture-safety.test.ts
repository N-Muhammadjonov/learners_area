import test from "node:test";
import assert from "node:assert/strict";

/**
 * Safety rails for acceptance probes that WRITE to the database.
 *
 * verify-progress.mjs inserts a graded mock attempt to prove the band detector is not
 * vacuous, then deletes it. The INSERTs and the DELETEs sat ~80 lines apart with no
 * try/finally, so any thrown assertion in between left a fabricated band 6.5 on the
 * seeded learner's account — permanently, on whatever database the probe was pointed
 * at. These are the rules that make that impossible, so they are tested like product
 * code rather than trusted as discipline.
 */
const mod = () => import("../scripts/lib/fixture-safety.mjs" as string);

test("only disposable QA databases may be mutated", async () => {
  const { assertMutableDatabase } = await mod();

  // Allowed: local, recognisably disposable.
  assert.doesNotThrow(() => assertMutableDatabase("postgres://postgres@localhost:5432/learners_qa2"));
  assert.doesNotThrow(() => assertMutableDatabase("postgres://u@127.0.0.1:5432/learners_area_test"));
  assert.doesNotThrow(() => assertMutableDatabase("postgres://u@127.0.0.1:5432/something_test"));

  // Refused: anything that smells of production, anything remote, and — importantly —
  // the probe's own historical default, which pointed at the real application database.
  assert.throws(() => assertMutableDatabase("postgres://u@localhost:5432/learners_production"), /production/i);
  assert.throws(() => assertMutableDatabase("postgres://u@db.prod.example.com:5432/learners_qa2"), /production/i);
  assert.throws(() => assertMutableDatabase("postgres://u@10.2.3.4:5432/learners_qa2"), /disposable/i);
  assert.throws(() => assertMutableDatabase("postgres://postgres@127.0.0.1:5433/learners_area"), /disposable/i);
});

test("the guard fails closed on missing or unparseable configuration", async () => {
  const { assertMutableDatabase } = await mod();
  assert.throws(() => assertMutableDatabase(undefined), /not set/i);
  assert.throws(() => assertMutableDatabase(""), /not set/i);
  assert.throws(() => assertMutableDatabase("not-a-url"), /parseable/i);
});

test("fixture tags are unique so parallel runs cannot collide", async () => {
  const { fixtureTag } = await mod();
  const tags = new Set(Array.from({ length: 1000 }, () => fixtureTag("x")));
  assert.equal(tags.size, 1000);
});

test("cleanup runs even when the body throws, and never masks the original error", async () => {
  const { withFixtures } = await mod();

  let cleaned = false;
  await assert.rejects(
    () => withFixtures(async () => { throw new Error("assertion blew up"); }, async () => { cleaned = true; }),
    /assertion blew up/,
  );
  assert.equal(cleaned, true, "fixtures must be removed when an assertion throws");

  // A broken cleanup must not hide why the run actually failed.
  await assert.rejects(
    () => withFixtures(
      async () => { throw new Error("original"); },
      async () => { throw new Error("cleanup-also-broke"); },
    ),
    /original/,
  );

  // And the happy path still returns the body's value, with cleanup run.
  let cleanedHappy = false;
  const value = await withFixtures(async () => 42, async () => { cleanedHappy = true; });
  assert.equal(value, 42);
  assert.equal(cleanedHappy, true);
});
