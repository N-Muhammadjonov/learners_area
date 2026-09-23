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

if (process.env.NODE_ENV !== "production") {
  global.__learnersAreaPool = pool;
}

export const db = drizzle(pool, { schema });
