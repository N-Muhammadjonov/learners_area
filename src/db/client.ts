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

const pool =
  global.__learnersAreaPool ??
  new PoolCtor({
    connectionString: process.env.DATABASE_URL,
  });

/**
 * A pooled connection dying is not a reason for the whole process to die.
 *
 * `pg` emits `error` on the pool when a client that is sitting idle is closed by
 * the server — which happens routinely with a hosted pooler: a failover, a
 * maintenance window, an idle timeout, a network blip. Node treats an
 * unhandled `'error'` event as an uncaught exception, so without this listener
 * one dropped connection takes down the server for every user. That is exactly
 * what the log showed while the database was being replaced under a running
 * instance.
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
