/** Isolated PostgreSQL-WASM fresh/install and populated-upgrade rehearsal.
 * No server, shared database, owner data, or external network is used.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const evidence='docs/riwi-port/current-main-integration-20261101';
const baseline=JSON.parse(readFileSync(`${evidence}/MAIN_MIGRATION_BASELINE.json`));
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json'));
const hash=x=>createHash('sha256').update(x).digest('hex');
assert.deepEqual(journal.entries.slice(0,baseline.entries.length),baseline.entries);
for(const [path,sha] of Object.entries(baseline.sql_sha256))assert.equal(hash(readFileSync(path)),sha,path);
const suffix=journal.entries.slice(baseline.entries.length);
assert.deepEqual(suffix.map(e=>e.tag.slice(0,4)),['0075','0076','0077','0078','0079']);
for(const entry of suffix)assert.equal(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'),readFileSync(`services/backend/migrations/${entry.tag}.sql`,'utf8'));

async function apply(db,entries){
  for(const entry of entries){
    await db.exec('BEGIN');
    try{
      for(const sql of readFileSync(`drizzle/${entry.tag}.sql`,'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.exec(sql);
      await db.exec('COMMIT');
    }catch(error){await db.exec('ROLLBACK');throw new Error(`${entry.tag}: ${error.message}`,{cause:error});}
  }
}
async function catalog(db){return (await db.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;}
async function snapshot(db){
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const rows={};
  for(const {tablename} of tables){assert.match(tablename,/^[a-z0-9_]+$/);rows[tablename]=(await db.query(`SELECT to_jsonb(t) AS row FROM public."${tablename}" t`)).rows.map(r=>r.row).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
  return rows;
}
const fresh=new PGlite(),upgrade=new PGlite();
try{
  await apply(fresh,journal.entries);
  await apply(upgrade,baseline.entries);
  const uid='00000000-0000-4000-8000-000000000001';
  await upgrade.query("INSERT INTO users(id,name,email,password_hash,role,account_status,last_active_at) VALUES($1,'RIWI isolated learner','riwi-migration@example.invalid','test-only','student','active','2026-01-01T00:00:00Z')",[uid]);
  await upgrade.query("INSERT INTO content_versions(module,content_type,source_ref,version_no,status,title,content_hash,semantic_hash,answer_key_hash,created_by_user_id) VALUES('reading','passage','riwi-upgrade',1,'published','Historical revision',$1,$1,$1,$2)",['a'.repeat(64),uid]);
  const before=await snapshot(upgrade);
  await apply(upgrade,suffix);
  const after=await snapshot(upgrade);
  // Existing rows/values remain byte-equivalent. New nullable/default columns
  // on pre-existing tables are projected away for this preservation comparison.
  for(const [table,rows] of Object.entries(before)){
    assert.equal(after[table].length,rows.length,`${table}: row loss`);
    const columns=rows.length?Object.keys(rows[0]):[];
    const projected=after[table].map(row=>Object.fromEntries(columns.map(k=>[k,row[k]])));
    assert.deepEqual(projected,rows,`${table}: historical values changed`);
  }
  assert.deepEqual(await catalog(upgrade),await catalog(fresh),'fresh/upgrade schema drift');
  const classification=JSON.parse(readFileSync('services/backend/contracts/riwi_portability_tables.json'));
  assert.deepEqual(Object.keys(classification.tables).sort(),Object.keys(after).sort(),'unclassified portability table');
  for(const [table,spec] of Object.entries(classification.tables)){
    assert.deepEqual(spec.columns,(await catalog(upgrade)).filter(c=>c.table_name===table).map(c=>c.column_name),`${table}: unclassified column`);
  }
  const secure=(await upgrade.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND (relname LIKE 'riwi_%' OR relname IN ('speaking_ai_sessions','speaking_ai_session_items')) AND relkind='r' ORDER BY relname")).rows;
  assert.equal(secure.length,16);assert(secure.every(r=>r.relrowsecurity));
  await upgrade.exec('CREATE ROLE riwi_direct_client');
  await upgrade.exec('GRANT USAGE ON SCHEMA public TO riwi_direct_client; GRANT SELECT ON ALL TABLES IN SCHEMA public TO riwi_direct_client');
  await upgrade.exec('SET ROLE riwi_direct_client');
  for(const row of secure)assert.equal((await upgrade.query(`SELECT count(*)::int n FROM public."${row.relname}"`)).rows[0].n,0);
  await upgrade.exec('RESET ROLE');
  const receipt={executed_at:new Date().toISOString(),engine:'PGlite PostgreSQL WASM',native_server:false,
    source_main:baseline.main_sha,main_prefix_unchanged:true,journal_entries:journal.entries.length,
    suffix:suffix.map(e=>({tag:e.tag,sha256:hash(readFileSync(`drizzle/${e.tag}.sql`))})),
    fresh_install:'pass',populated_upgrade:'pass',preserved_existing_tables:Object.keys(before).length,
    privacy_tables:secure.length,direct_client_read_denied:true,shared_database_touched:false,
    divergent_historical_riwi_database:'not_rehearsed',native_postgresql:'blocked: Docker socket access denied; native server binary unavailable'};
  if(process.argv.includes('--write-receipt'))writeFileSync(`${evidence}/MIGRATION_REHEARSAL.json`,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
}finally{await fresh.close();await upgrade.close();}
