import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestDatabase} from './support/pglite';
import {validateCanonicalListeningPackage} from '../src/lib/import/listening/canonical';
import {importCanonicalListeningPackage} from '../src/lib/import/listening/importer';
import {users,uploadIntents} from '../src/db/schema';
import type {ResolvedAsset} from '../src/lib/import/core/assets';

test('all 31 owner packages publish atomically, claim private media, and re-import without duplicates',async()=>{
 const d=await createTestDatabase();
 try{
  const [owner]=await d.db.insert(users).values({name:'Batch owner fixture',role:'owner',accountStatus:'active'}).returning();
  await d.query("insert into listening_tests(title,created_by_user_id,audio_type,publication_state) values('Existing Test 1',$1,'audio','published')",[owner!.id]);
  const results=await d.db.transaction(async tx=>{
   const rows=[];
   for(let n=2;n<=32;n++){
    const dir=new URL(`../content/listening/academic/test-${String(n).padStart(2,'0')}/`,import.meta.url);
    const manifest=JSON.parse(readFileSync(new URL('manifest.json',dir),'utf8'));
    const validated=validateCanonicalListeningPackage(JSON.parse(readFileSync(new URL('canonical.json',dir),'utf8')));
    assert.ok(validated.ok);if(!validated.ok)throw Error('invalid fixture');
    const assets:ResolvedAsset[]=[];
    for(const [i,m] of manifest.media.entries()){
     const [intent]=await tx.insert(uploadIntents).values({userId:owner!.id,purpose:'material_primary',objectKey:m.objectKey,mimeType:m.contentType,originalName:m.path,size:m.bytes,status:'finalized',expiresAt:new Date(Date.now()+60000)}).returning();
     assets.push({key:i===0?'audio.full':m.contentType.startsWith('audio/')?`audio.part${i+1}`:'image.map',role:m.contentType.startsWith('audio/')?'audio':'image',uploadId:intent!.id,objectKey:m.objectKey,mimeType:m.contentType,size:m.bytes,originalName:m.path});
    }
    const options={actorUserId:owner!.id,assets,publish:true,publishAuthorized:true};
    const result=await importCanonicalListeningPackage(tx as never,validated.pkg,options);assert.ok(result.ok,JSON.stringify(result));if(!result.ok)throw Error('import failed');
    assert.equal(result.action,'created');assert.equal(result.publicationState,'published');
    const again=await importCanonicalListeningPackage(tx as never,validated.pkg,options);assert.ok(again.ok);if(!again.ok)throw Error('repeat failed');
    assert.equal(again.action,'unchanged');assert.equal(again.targetId,result.targetId);rows.push(result);
   }
   return rows;
  });
  assert.equal(results.length,31);
  const [counts]=await d.query('select (select count(*)::int from listening_tests) tests,(select count(*)::int from listening_questions) questions,(select count(*)::int from resource_blocks where owner_type=\'listening\') media,(select count(*)::int from upload_intents where status=\'attached\') attached,(select count(*)::int from content_imports where module=\'listening\') imports');
  assert.deepEqual(counts,{tests:32,questions:1240,media:43,attached:43,imports:31});
 }finally{await d.close();}
});
