/**
 * Safety rails for acceptance probes that WRITE to the database.
 *
 * A probe that inserts a graded attempt to prove a detector works is valuable; the
 * same probe leaving that attempt behind is a fabricated learner score. Three things
 * have to be true and none of them can be left to discipline:
 *
 *   1. the target database must be one we are allowed to mutate;
 *   2. every fixture must be uniquely tagged, so parallel runs cannot collide and a
 *      previous crash cannot be mistaken for this run's residue;
 *   3. cleanup must run even when an assertion throws.
 *
 * Used by any probe that creates rows. Import it rather than re-implementing the rules.
 */

/** Databases a probe may mutate. Anything else must be opted into explicitly. */
const ALLOWED_NAMES = [/^learners_qa\d*$/i, /^learners_area_test$/i, /_test$/i, /^test_/i];
const FORBIDDEN_HINTS = [/prod/i, /production/i, /live/i];

/**
 * Refuse to run destructive fixtures against anything that is not a disposable QA
 * database. Fails closed: an unparseable or unexpected URL is NOT mutable.
 */
export function assertMutableDatabase(connectionString) {
  if (!connectionString) throw new Error("fixture safety: DATABASE_URL is not set; refusing to create fixtures");

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("fixture safety: DATABASE_URL is not parseable; refusing to create fixtures");
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const host = url.hostname;

  for (const bad of FORBIDDEN_HINTS) {
    if (bad.test(name) || bad.test(host)) {
      throw new Error(`fixture safety: refusing to create fixtures on "${name}" at ${host} (looks like production)`);
    }
  }

  const localHost = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  const allowedName = ALLOWED_NAMES.some((re) => re.test(name));

  if (localHost && allowedName) return { name, host };

  if (process.env.QA_ALLOW_FIXTURE_MUTATION === "1") {
    console.warn(`  !! fixture safety OVERRIDDEN by QA_ALLOW_FIXTURE_MUTATION for "${name}" at ${host}`);
    return { name, host };
  }

  throw new Error(
    `fixture safety: "${name}" at ${host} is not a recognised disposable QA database. ` +
      `Point DATABASE_URL at learners_qa2, or set QA_ALLOW_FIXTURE_MUTATION=1 if you really mean it.`
  );
}

/**
 * A tag unique to this process run. Fixtures carry it so that cleanup can assert
 * residue for THIS run only, and so two concurrent runs never delete each other's rows.
 */
export function fixtureTag(prefix = "qa") {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${process.pid}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Run `body`, then ALWAYS run `cleanup` — including when `body` throws — and let a
 * cleanup failure FAIL the run.
 *
 * THE BUG THIS FIXES. Cleanup used to be wrapped in its own try/catch that logged and
 * swallowed the error. A probe whose assertions all passed but whose cleanup failed
 * therefore exited 0, leaving fixture rows behind while reporting success. "Zero
 * residue" was being claimed by a function that could not detect residue it had
 * failed to remove. A cleanup failure is an acceptance failure.
 *
 * THE CONTRACT, all four cases:
 *   body ok   + cleanup ok   -> resolve with the body's value
 *   body FAIL + cleanup ok   -> throw the BODY error (what the operator must see)
 *   body ok   + cleanup FAIL -> throw the CLEANUP error (residue was left behind)
 *   body FAIL + cleanup FAIL -> throw AggregateError, BODY error first, both kept
 *
 * WHERE SETUP BELONGS. Everything that mutates must happen INSIDE `body`, not before
 * the call. Creating a row, then creating a second one that throws, then entering the
 * protected scope leaves the first row orphaned, because cleanup never started. Put
 * the inserts in `body`: cleanup then runs even when setup fails half way, and
 * `cleanup` must tolerate being called when nothing, or only part, was created.
 */
export async function withFixtures(body, cleanup) {
  let result;
  let bodyError;
  try {
    result = await body();
  } catch (error) {
    bodyError = error ?? new Error("fixture body threw a falsy value");
  }

  let cleanupError;
  try {
    await cleanup();
  } catch (error) {
    cleanupError = error ?? new Error("fixture cleanup threw a falsy value");
    console.error(`  !! fixture cleanup FAILED: ${cleanupError?.message ?? cleanupError}`);
  }

  if (bodyError && cleanupError) {
    // Both are real and both matter: the body error is the diagnosis, the cleanup
    // error means the database was left dirty. Neither may be dropped, and the body
    // error stays first so the operator reads the cause before the consequence.
    throw new AggregateError(
      [bodyError, cleanupError],
      `fixture body failed AND cleanup failed — residue may remain: ${bodyError?.message ?? bodyError}`,
    );
  }
  if (bodyError) throw bodyError;
  if (cleanupError) throw cleanupError;
  return result;
}
