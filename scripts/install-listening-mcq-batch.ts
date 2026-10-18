/** Owner-only, idempotent thirty-day MCQ import. Default validates source, never writes.
 * --apply --publish verifies all private R2 bytes, then imports in one transaction.
 * The existing 32 Listening tests and all learner records are outside this batch.
 */
import {createHash} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {db} from '../src/db/client';
import {users,uploadIntents} from '../src/db/schema';
import {importCanonicalListeningPackage} from '../src/lib/import/listening/importer';
import {S3Client,HeadObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {listeningMcqDesktopPackage} from './listening-mcq-desktop-package';
const args=new Set(process.argv.slice(2));
if([...args].some(arg=>!['--apply','--publish'].includes(arg))||args.has('--publish')&&!args.has('--apply'))throw Error('Invalid options');
async function main(){
 const packages=Array.from({length:30},(_,index)=>listeningMcqDesktopPackage(index+1));
 if(!args.has('--apply')){console.log(JSON.stringify({ok:true,mode:'source_only',days:packages.length,questions:packages.length*5}));return;}
 if(process.env.RAILWAY_PROJECT_ID!=='fa66cadd-5364-47bd-95f9-0689b0562269'||process.env.RAILWAY_ENVIRONMENT_ID!=='e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a'||process.env.RAILWAY_SERVICE_ID!=='68f0cfac-8723-40e7-9c3c-52856dc06786'||process.env.STORAGE_PROVIDER!=='r2'||process.env.R2_BUCKET_NAME!=='learners-area')throw Error('Wrong target or storage');
 if(!process.env.MCQ_BATCH_EXPECTED_REVISION || process.env.RAILWAY_GIT_COMMIT_SHA!==process.env.MCQ_BATCH_EXPECTED_REVISION)throw Error('Deployment revision mismatch');
 const ownerId=process.env.MCQ_BATCH_OWNER_ID;
 if(!ownerId)throw Error('Missing batch owner');
 const owner=await db.query.users.findFirst({where:and(eq(users.id,ownerId),eq(users.role,'owner'),eq(users.accountStatus,'active'))});
 if(!owner)throw Error('Not an active owner');
 const storage=new S3Client({region:process.env.R2_REGION||'auto',endpoint:process.env.R2_ENDPOINT,forcePathStyle:true,credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID!,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY!}});
 const media=packages.flatMap(p=>p.manifest.media);
 async function verify(asset:typeof media[number]){
  for(let attempt=0;attempt<3;attempt++){
   try{
    const head=await storage.send(new HeadObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:asset.objectKey}),{abortSignal:AbortSignal.timeout(15_000)});
    if(head.ContentLength!==asset.bytes||head.ContentType!==asset.mimeType)throw Error('R2 metadata mismatch '+asset.objectKey);
    const object=await storage.send(new GetObjectCommand({Bucket:process.env.R2_BUCKET_NAME,Key:asset.objectKey}),{abortSignal:AbortSignal.timeout(60_000)});
    const bytes=await object.Body?.transformToByteArray();
    if(!bytes||bytes.length!==asset.bytes||createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('R2 checksum mismatch '+asset.objectKey);
    console.log(JSON.stringify({verified:asset.objectKey,bytes:asset.bytes,sha256:asset.sha256}));return;
   }catch(error){
    if(error instanceof Error&&/R2 (metadata|checksum) mismatch/.test(error.message))throw error;
    if(attempt===2)throw Error('R2 read failed after bounded retries: '+asset.objectKey);
    console.warn(JSON.stringify({retry:asset.objectKey,attempt:attempt+1}));
   }
  }
 }
 // At most two recordings occupy memory/network; all checks precede DB writes.
 for(let offset=0;offset<media.length;offset+=2)await Promise.all(media.slice(offset,offset+2).map(verify));
 storage.destroy();
 const results=await db.transaction(async tx=>{
  // Serialize this owner import; a concurrent retry cannot create duplicate sources.
  await tx.select({id:users.id}).from(users).where(eq(users.id,ownerId)).for('update');
  const receipts=[];
  for(const {manifest,canonical} of packages){
   const assets=[];
   for(const [index,asset] of manifest.media.entries()){
    let intent=await tx.query.uploadIntents.findFirst({where:eq(uploadIntents.objectKey,asset.objectKey)});
    if(intent&&(intent.userId!==ownerId||intent.mimeType!==asset.mimeType||intent.size!==asset.bytes))throw Error('Asset ownership conflict');
    if(!intent){[intent]=await tx.insert(uploadIntents).values({userId:ownerId,purpose:'material_primary',status:'finalized',objectKey:asset.objectKey,originalName:asset.path.split('/').pop()!,mimeType:asset.mimeType,size:asset.bytes,directToStorage:true,expiresAt:new Date(Date.now()+86400000),finalizedAt:new Date()}).returning();}
    if(!intent)throw Error('Missing tracked upload');
    assets.push({key:index===0?'audio.full':`audio.question${index+1}`,role:asset.mimeType.startsWith('audio/')?'audio' as const:'image' as const,uploadId:intent.id,objectKey:intent.objectKey,mimeType:intent.mimeType,size:intent.size,originalName:intent.originalName});
   }
   const result=await importCanonicalListeningPackage(tx,canonical,{actorUserId:ownerId,assets,publish:args.has('--publish'),publishAuthorized:args.has('--publish'),originalFilename:`content/listening/mcq/day-${String(manifest.day).padStart(2,'0')}/source.html`,acknowledgeGradeImpact:false});
   if(!result.ok)throw Error(manifest.sourceRef+': '+result.report.issues.map(i=>i.message).join('; '));
   receipts.push({sourceId:manifest.sourceRef,id:result.targetId,action:result.action,publicationState:result.publicationState,counts:result.counts,lexical:result.lexical});
  }
  return receipts;
 });
 console.log(JSON.stringify({ok:true,mode:args.has('--publish')?'apply_publish':'apply_draft',days:results.length,results}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Batch import failed');process.exitCode=1;}).finally(()=>db.$client.end());
