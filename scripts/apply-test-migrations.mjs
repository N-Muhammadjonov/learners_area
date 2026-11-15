/**
 * Canonical schema for fresh isolated integration databases; no remote target.
 *
 * Two paths, because they are not the same operation (FIN-13):
 *
 *   fresh   (default) An empty database. Schema migrations are applied in order. Content
 *                     migrations - which repair imported curriculum content and create no
 *                     table of their own - are DEFERRED and reported: on an empty database
 *                     there is no content for them to act on, and several assert absolute
 *                     content counts that no empty database can satisfy. 0094 raised
 *                     "Listening 1-20 must contain 80 transcript Parts" and aborted the whole
 *                     chain at migration 94 of 118, so the finance schema in 1115 was never
 *                     reached and this runner was not an end-to-end signal at all.
 *
 *   upgrade           An existing database that already holds content. Everything is applied
 *                     in order, content assertions included, and any failure is real.
 *
 * Deferral is never silent: the returned report lists every deferred file and the caller
 * prints it. A migration is classified by `tests/migration-contract.json`, which
 * `tests/test_tuition_migration_contract.py` re-derives from the migration bytes, so the list
 * cannot be edited into an ignore list.
 */
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

export function migrationContract(root){
  return JSON.parse(readFileSync(join(root,'services/backend/tests/migration-contract.json'),'utf8'));
}

export async function applyTestMigrations(db,root,options={}){
  const mode=options.mode||'fresh';
  if(mode!=='fresh'&&mode!=='upgrade')throw Error(`Unknown migration mode: ${mode}`);
  const deferredByContract=new Set(migrationContract(root).contentMigrations);
  let applied=0;
  const deferred=[];
  const files=readdirSync(join(root,'services/backend/migrations')).filter(x=>x.endsWith('.sql')).sort();
  for(const file of files){
    if(mode==='fresh'&&deferredByContract.has(file)){
      deferred.push({file,reason:'content migration: no imported content on a fresh database'});
      continue;
    }
    for(const sql of readFileSync(join(root,'services/backend/migrations',file),'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.exec(sql);
    applied++;
  }
  const additional=JSON.parse(readFileSync(join(root,'services/backend/tests/platform-migrations.json'),'utf8'));
  for(const path of additional){
    if(!/^supabase\/migrations\/[a-z0-9_]+\.sql$/.test(path))throw Error('Invalid isolated migration path');
    await db.exec('BEGIN');
    try{await db.exec(readFileSync(join(root,path),'utf8'));await db.exec('COMMIT');}
    catch(error){await db.exec('ROLLBACK');throw error;}
    applied++;
  }
  return mode==='fresh'?{applied,deferred,mode,total:files.length+additional.length}:applied;
}
