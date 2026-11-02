import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const journal=JSON.parse(read('drizzle/meta/_journal.json')).entries;
const review=JSON.parse(read('docs/riwi-port/sites-qa-20261102/MIGRATION_REVIEW.json'));
const snapshot=read('qa/riwi-sites-20261102/recovery-snapshot.sql');
const db=new PGlite();
const uid='00000000-0000-4000-8000-000000000851';
let restored=0;
let phase='baseline';
async function apply(sql){for(const part of sql.split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.exec(part);}
try {
  for(const e of journal.slice(0,66)) await apply(read(`drizzle/${e.tag}.sql`));
  await db.exec('CREATE SCHEMA drizzle; CREATE TABLE drizzle.__drizzle_migrations(id serial PRIMARY KEY,hash text NOT NULL,created_at bigint)');
  for(const e of journal.slice(0,66)) await db.query('INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)',
    [createHash('sha256').update(read(`drizzle/${e.tag}.sql`)).digest('hex'),e.when]);
  await db.query("INSERT INTO users(id,name,email,password_hash,role,account_status) VALUES($1,'Recovery fixture','qa-owner@learnersarea.test','not-a-real-credential','owner','active')",[uid]);
  await db.query("INSERT INTO speaking_attempts(user_id,part,transcript) VALUES($1,'part1','Synthetic snapshot restoration fixture.')",[uid]);
  const before=(await db.query('SELECT to_jsonb(t) AS row FROM speaking_attempts t')).rows[0].row;
  phase='recovery';
  await db.exec('BEGIN');
  await db.exec(snapshot);
  await db.exec('COMMIT');
  const manifest=(await db.query('SELECT source_table,row_count,restored_verified FROM riwi_qa_recovery_20261102.manifest')).rows;
  assert(manifest.length>=10);
  assert(manifest.every(x=>x.restored_verified));
  assert.equal(manifest.find(x=>x.source_table==='speaking_attempts').row_count,1);
  assert(!manifest.some(x=>x.source_table==='users'));
  assert.deepEqual((await db.query('SELECT to_jsonb(t) AS row FROM speaking_attempts t')).rows[0].row,before);
  restored=manifest.length;
  phase='upgrade';
  for(const e of review.journal){
    const sql=read(e.path);assert.equal(createHash('sha256').update(sql).digest('hex'),e.sha256);
  }
  for(const e of review.platform){
    const sql=read(e.path);assert.equal(createHash('sha256').update(sql).digest('hex'),e.sha256);
  }
  await db.exec(read('qa/riwi-sites-20261102/guarded-upgrade.sql'));
  const after=(await db.query('SELECT to_jsonb(t) AS row FROM speaking_attempts t')).rows[0].row;
  assert.deepEqual(Object.fromEntries(Object.keys(before).map(k=>[k,after[k]])),before);
  assert.equal((await db.query('SELECT count(*)::int n FROM drizzle.__drizzle_migrations')).rows[0].n,79);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public' AND tablename IN ('riwi_knowledge_sources','riwi_assessment_policies','riwi_security_signals','riwi_usage_metrics')")).rows[0].n,4);
  console.log(JSON.stringify({engine:'PGlite PostgreSQL WASM',remoteDatabaseTouched:false,
    recoveryTablesVerified:restored,populatedSpeakingAttemptPreserved:true,credentialTableExcluded:true,
    pendingJournalMigrations:review.journal.length,platformScripts:review.platform.length,
    finalJournal:79,status:'pass'}));
} catch(error){
  console.error(JSON.stringify({phase,code:error.code,message:error.message,detail:error.detail}));
  process.exitCode=1;
} finally {await db.close();}
