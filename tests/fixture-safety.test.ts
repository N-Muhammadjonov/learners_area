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

/**
 * Section 03: a cleanup failure must FAIL acceptance.
 *
 * withFixtures used to wrap cleanup in its own try/catch that logged and swallowed the
 * error, so a probe whose assertions passed but whose cleanup failed exited 0 while
 * leaving rows behind. "Zero residue" was being asserted by a function that could not
 * detect the residue it had failed to remove.
 */
test("withFixtures: body ok and cleanup ok resolves with the body's value", async () => {
  const { withFixtures } = await import("../scripts/lib/fixture-safety.mjs" as string);
  let cleaned = false;
  const value = await withFixtures(
    async () => "the result",
    async () => { cleaned = true; },
  );
  assert.equal(value, "the result");
  assert.equal(cleaned, true, "cleanup must run on the happy path");
});

test("withFixtures: a failing body throws the BODY error, and cleanup still runs", async () => {
  const { withFixtures } = await import("../scripts/lib/fixture-safety.mjs" as string);
  let cleaned = false;
  await assert.rejects(
    () => withFixtures(
      async () => { throw new Error("BODY FAILED"); },
      async () => { cleaned = true; },
    ),
    /BODY FAILED/,
    "the body error is the diagnosis and must surface",
  );
  assert.equal(cleaned, true, "cleanup must run even when the body throws");
});

test("withFixtures: a failing cleanup FAILS the run even when the body succeeded", async () => {
  const { withFixtures } = await import("../scripts/lib/fixture-safety.mjs" as string);
  await assert.rejects(
    () => withFixtures(
      async () => "assertions all passed",
      async () => { throw new Error("CLEANUP FAILED"); },
    ),
    /CLEANUP FAILED/,
    "a successful body must not mask residue left by a failed cleanup",
  );
});

test("withFixtures: when both fail, both errors are kept and the body error is primary", async () => {
  const { withFixtures } = await import("../scripts/lib/fixture-safety.mjs" as string);
  await assert.rejects(
    () => withFixtures(
      async () => { throw new Error("BODY FAILED"); },
      async () => { throw new Error("CLEANUP FAILED"); },
    ),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError, "both failures must be reported together");
      const messages = error.errors.map((e: Error) => e.message);
      assert.deepEqual(messages, ["BODY FAILED", "CLEANUP FAILED"], "body error first, neither dropped");
      assert.match(error.message, /BODY FAILED/, "the primary cause belongs in the message");
      assert.match(error.message, /residue/i, "the operator must be told the database may be dirty");
      return true;
    },
  );
});

/**
 * Section 3.2: the protected scope must start BEFORE the first mutation.
 *
 * If setup creates row 1, then row 2 fails, and only then does the protected block
 * begin, row 1 is orphaned. Putting the mutations inside the body means cleanup runs
 * for a partially-created fixture too — and cleanup therefore has to tolerate that.
 */
test("withFixtures: cleanup runs after a PARTIAL setup failure, leaving no residue", async () => {
  const { withFixtures } = await import("../scripts/lib/fixture-safety.mjs" as string);
  const store = new Set<string>();

  await assert.rejects(
    () => withFixtures(
      async () => {
        store.add("row-1");            // first mutation succeeds
        throw new Error("second insert failed");  // setup dies half way
      },
      async () => { for (const row of [...store]) store.delete(row); },
    ),
    /second insert failed/,
  );
  assert.equal(store.size, 0, "the half-created fixture was left behind");
});
