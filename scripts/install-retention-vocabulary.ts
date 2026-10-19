import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db/client";
import { retentionTexts, retentionTextVersions, lexicalOccurrences, users } from "../src/db/schema";
import { ingestRetentionOccurrences } from "../src/lib/services/lexical/reading-occurrences";
import { recordAudit } from "../src/lib/data/audit";
import { bodyHash, readRetentionVocabulary } from "./retention-vocabulary-source";

export async function installRetentionVocabulary(executor= db, actorUserId?: string) {
  const sources=readRetentionVocabulary();
  return executor.transaction(async tx=>{
    // Match exact immutable bodies, never allocation order or reused display labels.
    const current=await tx.select({id:retentionTextVersions.id,body:retentionTextVersions.bodyText,level:retentionTexts.level})
      .from(retentionTexts).innerJoin(retentionTextVersions,eq(retentionTextVersions.id,retentionTexts.currentVersionId)).where(eq(retentionTexts.active,true));
    const matched=sources.map(source=>{
      const hits=current.filter(row=>row.level===source.level&&bodyHash(row.body)===source.bodySha256&&row.body===source.bodyText);
      if(hits.length!==1)throw Error(`Retention vocabulary source mismatch: ${source.sourceId}`);
      return {...source,versionId:hits[0]!.id};
    });
    const results=[];
    for(const source of matched){
      const installed=await ingestRetentionOccurrences(tx as never,source.versionId,source.bodyText,source.vocabulary);
      results.push({sourceId:source.sourceId,versionId:source.versionId,bodySha256:source.bodySha256,...installed});
    }
    const spans=await tx.select({version:lexicalOccurrences.retentionTextVersionId,status:lexicalOccurrences.resolutionStatus,lexemeId:lexicalOccurrences.lexemeId,surface:lexicalOccurrences.surfaceForm,start:lexicalOccurrences.startChar,end:lexicalOccurrences.endChar})
      .from(lexicalOccurrences).where(and(eq(lexicalOccurrences.sourceType,"retention"),inArray(lexicalOccurrences.retentionTextVersionId,matched.map(row=>row.versionId))));
    for(const source of matched)for(const unit of source.vocabulary){
      if(!spans.some(span=>span.version===source.versionId&&span.status==='resolved'&&span.lexemeId&&span.surface===unit.word&&source.bodyText.slice(span.start,span.end)===unit.word))throw Error(`Retention vocabulary unresolved: ${source.sourceId} ${unit.word}`);
    }
    if(actorUserId)await recordAudit({actorUserId,action:"content.import.updated",targetType:"retention_vocabulary",metadata:{texts:75,curatedUnits:375,occurrences:spans.length,provenance:"retention_ai_draft"}},tx);
    return {texts:matched.length,curatedUnits:375,occurrences:spans.length,results};
  });
}

async function main(){
  if(!process.argv.includes("--apply")){const records=readRetentionVocabulary();console.log(JSON.stringify({ok:true,mode:"source_only",texts:records.length,units:records.reduce((n,row)=>n+row.vocabulary.length,0)}));return;}
  if(process.env.RAILWAY_PROJECT_ID!=="fa66cadd-5364-47bd-95f9-0689b0562269"||process.env.RAILWAY_ENVIRONMENT_ID!=="e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a"||process.env.RAILWAY_SERVICE_ID!=="68f0cfac-8723-40e7-9c3c-52856dc06786"||!process.env.RETENTION_VOCAB_EXPECTED_REVISION||process.env.RAILWAY_GIT_COMMIT_SHA!==process.env.RETENTION_VOCAB_EXPECTED_REVISION)throw Error("Retention vocabulary target/revision mismatch");
  const ownerId=process.env.RETENTION_VOCAB_OWNER_ID;
  const owner=ownerId?await db.query.users.findFirst({where:and(eq(users.id,ownerId),eq(users.role,"owner"),eq(users.accountStatus,"active"))}):null;
  if(!owner)throw Error("Retention vocabulary active owner required");
  console.log(JSON.stringify({ok:true,...await installRetentionVocabulary(db,owner.id)}));
}
if(process.argv[1]?.endsWith('install-retention-vocabulary.ts'))main().catch(error=>{console.error(error instanceof Error?error.message:'Retention vocabulary failed');process.exitCode=1;}).finally(()=>db.$client.end());
