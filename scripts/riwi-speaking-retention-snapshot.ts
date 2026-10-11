import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../src/db/schema";
import { readSpeakingRetentionSnapshot } from "../src/lib/data/speaking-retention-snapshot";
import { speakingRetentionSnapshotSchema } from "../src/lib/speaking/retention-plan";

let pool: pg.Pool | undefined;
try {
  const { values } = parseArgs({ options: { holds: { type: "string" }, out: { type: "string" } },
    strict: true, allowPositionals: false });
  if (!values.holds || !values.out || !process.env.DATABASE_URL) throw new Error("arguments_required");
  const holds = speakingRetentionSnapshotSchema.shape.holds.parse(JSON.parse(await readFile(values.holds, "utf8")));
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1,
    connectionTimeoutMillis: 8000, statement_timeout: 15000, query_timeout: 20000 });
  const snapshot = await readSpeakingRetentionSnapshot(drizzle(pool, { schema }), holds);
  await writeFile(values.out, JSON.stringify(snapshot, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ mode: "read_only_snapshot", capturedAt: snapshot.capturedAt,
    attempts: snapshot.attempts.length, holds: snapshot.holds.length, containsTranscriptText: false, deletionEnabled: false }));
} catch {
  console.error("Speaking retention snapshot failed. No deletion was attempted; existing output was preserved.");
  process.exitCode = 1;
} finally { await pool?.end(); }
