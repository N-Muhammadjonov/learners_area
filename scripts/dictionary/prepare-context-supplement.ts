/** Local candidate preparation only. No database or publication capability. */
import {readFileSync,writeFileSync} from "node:fs";
import {gzipSync,gunzipSync} from "node:zlib";
import {join} from "node:path";
import {z} from "zod";
import {decodeShard,type ShardDescriptor} from "../../src/lib/dictionary/shards";
import {entrySchema,entryContentHash,normalizeSearch,projectId,sha,stableJson,type Entry} from "../../src/lib/dictionary/model";
import {dictionaryPos} from "../../src/lib/dictionary/labels";
import {exampleUsesEntry} from "../../src/lib/dictionary/example-match";
const [prepared,sourceAdditions,corpusPath,draftPath,out]=process.argv.slice(2);
if(!prepared||!sourceAdditions||!corpusPath||!draftPath||!out)throw Error("Usage: prepare-context-supplement.ts PREPARED SOURCE-ADDITIONS.gz CORPUS DRAFT NEW-OUTPUT.gz");
const draftBytes=readFileSync(draftPath,"utf8"),draft=z.object({version:z.literal(1),status:z.literal("ai_editorial_draft_not_published"),policy:z.string(),entries:z.array(z.object({lemma:z.string().min(1),pos:z.string().min(1),key:z.string().min(1),definitionEn:z.string().min(1),translationUz:z.string().min(1),exampleEn:z.string().min(1),exampleUz:z.string().min(1),usageFrames:z.array(z.string().min(1)),referenceUrl:z.string().url(),sourceMaterialId:z.string().uuid().optional(),sourceBodySha:z.string().regex(/^[a-f0-9]{64}$/).optional(),targetLexemeId:z.string().uuid().optional(),expectedEntrySha:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict())}).strict().parse(JSON.parse(draftBytes));
const plan=JSON.parse(readFileSync(join(prepared,"release-plan.json"),"utf8"));
const original:Entry[]=plan.shards.flatMap((d:ShardDescriptor)=>[...decodeShard(plan.release,d,readFileSync(join(prepared,"shards",d.shard+".json.gz"))).values()]);
if(original.length!==plan.expected.lexemes)throw Error("complete_source_required");
const source=JSON.parse(gunzipSync(readFileSync(sourceAdditions)).toString()) as {entries:Entry[];report:{sourceRelease:string}};
if(source.report.sourceRelease!==plan.release)throw Error("supplement_release_mismatch");
const additions=[...source.entries],combined=new Map(original.map(e=>[e.lexeme_id,e]));
for(const entry of additions){entrySchema.parse(entry);combined.set(entry.lexeme_id,entry);}
const corpus=JSON.parse(readFileSync(corpusPath,"utf8")) as {texts:{id:string;body:string}[]};
for(const row of draft.entries){
 if(row.sourceMaterialId){
  const matches=corpus.texts.filter(t=>t.id===row.sourceMaterialId);
  if(matches.length!==1||sha(matches[0]!.body)!==row.sourceBodySha||!matches[0]!.body.includes(row.lemma))throw Error("supplement_owner_source_changed:"+row.lemma);
 }else if(row.sourceBodySha)throw Error("supplement_source_identity_missing");
 const norm=normalizeSearch(row.lemma),id=projectId("context-editorial-lexeme",norm+"|"+row.pos),senseId=projectId("context-editorial-sense",norm+"|"+row.pos+"|"+row.key);
 const existing=[...combined.values()].filter(e=>e.normalized_search_form===norm&&dictionaryPos(e.part_of_speech)===dictionaryPos(row.pos));
 if(existing.length&&(existing.length!==1||existing[0]!.lexeme_id!==row.targetLexemeId||entryContentHash(existing[0]!)!==row.expectedEntrySha))throw Error("existing_head_requires_explicit_sense_revision:"+row.lemma);
 const entry:Entry={schema_version:"1.0.0",release_id:plan.release,lexeme_id:id,display_lemma:row.lemma,normalized_search_form:norm,part_of_speech:row.pos,lexical_type:norm.includes(" ")?"fixed_expression":"word",homograph_group:null,is_satellite:false,pronunciations:[],forms:[],relations:[],collocations:row.usageFrames.map(text=>({text,sense_id:senseId,pattern_type:"usage_frame"})),senses:[{sense_id:senseId,definition_en:row.definitionEn,definition_uz:row.translationUz,translations:[{translation_id:projectId("context-editorial-translation",senseId),text:row.translationUz,order:0}],examples:[{example_id:projectId("context-editorial-example",senseId+"|"+row.exampleEn),text_en:row.exampleEn,text_uz:row.exampleUz}],editorial:{status:"source_checked",translation_status:"ai_draft",reference_urls:[row.referenceUrl],provenance:"context_source_supplement"},...(row.pos==="proper noun"?{usage_label:"personal name"}:{})}],attribution:[{source_name:"Learners Area",snapshot_id:sha(draftBytes),creator:"Learners Area editorial assistant",source_url:row.referenceUrl,license_reference:"Original Learners Area editorial draft; references support facts only",license_url:"",attribution_text:"Original explanatory wording, Uzbek translation and usage example; not a copy of a referenced dictionary. AI editorial draft without independent human certification."}]};
 entrySchema.parse(entry);if(!exampleUsesEntry(entry,row.exampleEn))throw Error("supplement_example_missing_head:"+row.lemma);
 const target=existing[0],candidate=target?{...target,senses:[...target.senses,...entry.senses],collocations:[...target.collocations,...entry.collocations],attribution:[...target.attribution,...entry.attribution]}:entry;
 if(additions.some(e=>e.lexeme_id===candidate.lexeme_id))throw Error("supplement_duplicate_target");
 entrySchema.parse(candidate);combined.set(candidate.lexeme_id,candidate);additions.push(candidate);
}
for(const before of original)for(const sense of before.senses)if(stableJson(combined.get(before.lexeme_id)!.senses.find(s=>s.sense_id===sense.sense_id))!==stableJson(sense))throw Error("original_sense_changed");
if(new Set(additions.map(e=>e.lexeme_id)).size!==additions.length)throw Error("supplement_duplicate_identity");
const report={version:1,sourceRelease:plan.release,originalEntries:original.length,sourceSupplementEntries:source.entries.length,newContextEntries:draft.entries.filter(e=>!e.targetLexemeId).length,additiveExistingContextEntries:draft.entries.filter(e=>e.targetLexemeId).length,contextExamplePairs:draft.entries.length,usageFrames:draft.entries.reduce((n,e)=>n+e.usageFrames.length,0),inventedNameSynonyms:0,originalSenseFieldsChanged:0,published:false,contextAssignmentsMade:0};
writeFileSync(out,gzipSync(stableJson({report,entries:additions})),{flag:"wx"});
writeFileSync(out+".report.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report));
