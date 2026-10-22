/** Local candidate only. Does not connect to a database or publish a release. */
import{readFileSync,writeFileSync}from'node:fs';import{join}from'node:path';import{gunzipSync,gzipSync}from'node:zlib';
import{decodeShard}from'../../src/lib/dictionary/shards';import{stableJson,type Entry}from'../../src/lib/dictionary/model';import{reviseDictionaryTranslations,translationRevisionSchema}from'../../src/lib/dictionary/translation-revisions';
const[prepared,supplement,draftPath,out]=process.argv.slice(2);if(!prepared||!supplement||!draftPath||!out)throw Error('Usage: prepare-translation-revisions.ts PREPARED SUPPLEMENT.gz DRAFT NEW-OUTPUT.gz');
const plan=JSON.parse(readFileSync(join(prepared,'release-plan.json'),'utf8')),additions=JSON.parse(gunzipSync(readFileSync(supplement)).toString());if(additions.report.sourceRelease!==plan.release)throw Error('translation_revision_release_mismatch');
const all=new Map<string,Entry>(plan.shards.flatMap((d:any)=>[...decodeShard(plan.release,d,readFileSync(join(prepared,'shards',d.shard+'.json.gz')))]));if(all.size!==plan.expected.lexemes)throw Error('complete_source_required');
for(const e of additions.entries)all.set(e.lexeme_id,e);
const draft=translationRevisionSchema.parse(JSON.parse(readFileSync(draftPath,'utf8'))),revised=reviseDictionaryTranslations([...all.values()],draft),wanted=new Set([...additions.entries.map((e:Entry)=>e.lexeme_id),...draft.rows.map(r=>r.entryId)]);
const report={...additions.report,originalSenseFieldsChanged:draft.rows.length,translationRevisions:draft.rows.length,sourceEnglishMeaningsChanged:0,historicalReleaseChanged:false,published:false,independentHumanReviewClaimed:false};
writeFileSync(out,gzipSync(stableJson({report,entries:revised.filter(e=>wanted.has(e.lexeme_id))})),{flag:'wx'});writeFileSync(out+'.report.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
