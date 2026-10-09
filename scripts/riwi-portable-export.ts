import "server-only";
import { privatePortableFile as privateFile } from "./lib/portable-private-file";
import pg from "pg";
import { z } from "zod";
import { parseArgs } from "node:util";
import { runPortableExportCommand } from "../src/lib/portability/export-command";

const objectSchema = z.object({ objectClass: z.enum(["riwi-knowledge-source", "speaking-audio", "site-private"]), sourceKey: z.string().min(1).max(2048), destinationKey: z.string().max(2048).nullable(), ownerId: z.string().uuid().nullable(), scope: z.enum(["global", "role", "user"]), retentionState: z.enum(["active", "deleted", "expired"]), sha256: z.string().regex(/^[a-f0-9]{64}$/), byteLength: z.number().int().nonnegative(), mimeType: z.string().max(200) }).strict();
let pool: pg.Pool | undefined;
let key: Buffer | undefined;
try {
  const { values } = parseArgs({ options: {
    scope: { type: "string" }, "dry-run": { type: "boolean", default: false }, destination: { type: "string" },
    "source-fingerprint": { type: "string" }, "session-file": { type: "string" }, "key-file": { type: "string" }, "inventory-file": { type: "string" },
  }, strict: true, allowPositionals: false });
  if (!values.scope || !values["session-file"] || !values["inventory-file"] || !values["source-fingerprint"] || !process.env.DATABASE_URL) throw new Error("portable_arguments_required");
  const sessionToken = (await privateFile(values["session-file"], 8192)).toString("utf8").trim();
  const objects = z.array(objectSchema).max(100000).parse(JSON.parse((await privateFile(values["inventory-file"], 32 * 1024 * 1024)).toString("utf8")));
  if (!values["dry-run"]) {
    if (!values["key-file"]) throw new Error("portable_key_file_required");
    key = await privateFile(values["key-file"], 32);
  }
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const manifest = await runPortableExportCommand({ request: { scope: values.scope, dryRun: values["dry-run"], destination: values.destination, sourceFingerprint: values["source-fingerprint"] }, sessionToken, pool, key,
    async *objects() { yield* objects; } });
  console.log(JSON.stringify({ scope: manifest.scope, dryRun: values["dry-run"], manifestSha256: manifest.manifestSha256,
    tables: manifest.tables.length, rows: manifest.tables.reduce((n, row) => n + row.rowCount, 0), objects: manifest.objects.length,
    objectMode: manifest.objectMode, activation: "NOT_PERFORMED", operationalAcceptance: "PENDING_OBJECT_ACCESS_AND_RESTORE_REHEARSAL" }));
} catch {
  // Errors can contain SQL, URLs or credential values. No raw exception logging.
  console.error("portable_export_failed: check scope, private files, current owner authority and destination; no automatic retry");
  process.exitCode = 1;
} finally { key?.fill(0); await pool?.end(); }
