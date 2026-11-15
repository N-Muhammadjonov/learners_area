/** LOCAL inputs only: real PostgreSQL semantics with no production connection. */
import fs from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';

const root=resolve(import.meta.dirname,'..');
if(!process.env.READING_PAIR_SNAPSHOT||!process.env.READING_PAIR_SQL)throw Error('Explicit LOCAL snapshot and SQL paths are required');
const passages=JSON.parse(fs.readFileSync(process.env.READING_PAIR_SNAPSHOT,'utf8'));
assert.equal(passages.length,2);
const sql=fs.readFileSync(process.env.READING_PAIR_SQL,'utf8');
const db=new PGlite();
try{
 for(const file of fs.readdirSync(resolve(root,'services/backend/migrations')).filter(file=>file.endsWith('.sql')&&Number.parseInt(file,10)<=92).sort()){
  for(const statement of fs.readFileSync(resolve(root,'services/backend/migrations',file),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.exec(statement);
 }
 for(const p of passages){
  await db.query("INSERT INTO reading_passages(id,title,body_text,is_active,publication_state) VALUES($1,$2,$3,true,'published')",[p.id,p.title,p.body_text]);
  for(const r of p.occurrences){
   await db.query('INSERT INTO lexemes(id,term,part_of_speech,definition_en,translation_uz,sense_key,verification_status,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING',[r.lexeme_id,r.term,r.part_of_speech,r.definition_en,r.translation_uz,r.sense_key,r.verification_status,r.provenance]);
   await db.query("INSERT INTO lexical_occurrences(id,passage_id,lexeme_id,start_char,end_char,surface_form,source_type,resolution_status) VALUES($1,$2,$3,$4,$5,$6,'reading','resolved')",[r.id,p.id,r.lexeme_id,r.start_char,r.end_char,r.surface_form]);
  }
 }
 const oldIds=passages.flatMap(p=>p.occurrences.map(r=>r.id));
 const uid='11111111-1111-4111-8111-111111111111',vid='99999999-9999-4999-8999-999999999999';
 await db.query("INSERT INTO users(id,name,email,role,account_status,locale) VALUES($1,'Synthetic learner','pair@example.test','student','active','uz')",[uid]);
 await db.query("INSERT INTO user_vocabulary(id,user_id,lexeme_id,source_type,source_id,source_snapshot,srs_stage,interval_days,correct_count) VALUES($1,$2,$3,'reading',$4,$5,7,180,28)",[vid,uid,passages[0].occurrences[0].lexeme_id,passages[0].id,JSON.stringify({occurrenceId:passages[0].occurrences[0].id,sense:'preserved synthetic saved sense'})]);
 const fingerprint=async table=>(await db.query('SELECT md5(coalesce(string_agg(to_jsonb(t)::text,\'\' ORDER BY id),\'\')) AS hash FROM '+table+' t')).rows[0].hash;
 const users=await fingerprint('user_vocabulary');
 const oldLexemes=(await db.query('SELECT * FROM lexemes ORDER BY id')).rows;
 await db.exec(sql.replace(/COMMIT;\s*$/,'ROLLBACK;'));
 assert.equal((await db.query('SELECT count(*)::int n FROM lexical_occurrences')).rows[0].n,oldIds.length,'dry run rolls back');
 await db.exec(sql);
 const occurrences=await fingerprint('lexical_occurrences'),lexemes=await fingerprint('lexemes');
 await db.exec(sql);
 assert.equal(await fingerprint('lexical_occurrences'),occurrences,'reapply has no effect');
 assert.equal(await fingerprint('lexemes'),lexemes,'reapply creates no duplicate senses');
 assert.equal(await fingerprint('user_vocabulary'),users,'saved vocabulary/SRS remain byte-identical');
 assert.deepEqual((await db.query('SELECT * FROM lexemes WHERE id=ANY($1::uuid[]) ORDER BY id',[oldLexemes.map(l=>l.id)])).rows,oldLexemes);
 assert.equal((await db.query('SELECT count(*)::int n FROM lexical_occurrences WHERE id=ANY($1::uuid[])',[oldIds])).rows[0].n,oldIds.length);
 const hydrated=[];
 for(const p of passages){
  const rows=(await db.query('SELECT o.*,l.term,l.part_of_speech,l.definition_en,l.translation_uz,l.sense_key,l.provenance,l.verification_status FROM lexical_occurrences o JOIN lexemes l ON l.id=o.lexeme_id WHERE o.passage_id=$1 ORDER BY o.start_char,o.end_char',[p.id])).rows;
  for(const r of rows)assert.equal(p.body_text.slice(r.start_char,r.end_char),r.surface_form);
  hydrated.push({...p,occurrences:rows});
 }
 if(process.env.READING_PAIR_AFTER)fs.writeFileSync(process.env.READING_PAIR_AFTER,JSON.stringify(hydrated));
 // Change the SECOND source. The complete pair must roll back atomically.
 await db.query('UPDATE reading_passages SET body_text=body_text||$2 WHERE id=$1',[passages[1].id,' changed']);
 await assert.rejects(db.exec(sql),/reading_pair_source_changed/);await db.exec('ROLLBACK');
 assert.equal(await fingerprint('lexical_occurrences'),occurrences);
 console.log(JSON.stringify({database:'isolated PGlite PostgreSQL',passages:2,oldIdsPreserved:oldIds.length,occurrences:hydrated.map(p=>p.occurrences.length),invalidOffsets:0,idempotent:true,secondSourceChecksumGuard:true,learnerStateUnchanged:true,existingLexemesUnchanged:true}));
}finally{await db.close();}
