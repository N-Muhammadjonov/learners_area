import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase} from './support/pglite';
import {applyCourseCorrections} from '../src/lib/dictionary/course-corrections';
test('exact-ID context corrections are idempotent, refuse changed sources and preserve learner/SRS rows',async()=>{
 const d=await createTestDatabase();try{
  const id='11111111-1111-5111-8111-111111111111';await d.query("insert into lexemes(id,term,part_of_speech,definition_en,translation_uz,sense_key,verification_status) values($1,'come in handy','idiom','An important expression from Part 1.','Kontekst orqali o‘rganiladigan ibora','before-key','unverified')",[id]);
  const c={id,term:'come in handy',part_of_speech:'idiom',before:{definition_en:'An important expression from Part 1.',translation_uz:'Kontekst orqali o‘rganiladigan ibora',sense_key:'before-key',verification_status:'unverified'},after:{definition_en:'To be useful when needed.',translation_uz:'kerak paytda asqatmoq'},status:'source_checked',provenance:'course_context_editorial'};
  const before=await d.query('select * from user_vocabulary');await assert.rejects(()=>applyCourseCorrections([{...c,before:{...c.before,definition_en:'wrong'}}],d.db),/source_changed/);
  assert.equal((await applyCourseCorrections([c],d.db)).changed,1);assert.equal((await applyCourseCorrections([c],d.db)).changed,0);assert.deepEqual(await d.query('select * from user_vocabulary'),before);
  await d.query("update lexemes set verification_status='verified',definition_en='Human-reviewed meaning' where id=$1",[id]);await assert.rejects(()=>applyCourseCorrections([c],d.db),/source_changed/);
 }finally{await d.close();}
});
