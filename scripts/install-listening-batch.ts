/** Owner-only, idempotent Test 2–32 import. Default validates source, never writes.
 * --apply --publish verifies all private R2 bytes, then imports in one transaction.
 * Existing Test 1 and all learner attempts are outside this batch.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {db} from '../src/db/client';
import {users,uploadIntents} from '../src/db/schema';
import {validateCanonicalListeningPackage} from '../src/lib/import/listening/canonical';
import {importCanonicalListeningPackage} from '../src/lib/import/listening/importer';
import {getStorageService} from '../src/lib/services/storage';
import type {ListeningCanonicalPackage} from '../src/lib/import/listening/canonical';
import type {OriginalListeningDefinition} from '../src/lib/listening/original-listening';
const args=new Set(process.argv.slice(2));
if([...args].some(arg=>!['--apply','--publish'].includes(arg))||args.has('--publish')&&!args.has('--apply'))throw Error('Invalid options');
async function main(){
 const packages:{manifest:OriginalListeningDefinition&{id:string;sourceSha256:string};canonical:ListeningCanonicalPackage}[]=[];
 for(let n=2;n<=32;n++){
  const dir=new URL(`../content/listening/academic/test-${String(n).padStart(2,'0')}/`,import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',dir),'utf8'));
  const source=readFileSync(new URL('source.html',dir));
  const canonical=validateCanonicalListeningPackage(JSON.parse(readFileSync(new URL('canonical.json',dir),'utf8')));
  if(!canonical.ok||canonical.pkg.sourceRef!==`listening-test-${n}`||manifest.id!==canonical.pkg.sourceRef||createHash('sha256').update(source).digest('hex')!==manifest.sourceSha256)throw Error('Invalid batch source '+n);
  if(canonical.stored.questions.length!==40||canonical.stored.sections.length!==4)throw Error('Invalid counts '+n);
  packages.push({manifest,canonical:canonical.pkg});
 }
 if(!args.has('--apply')){console.log(JSON.stringify({ok:true,mode:'source_only',tests:packages.length,questions:packages.length*40}));return;}
 if(process.env.RAILWAY_PROJECT_ID!=='fa66cadd-5364-47bd-95f9-0689b0562269'||process.env.RAILWAY_ENVIRONMENT_ID!=='e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a'||process.env.RAILWAY_SERVICE_ID!=='68f0cfac-8723-40e7-9c3c-52856dc06786'||process.env.STORAGE_PROVIDER!=='r2'||process.env.R2_BUCKET_NAME!=='learners-area')throw Error('Wrong target or storage');
 const ownerId=process.env.LISTENING_BATCH_OWNER_ID;
 if(!ownerId)throw Error('Missing batch owner');
 const owner=await db.query.users.findFirst({where:and(eq(users.id,ownerId),eq(users.role,'owner'),eq(users.accountStatus,'active'))});
 if(!owner)throw Error('Not an active owner');
 const storage=getStorageService();
 for(const {manifest} of packages)for(const asset of manifest.media){
  const head=await storage.head(asset.objectKey);if(!head||head.size!==asset.bytes||head.contentType!==asset.contentType)throw Error('R2 metadata mismatch '+asset.objectKey);
  const result=await storage.read(asset.objectKey);if(!result||result.body.length!==asset.bytes||createHash('sha256').update(result.body).digest('hex')!==asset.sha256)throw Error('R2 checksum mismatch '+asset.objectKey);
  console.log(JSON.stringify({verified:asset.objectKey,bytes:asset.bytes,sha256:asset.sha256}));
 }
 const results=await db.transaction(async tx=>{
  // Serialize this owner import; a concurrent retry cannot create duplicate sources.
  await tx.select({id:users.id}).from(users).where(eq(users.id,ownerId)).for('update');
  const receipts=[];
  for(const {manifest,canonical} of packages){
   const assets=[];
   for(const [index,asset] of manifest.media.entries()){
    let intent=await tx.query.uploadIntents.findFirst({where:eq(uploadIntents.objectKey,asset.objectKey)});
    if(intent&&(intent.userId!==ownerId||intent.mimeType!==asset.contentType||intent.size!==asset.bytes))throw Error('Asset ownership conflict');
    if(!intent){[intent]=await tx.insert(uploadIntents).values({userId:ownerId,purpose:'material_primary',status:'finalized',objectKey:asset.objectKey,originalName:asset.path.split('/').pop()!,mimeType:asset.contentType,size:asset.bytes,directToStorage:true,expiresAt:new Date(Date.now()+86400000),finalizedAt:new Date()}).returning();}
    if(!intent)throw Error('Missing tracked upload');
    assets.push({key:index===0?'audio.full':asset.contentType.startsWith('audio/')?`audio.part${index+1}`:'image.map',role:asset.contentType.startsWith('audio/')?'audio' as const:'image' as const,uploadId:intent.id,objectKey:intent.objectKey,mimeType:intent.mimeType,size:intent.size,originalName:intent.originalName});
   }
   const result=await importCanonicalListeningPackage(tx,canonical,{actorUserId:ownerId,assets,publish:args.has('--publish'),publishAuthorized:args.has('--publish'),originalFilename:`content/listening/academic/test-${String(manifest.number).padStart(2,'0')}/source.html`,acknowledgeGradeImpact:false});
   if(!result.ok)throw Error(manifest.id+': '+result.report.issues.map(i=>i.message).join('; '));
   receipts.push({sourceId:manifest.id,id:result.targetId,action:result.action,publicationState:result.publicationState,counts:result.counts,lexical:result.lexical});
  }
  return receipts;
 });
 console.log(JSON.stringify({ok:true,mode:args.has('--publish')?'apply_publish':'apply_draft',tests:results.length,results}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Batch import failed');process.exitCode=1;}).finally(()=>db.$client.end());
