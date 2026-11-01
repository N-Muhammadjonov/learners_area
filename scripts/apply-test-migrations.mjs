/** Canonical schema for fresh isolated integration databases; no remote target. */
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

export async function applyTestMigrations(db,root){
  let applied=0;
  for(const file of readdirSync(join(root,'services/backend/migrations')).filter(x=>x.endsWith('.sql')).sort()){
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
  return applied;
}
