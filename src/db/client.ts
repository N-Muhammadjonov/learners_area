import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type Pool } from "pg";
import * as schema from "./schema";

// `pg` ships as CommonJS; destructuring the named export directly breaks
// under plain Node ESM (as opposed to a bundler like Next's), so go through
// the default export for the runtime value. The `Pool` type import above is
// erased at compile time and doesn't hit that interop issue.
const { Pool: PoolCtor } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __learnersAreaPool: Pool | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Every phase of a database call has a deadline
 * ---------------------------------------------------------------------------
 *
 * This pool used to be `new Pool({ connectionString })` and nothing else, which
 * means: up to ten connections per process, each acquired with *no* timeout, and
 * each query allowed to wait *forever* for a reply. Against a local PostgreSQL
 * that is invisible. Against a hosted pooler thousands of kilometres away it is
 * the difference between a slow page and a page that never renders:
 *
 *   * the pool hands out connections it has already been told are acceptable,
 *     and when the pooler is at its client limit the new connection attempt is
 *     accepted by TCP and then dropped — so the request waits on a socket that
 *     will never speak (`Connection terminated unexpectedly`), or waits on a
 *     queue that never moves;
 *   * a statement that hangs holds its connection for as long as it likes, and
 *     a frozen Serverless instance holds those sockets across the freeze.
 *
 * Measured in this sandbox with a 120 ms-per-hop proxy in front of PostgreSQL
 * (Singapore-equivalent latency) and a six-client cap:
 *
 *   before  parallel /reading × 4  →  4 concurrent renders, every in-flight
 *           query failed, HTTP 500 ("Failed query: select … [cause] Connection
 *           terminated unexpectedly")                    0/12 requests rendered
 *           parallel /reading × 4, saturated queue → one request never returned
 *           at all (client aborted at 15 s)              3/4 requests rendered
 *
 * With the deadlines below the same saturation produces a fast, real error
 * instead of a hang, and the pool is small enough that several Serverless
 * instances cannot exhaust a session pooler's own client budget.
 *
 * The numbers, and why each one:
 *
 *   max 5                      A `/reading` render needs at most three
 *                              connections at once (identity, counts, list), so
 *                              five leaves room for a second concurrent request
 *                              without letting one instance take ten of a
 *                              pooler's fifteen. Override with
 *                              `DATABASE_POOL_MAX` when the deployment has a
 *                              bigger budget; never above 20.
 *   connectionTimeoutMillis    Gives up on a connection that never becomes
 *     (8 s)                    usable. This is the failure the owner saw: after
 *                              it, the request fails *now* instead of freezing.
 *   statement_timeout (15 s)   Applied to PostgreSQL right after the connection
 *                              is established (see SESSION_SETUP), so the server
 *                              itself cancels a runaway statement and the
 *                              connection goes back to the pool free.
 *   query_timeout (20 s)       The client-side ceiling, deliberately above the
 *                              server one: the server should always be the one
 *                              that cancels, and this only catches a server that
 *                              cannot answer at all (dead socket). This one is
 *                              enforced inside this process, so no pooler or
 *                              hosting detail can take it away.
 *   idleTimeoutMillis (10 s)   Long enough to be reused between clicks, short
 *                              enough that a pooler's own idle cull does not
 *                              hand the next request a corpse.
 *   maxUses (500)              Recycles a connection after a while; hosted
 *                              poolers rotate backends during maintenance.
 *   keepAlive                  Lets the OS notice a connection that died
 *                              quietly instead of discovering it on the next
 *                              query.
 *   application_name           The pool shows up in the database's own activity
 *                              view as `learners-area` (also applied right after
 *                              connecting, see SESSION_SETUP), which is how the
 *                              connection count can be verified by hand.
 *   allowExitOnIdle            A Serverless instance with nothing in flight may
 *                              exit instead of holding sockets open.
 *
 * Nothing here retries a failed query: a database that is genuinely unreachable
 * must surface as an error, not be hidden behind a loop that makes every slow
 * outage slower.
 */
const DEFAULT_POOL_MAX = 5;
const configuredMax = Number(process.env.DATABASE_POOL_MAX ?? "");
const max =
  Number.isFinite(configuredMax) && configuredMax >= 1
    ? Math.min(Math.floor(configuredMax), 20)
    : DEFAULT_POOL_MAX;

/**
 * Session settings, applied with an ordinary statement directly after the
 * connection is established - deliberately *not* in the connection's startup
 * packet.
 *
 * `pg` sends `application_name`, `statement_timeout` and friends inside that
 * packet, and a connection pooler sitting in front of PostgreSQL is allowed to
 * reject any parameter it does not recognise with a fatal
 * `08P01 unsupported startup parameter`. On such a pooler every single
 * connection would fail and the whole application would be down - a fix for a
 * crash that causes a bigger crash. Running them as statements works through
 * session pooling, transaction pooling and a direct connection alike.
 *
 * A failure here is not fatal: the connection is still usable, and the
 * client-side `query_timeout` above is what guarantees that no request can wait
 * forever. It is logged once per connection attempt, without the connection
 * string, so a misconfigured pooler stays visible instead of silent.
 */
const STATEMENT_TIMEOUT_MS = 15_000;

const SESSION_SETUP = [
  "SET application_name = 'learners-area'",
  `SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
].join("; ");

/**
 * `pg` honours `verify` at runtime (pg-pool calls it as soon as a connection is
 * established, before the waiting query gets it), but `@types/pg` does not
 * declare it yet, so the option is typed here instead of cast away.
 */
type VerifyConnection = (
  client: import("pg").PoolClient,
  done: (error?: Error | null) => void,
) => void;
type PoolOptions = ConstructorParameters<typeof PoolCtor>[0] & {
  verify?: VerifyConnection;
};

const poolOptions: PoolOptions = {
  connectionString: process.env.DATABASE_URL,
  max,
  connectionTimeoutMillis: 8_000,
  query_timeout: 20_000,
  idleTimeoutMillis: 10_000,
  maxUses: 500,
  keepAlive: true,
  allowExitOnIdle: true,
  // `pg` calls this once per newly opened connection, before the connection is
  // handed to the waiting query. Errors are swallowed on purpose (see above):
  // the session settings are an improvement, never a precondition.
  verify: (client, done) => {
    client.query(SESSION_SETUP, (error) => {
      if (!error) return done(null);
      console.error(`[db] session setup failed: ${error.message}`);
      // A refused statement is survivable (the pooler may not allow session
      // settings at all). A connection that is already gone is not: hand it
      // back broken so the pool throws it away instead of handing it to a
      // query later.
      const { code } = error as Error & { code?: string };
      const gone =
        code === "ECONNRESET" ||
        code === "EPIPE" ||
        code === "57P01" ||
        /terminat|not connected|hang ?up|socket/i.test(error.message);
      done(gone ? error : null);
    });
  },
};

const pool = global.__learnersAreaPool ?? new PoolCtor(poolOptions);

/**
 * A pooled connection dying is not a reason for the whole process to die.
 *
 * `pg` emits `error` on the pool when a client that is sitting idle is closed by
 * the server — which happens routinely with a hosted pooler: a failover, a
 * maintenance window, an idle timeout, a network blip. Node treats an
 * unhandled `'error'` event as an uncaught exception, so without this listener
 * one dropped connection takes down the server for every user.
 *
 * The pool removes the broken client itself; the request that was using it still
 * fails and reports a real error to its caller. All this handler owes the
 * operator is a line in the log, and it must not contain the connection string.
 */
pool.on("error", (error) => {
  console.error(`[db] idle client error: ${error.message}`);
});

if (process.env.NODE_ENV !== "production") {
  global.__learnersAreaPool = pool;
}

export const db = drizzle(pool, { schema });
