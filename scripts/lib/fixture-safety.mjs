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
 * Run `body`, then ALWAYS run `cleanup` — including when `body` throws.
 *
 * Cleanup failures are reported but never mask the original error, because the
 * original error is what the operator needs to see first.
 */
export async function withFixtures(body, cleanup) {
  try {
    return await body();
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      console.error(`  !! fixture cleanup FAILED: ${cleanupError?.message ?? cleanupError}`);
    }
  }
}
