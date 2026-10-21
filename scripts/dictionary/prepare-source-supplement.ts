/** Additive, source-checked candidate preparation. Never connects to a database,
 * publishes a release, guesses a contextual meaning or changes a source sense. */
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {gzipSync} from "node:zlib";
import {unzipSync,strFromU8} from "fflate";
import {bytesHash,decodeShard,type ShardDescriptor} from "../../src/lib/dictionary/shards";
import {entrySchema,entryContentHash,normalizeSearch,projectId,stableJson,type Entry} from "../../src/lib/dictionary/model";
import {dictionaryPos} from "../../src/lib/dictionary/labels";
import {exampleUsesEntry} from "../../src/lib/dictionary/example-match";

const [prepared,archivePath,draftPath,out]=process.argv.slice(2);
if(!prepared||!archivePath||!draftPath||!out)throw Error("Usage: prepare-source-supplement.ts PREPARED VERIFIED-ARCHIVE DRAFT NEW-OUTPUT.json.gz");
const archive=readFileSync(archivePath),draft=JSON.parse(readFileSync(draftPath,"utf8")) as {
 sourceArchiveSha256:string;sourceUrl:string;sourceLicense:string;
 entries:{lemma:string;pos:string;synsetId:string;translationUz:string;exampleEn:string;exampleUz:string;collocations:string[];targetLexemeId?:string;expectedEntrySha?:string}[];
};
if(bytesHash(archive)!==draft.sourceArchiveSha256||draft.sourceLicense!=="CC-BY-4.0")throw Error("supplement_source_identity_mismatch");
const sourceFiles=unzipSync(archive,{filter:file=>file.name.endsWith(".json")&&!file.name.includes("__MACOSX/")&&!file.name.split("/").at(-1)!.startsWith("._")});
type Synset={definition:string[];members:string[];partOfSpeech:string};
const sourceSenses=new Map<string,Synset>();
for(const [path,body]of Object.entries(sourceFiles))if(!/^(?:entries-[^/]+|frames)\.json$/.test(path.split("/").at(-1)!))for(const [id,row]of Object.entries(JSON.parse(strFromU8(body))))sourceSenses.set(id,row as Synset);
const plan=JSON.parse(readFileSync(join(prepared,"release-plan.json"),"utf8"));
const original:Entry[]=plan.shards.flatMap((descriptor:ShardDescriptor)=>[...decodeShard(plan.release,descriptor,readFileSync(join(prepared,"shards",descriptor.shard+".json.gz"))).values()]);
if(original.length!==plan.expected.lexemes)throw Error("complete_source_required");
const additions:Entry[]=[],reused:string[]=[];
const attribution={source_name:"Open English Wordnet 2025 plus / Learners Area supplement",snapshot_id:draft.sourceArchiveSha256,creator:"Open English Wordnet and Open English Namenet contributors; Learners Area editorial assistant",source_url:draft.sourceUrl,license_reference:"CC BY 4.0; upstream Princeton WordNet license applies to incorporated database elements",license_url:"https://creativecommons.org/licenses/by/4.0/",attribution_text:"English definitions and synonym identities retain the exact source synset. Uzbek translations and new usage examples are original AI editorial drafts. No independent human review or contextual word assignment is claimed."};
for(const row of draft.entries){
 const source=sourceSenses.get(row.synsetId),pos=dictionaryPos(row.pos);
 if(!source||!source.definition?.length||!source.members.some(member=>normalizeSearch(member)===normalizeSearch(row.lemma)))throw Error("supplement_synset_mismatch:"+row.lemma);
 const sourcePos=dictionaryPos(source.partOfSpeech==="s"?"a":source.partOfSpeech);
 if(sourcePos!==pos)throw Error("supplement_part_of_speech_mismatch:"+row.lemma);
 const definition=source.definition.join("; ");
 if(original.some(entry=>normalizeSearch(entry.display_lemma)===normalizeSearch(row.lemma)&&dictionaryPos(entry.part_of_speech)===pos&&entry.senses.some(sense=>normalizeSearch(sense.definition_en)===normalizeSearch(definition)))){reused.push(row.lemma);continue;}
 const existing=original.filter(entry=>normalizeSearch(entry.display_lemma)===normalizeSearch(row.lemma)&&dictionaryPos(entry.part_of_speech)===pos);
 if(existing.length&&(existing.length!==1||existing[0]!.lexeme_id!==row.targetLexemeId||entryContentHash(existing[0]!)!==row.expectedEntrySha))throw Error("existing_head_requires_explicit_sense_revision:"+row.lemma);
 const lexemeId=projectId("oewn-plus-lexeme",normalizeSearch(row.lemma)+"|"+pos),senseId=projectId("oewn-plus-sense",lexemeId+"|"+row.synsetId);
 const entry:Entry={schema_version:"1.0.0",release_id:plan.release,lexeme_id:lexemeId,display_lemma:row.lemma,normalized_search_form:normalizeSearch(row.lemma),part_of_speech:row.pos,lexical_type:row.lemma.includes(" ")?"phrase":"word",homograph_group:null,is_satellite:source.partOfSpeech==="s",pronunciations:[],forms:[],relations:[],attribution:[attribution],collocations:row.collocations.map(text=>({text,sense_id:senseId})),senses:[{sense_id:senseId,definition_en:definition,definition_uz:row.translationUz,translations:[{translation_id:projectId("oewn-plus-translation",senseId),text:row.translationUz,order:0}],examples:[{example_id:projectId("oewn-plus-usage",senseId+"|"+row.exampleEn),text_en:row.exampleEn,text_uz:row.exampleUz}],editorial:{status:"source_checked",translation_status:"ai_draft",reference_urls:[draft.sourceUrl],provenance:"oewn_plus_source_supplement"}}]};
 if(!exampleUsesEntry(entry,row.exampleEn))throw Error("supplement_example_missing_head:"+row.lemma);
 const target=existing[0];
 const candidate=target?{...target,senses:[...target.senses,...entry.senses],collocations:[...target.collocations,...entry.collocations],attribution:[...target.attribution,...entry.attribution]}:entry;
 entrySchema.parse(candidate);additions.push(candidate);
}
const combined=[...original.filter(entry=>!additions.some(next=>next.lexeme_id===entry.lexeme_id)),...additions];
for(const entry of additions){
 const sourceRow=draft.entries.find(row=>normalizeSearch(row.lemma)===entry.normalized_search_form)!;
 const source=sourceSenses.get(sourceRow.synsetId)!;
 // A legacy polysemous entry has no source-sense field on its relation rows.
 // Its new sense is linked by the sense presentation builder instead.
 if(entry.senses.length!==1)continue;
 for(const target of combined)if(target.lexeme_id!==entry.lexeme_id&&dictionaryPos(target.part_of_speech)===dictionaryPos(entry.part_of_speech)&&source.members.some(member=>normalizeSearch(member)===normalizeSearch(target.display_lemma))){
  for(const targetSense of target.senses)if(normalizeSearch(targetSense.definition_en)===normalizeSearch(source.definition.join("; ")))entry.relations.push({relation_type:"synonym",target_lexeme_id:target.lexeme_id,target_sense_id:targetSense.sense_id,display_lemma:target.display_lemma,part_of_speech:target.part_of_speech,lexical_type:target.lexical_type});
 }
}
if(new Set(additions.map(entry=>entry.lexeme_id)).size!==additions.length)throw Error("duplicate_supplement_identity");
const combinedById=new Map(combined.map(entry=>[entry.lexeme_id,entry]));
for(const before of original){const after=combinedById.get(before.lexeme_id)!;for(const sense of before.senses)if(stableJson(after.senses.find(row=>row.sense_id===sense.sense_id))!==stableJson(sense))throw Error("original_sense_changed");}
const existingIds=new Set(original.map(entry=>entry.lexeme_id));
const addedSenses=additions.reduce((n,entry)=>n+entry.senses.length-(original.find(before=>before.lexeme_id===entry.lexeme_id)?.senses.length??0),0);
const report={version:1,sourceRelease:plan.release,sourceArchiveSha256:draft.sourceArchiveSha256,draftSha256:bytesHash(readFileSync(draftPath)),baselineEntries:original.length,addedEntries:additions.filter(entry=>!existingIds.has(entry.lexeme_id)).length,additiveExistingEntries:additions.filter(entry=>existingIds.has(entry.lexeme_id)).length,reused,addedSenses,addedExamplePairs:addedSenses,synonymLinks:additions.reduce((n,e)=>n+e.relations.length-(original.find(before=>before.lexeme_id===e.lexeme_id)?.relations.length??0),0),collocations:additions.reduce((n,e)=>n+e.collocations.length-(original.find(before=>before.lexeme_id===e.lexeme_id)?.collocations.length??0),0),sourceEnglishMatched:true,originalSenseFieldsChanged:0,contextAssignmentsMade:0,published:false,independentHumanReviewClaimed:false};
writeFileSync(out,gzipSync(stableJson({report,entries:additions}),{level:9}),{flag:"wx"});
writeFileSync(out+".report.json",JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report));
