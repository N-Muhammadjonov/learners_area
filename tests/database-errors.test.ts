import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyDatabaseError,
  databaseUnavailableResponse,
} from "../src/lib/http/database-errors";
import { safeDatabaseDiagnostic } from "../src/lib/observability/errors";

/**
 * "The database is not there" must be a distinguishable state.
 *
 * Against the production database this repository was in exactly that state:
 * the app connected, but the schema had never been migrated, so every query
 * failed with 42P01 and the visitor got a generic 500 — an HTML error page that
 * the client could not even parse. The classification below is what turns that
 * into a named, honest answer.
 *
 * The other half of the rule matters just as much: a genuine bug must stay a
 * 500. Only the codes listed here are reclassified.
 */

test("an unmigrated database is recognised through a wrapped Drizzle error", () => {
  // Shape of the real failure: Drizzle wraps the driver error in `cause`.
  const wrapped = { query: "select * from users", cause: { code: "42P01", message: 'relation "users" does not exist' } };
  assert.equal(classifyDatabaseError(wrapped), "schema_missing");
});

test("the classifier walks more than one level of cause", () => {
  const deep = { cause: { cause: { cause: { code: "42703" } } } };
  assert.equal(classifyDatabaseError(deep), "column_missing");
});

test("a refused connection surfaces as unreachable, not as a schema problem", () => {
  const refused = { code: "ECONNREFUSED", errors: [{ code: "ECONNREFUSED" }, { code: "08006" }] };
  assert.equal(classifyDatabaseError(refused), "unreachable");
});

test("wrong credentials are their own reason", () => {
  assert.equal(classifyDatabaseError({ code: "28P01" }), "auth_failed");
  assert.equal(classifyDatabaseError({ code: "28000" }), "auth_failed");
});

test("actual Node transport errors remain distinguishable through Drizzle and aggregate wrappers", () => {
  for (const code of ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]) {
    assert.equal(classifyDatabaseError({ cause: new AggregateError([Object.assign(new Error("private host/password"), { code })]) }), "unreachable");
  }
});

test("aggregate cycles share the visited set without recursion or hiding a real error", () => {
  const aggregate: { errors: unknown[] } = { errors: [] };
  aggregate.errors.push(aggregate);
  assert.equal(classifyDatabaseError(aggregate), null);
  aggregate.errors.push({ cause: { code: "42703" } });
  assert.equal(classifyDatabaseError(aggregate), "column_missing");
});

test("a full server is capacity, not a missing schema", () => {
  assert.equal(classifyDatabaseError({ code: "53300" }), "capacity");
  assert.equal(classifyDatabaseError({ code: "57P03" }), "capacity");
});

test("a bug stays a bug", () => {
  // Not one of ours: a TypeError from application code, a syntax error in a
  // query, a unique violation, a null dereference.
  assert.equal(classifyDatabaseError(new TypeError("x is not a function")), null);
  assert.equal(classifyDatabaseError({ code: "42601" }), null, "syntax error in our own SQL");
  assert.equal(classifyDatabaseError({ code: "23505" }), null, "unique violation is a request outcome");
  assert.equal(classifyDatabaseError(null), null);
  assert.equal(classifyDatabaseError("boom"), null);
});

test("a cause cycle does not hang the classifier", () => {
  const a: { code?: string; cause?: unknown } = {};
  const b = { cause: a };
  a.cause = b;
  assert.equal(classifyDatabaseError(a), null);
});

test("the response body never leaks the driver message, host or user", () => {
  const { status, body } = databaseUnavailableResponse("schema_missing");
  assert.equal(status, 503, "the service is not ready: 503, so the client can tell it apart from a bug");
  const text = JSON.stringify(body);
  assert.match(text, /"error":"service_unavailable"/);
  assert.match(text, /"reason":"schema_missing"/);
  assert.doesNotMatch(text, /postgres|password|@|relation "users"/i);
});

test("safe SQL diagnostics walk wrapped driver errors without carrying messages or credentials", () => {
  const driver = Object.assign(new Error("host=db.internal password=not-for-logs"), { name: "PostgresError", code: "42703" });
  const wrapper = Object.assign(new Error("SELECT private data"), { cause: driver, query: "SELECT secret" });
  const diagnostic = safeDatabaseDiagnostic(wrapper);
  assert.deepEqual(diagnostic, { errorClass: "PostgresError", sqlState: "42703" });
  const alphanumericState = Object.assign(new Error("sensitive text"), { name: "PostgresError", code: "22P02" });
  assert.deepEqual(safeDatabaseDiagnostic(alphanumericState), { errorClass: "PostgresError", sqlState: "22P02" });
  assert.doesNotMatch(JSON.stringify(diagnostic), /db\.internal|password|private data|secret|SELECT/i);
});

test("an unreachable database gets the connection wording, not the migration one", () => {
  const missing = databaseUnavailableResponse("schema_missing").body.hint;
  const down = databaseUnavailableResponse("unreachable").body.hint;
  const auth = databaseUnavailableResponse("auth_failed").body.hint;
  assert.notEqual(missing, down);
  assert.match(missing, /migrations/);
  assert.match(down, /credentials/);
  assert.equal(auth, down);
});
