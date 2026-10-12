#!/usr/bin/env node
/** Verify the already-present 0021 DDL before repairing ONE missing journal row.
 * Default --inspect is read-only. --apply requires the existing QA identity
 * guards and a real custom-format backup accepted by pg_restore --list.
 * Never adds/changes user columns, replays DDL, deletes history or enables gaps
 * in preview-qa-migrate.mjs. Unknown hashes/timestamps/DDL always refuse.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync, createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fingerprint, identityProblems, refuseProduction, readServerIdentity, serverIdentityHash, plan, qaConnectionOptions } from "./preview-qa-migrate.mjs";
export const TARGET = "0021_registration_gender";
const EXPECTED_HASH = "ba209a85c50ecf0818933f31896769bde1a1540ee21364bc18d3024e99f83d4a";
const sha = s => createHash("sha256").update(s).digest("hex");
export async function readEvidence(client) {
  const labels = (await client.query(`select e.enumlabel from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname='public' and t.typname='gender' order by e.enumsortorder`)).rows.map(r => r.enumlabel);
  const column = (await client.query("select udt_schema,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='users' and column_name='gender'")).rows[0] ?? null;
  const history = (await client.query("select hash,created_at from drizzle.__drizzle_migrations order by id")).rows;
  return { labels, column, history };
}
export function assess(evidence, journal, readSql) {
  const problems = [];
  const entries = journal.entries.map(e => ({ ...e, hash: sha(readSql(e.tag)) }));
  const target = entries.find(e => e.tag === TARGET);
  if (!target || target.hash !== EXPECTED_HASH) problems.push("0021 source differs from the inspected migration");
  const c = evidence.column;
  if (JSON.stringify(evidence.labels) !== JSON.stringify(["male", "female"])) problems.push("public.gender enum labels/order differ");
  if (!c || c.udt_schema !== "public" || c.udt_name !== "gender" || c.is_nullable !== "YES" || c.column_default !== null) problems.push("public.users.gender DDL differs from 0021");
  const known = new Map(entries.map(e => [e.hash,e]));
  const seen = new Set();
  for (const row of evidence.history) {
    const e = known.get(row.hash);
    if (!e) problems.push("unknown migration hash");
    else if (String(row.created_at) !== String(e.when)) problems.push(`migration timestamp mismatch: ${e.tag}`);
    if (seen.has(row.hash)) problems.push("duplicate migration hash");
    seen.add(row.hash);
  }
  const present = target ? seen.has(target.hash) : false;
  if (target && !present && !evidence.history.some(r => (known.get(r.hash)?.idx ?? -1) > target.idx)) problems.push("no later applied migration: this is not the known single journal gap");
  if (target) {
    const after = plan(journal, [...seen, target.hash], readSql);
    problems.push(...after.problems);
  }
  return { eligible: problems.length === 0, alreadyJournalled: present, targetHash: target?.hash ?? null, targetWhen: target?.when ?? null, problems };
}
export async function verifyBackup(file, listArchive = path => execFileSync("pg_restore", ["--list",path], { encoding:"utf8", maxBuffer:16*1024*1024, timeout:60000 })) {
  if (!file) throw new Error("PREVIEW_QA_BACKUP_FILE is required");
  const info = statSync(file);
  if (!info.isFile() || info.size < 5) throw new Error("backup is not a nonempty file");
  // pg_restore validates the archive structure; a filename/reference alone is insufficient.
  const listing = listArchive(file);
  if (!/\bTABLE DATA public users\s/.test(listing) || !/\bTABLE DATA drizzle __drizzle_migrations\s/.test(listing)) throw new Error("backup must contain data for public.users and drizzle.__drizzle_migrations");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return { bytes:info.size, sha256:hash.digest("hex"), archiveCatalogueVerified:true, restoreTested:false };
}
export async function reconcile({ client, env, journal, readSql, mode="--inspect", checkBackup=verifyBackup }) {
  if (!["--inspect","--apply"].includes(mode)) throw new Error("mode must be --inspect or --apply");
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const production = refuseProduction(url,env);
  const identity = identityProblems(url,env);
  if (production || identity.length) throw new Error(production || identity.join("; "));
  const server = await readServerIdentity(client);
  if (serverIdentityHash(server) !== env.PREVIEW_QA_SERVER_IDENTITY) throw new Error("server identity mismatch");
  const receipt = { mode, dbFingerprint:fingerprint(url), serverIdentity:serverIdentityHash(server), applied:false };
  if (mode === "--apply") {
    if (!env.PREVIEW_QA_BACKUP_REF) throw new Error("owner-approved PREVIEW_QA_BACKUP_REF is required");
    receipt.backup = await checkBackup(env.PREVIEW_QA_BACKUP_FILE);
    await client.query("begin isolation level serializable");
  }
  try {
    if (mode === "--apply") {
      await client.query("lock table drizzle.__drizzle_migrations in share row exclusive mode");
      await client.query("lock table public.users in access share mode");
    }
    const evidence = await readEvidence(client);
    const assessment = assess(evidence,journal,readSql);
    receipt.assessment = assessment;
    if (!assessment.eligible) throw new Error(assessment.problems.join("; "));
    if (mode === "--apply" && !assessment.alreadyJournalled) {
      await client.query("insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)",[assessment.targetHash,assessment.targetWhen]);
      const after = assess(await readEvidence(client),journal,readSql);
      if (!after.eligible || !after.alreadyJournalled) throw new Error("journal repair verification failed");
      receipt.applied = true;
    }
    if (mode === "--apply") await client.query("commit");
    return receipt;
  } catch (error) {
    if (mode === "--apply") await client.query("rollback").catch(() => {});
    throw error;
  }
}
async function cli() {
  const pg = (await import("pg")).default;
  const env = process.env;
  // Refuse an unapproved destination before making a network connection.
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const production = refuseProduction(env.DATABASE_URL,env);
  const problems = identityProblems(env.DATABASE_URL,env);
  if (production || problems.length) throw new Error(production || problems.join("; "));
  const client = new pg.Client(qaConnectionOptions(env.DATABASE_URL,env));
  await client.connect();
  try {
    const receipt = await reconcile({client,env,mode:process.argv[2]??"--inspect",journal:JSON.parse(readFileSync("drizzle/meta/_journal.json","utf8")),readSql:tag=>readFileSync(`drizzle/${tag}.sql`,"utf8")});
    console.log(JSON.stringify(receipt,null,2));
  } finally { await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli().catch(error=>{ console.error(String(error?.message??error).replace(/postgres(ql)?:\/\/[^\s]+/g,"<redacted-url>"));process.exitCode=1; });
