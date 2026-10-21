import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {decodeShard,bytesHash} from '../../src/lib/dictionary/shards';
import {entryContentHash,senseMeaningHash,normalizeSearch,projectId,stableJson,type Entry} from '../../src/lib/dictionary/model';
import {dictionaryPos} from '../../src/lib/dictionary/labels';
import {exampleUsesEntry,usageNorm} from '../../src/lib/dictionary/example-match';
import type {RelatedMeaning,StoredPresentation} from '../../src/lib/dictionary/presentation-types';
export type Curation={examples:{lemma:string;definition:string;text_en:string;text_uz:string;reference:string;note:string}[];collocations:{lemma:string;definition:string;phrases:string[]}[];excludedSynonyms?:{lemma:string;definition:string;term:string;reason:string;reference:string}[]};
const gloss=(value:string)=>normalizeSearch(value);
const includes=(phrase:string,word:string)=>(' '+usageNorm(phrase)+' ').includes(' '+usageNorm(word)+' ');
const distinct=(items:RelatedMeaning[])=>[...new Map(items.map(x=>[usageNorm(x.text),x])).values()].sort((a,b)=>a.text.localeCompare(b.text,'en'));
export function buildPresentations(entries:Entry[],curation:Curation){
 type Member={entry:Entry;sense:Entry['senses'][number]};
 const groups=new Map<string,Member[]>(),terms=new Map<string,Entry[]>();
 const stats={entries:entries.length,senses:0,sourceRelations:0,sourceExamples:0,matchingExamples:0,hiddenUnrelatedExamples:0,synonymLinks:0,phraseLinks:0,sensesWithSynonyms:0,sensesWithPhrases:0,authoredExamples:0};
 for(const entry of entries){for(const sense of entry.senses){const key=dictionaryPos(entry.part_of_speech)+':'+gloss(sense.definition_en),g=groups.get(key)??[];g.push({entry,sense});groups.set(key,g);}for(const term of new Set(usageNorm(entry.display_lemma).split(' '))){const list=terms.get(term)??[];list.push(entry);terms.set(term,list);}}
 const result=new Map<string,StoredPresentation>();
 for(const entry of entries){const senses:StoredPresentation['senses']={};stats.sourceRelations+=entry.relations.length;
  const words=usageNorm(entry.display_lemma).split(' '),candidates=(terms.get(words[0]!)??[]).filter(p=>p.lexeme_id!==entry.lexeme_id&&usageNorm(p.display_lemma)!==usageNorm(entry.display_lemma)&&usageNorm(p.display_lemma).includes(' ')&&includes(p.display_lemma,entry.display_lemma));
  for(const sense of entry.senses){stats.senses++;stats.sourceExamples+=sense.examples.length;
   const members=groups.get(dictionaryPos(entry.part_of_speech)+':'+gloss(sense.definition_en))??[];
   const excluded=new Set((curation.excludedSynonyms??[]).filter(row=>usageNorm(row.lemma)===usageNorm(entry.display_lemma)&&gloss(row.definition)===gloss(sense.definition_en)).map(row=>usageNorm(row.term)));
   const synonyms=distinct(members.filter(m=>m.entry.lexeme_id!==entry.lexeme_id&&usageNorm(m.entry.display_lemma)!==usageNorm(entry.display_lemma)&&!excluded.has(usageNorm(m.entry.display_lemma))).map(m=>({text:m.entry.display_lemma,lexemeId:m.entry.lexeme_id,senseId:m.sense.sense_id})));
   const phrases:RelatedMeaning[]=synonyms.filter(m=>m.text.includes(' ')&&includes(m.text,entry.display_lemma));
   for(const phrase of candidates){
    const reverse=phrase.relations.find(r=>r.target_lexeme_id===entry.lexeme_id&&r.target_sense_id===sense.sense_id&&['hypernym','hyponym','synonym','similar'].includes(r.relation_type));
    // A shared spelling, even for a single-sense head, cannot establish an
    // idiom's meaning. Require an exact source relation and phrase sense.
    if(phrase.senses.length===1&&reverse)phrases.push({text:phrase.display_lemma,lexemeId:phrase.lexeme_id,senseId:phrase.senses[0]!.sense_id});
   }
   phrases.push(...entry.collocations.filter(c=>c.sense_id===sense.sense_id||(!c.sense_id&&entry.senses.length===1)).map(c=>({text:c.text})));
   for(const row of curation.collocations)if(usageNorm(row.lemma)===usageNorm(entry.display_lemma)&&gloss(row.definition)===gloss(sense.definition_en))phrases.push(...row.phrases.map(text=>({text})));
   const collocations=distinct(phrases),exampleIds=sense.examples.filter(ex=>exampleUsesEntry(entry,ex.text_en)).map(ex=>ex.example_id);
   const addedExamples=curation.examples.filter(ex=>usageNorm(ex.lemma)===usageNorm(entry.display_lemma)&&gloss(ex.definition)===gloss(sense.definition_en)).map(ex=>({example_id:projectId('sense-presentation-example',sense.sense_id+':'+ex.text_en),text_en:ex.text_en,text_uz:ex.text_uz}));
   if(addedExamples.some(ex=>!exampleUsesEntry(entry,ex.text_en)))throw Error('curated_example_does_not_use_head');
   stats.matchingExamples+=exampleIds.length;stats.hiddenUnrelatedExamples+=sense.examples.length-exampleIds.length;stats.authoredExamples+=addedExamples.length;stats.synonymLinks+=synonyms.length;stats.phraseLinks+=collocations.length;if(synonyms.length)stats.sensesWithSynonyms++;if(collocations.length)stats.sensesWithPhrases++;
   senses[sense.sense_id]={synonyms,collocations,meaningSha:senseMeaningHash(entry,sense),exampleIds,...(addedExamples.length?{addedExamples}:{})};
  }
  result.set(entry.lexeme_id,{contentSha:entryContentHash(entry),senses});
 }
 return {result,stats};
}
if(process.argv[1]?.endsWith('build-sense-presentation.ts')){
 const [prepared,out='content/dictionary/presentation']=process.argv.slice(2);if(!prepared)throw Error('Usage: build-sense-presentation.ts PREPARED [OUTPUT]');
 const planBytes=readFileSync(join(prepared,'release-plan.json')),plan=JSON.parse(planBytes.toString()),entries:Entry[]=[];
 for(const descriptor of plan.shards)entries.push(...decodeShard(plan.release,descriptor,readFileSync(join(prepared,'shards',descriptor.shard+'.json.gz'))).values());
 if(entries.length!==plan.expected.lexemes)throw Error('full_source_required');
 const curationBytes=readFileSync('content/dictionary/sense-curated.json'),curation=JSON.parse(curationBytes.toString()) as Curation,{result,stats}=buildPresentations(entries,curation);
 if(stats.senses!==plan.expected.senses||stats.sourceExamples!==plan.expected.examples)throw Error('full_source_required');
 for(const row of [...curation.examples,...curation.collocations])if(!entries.some(e=>usageNorm(e.display_lemma)===usageNorm(row.lemma)&&e.senses.some(s=>gloss(s.definition_en)===gloss(row.definition))))throw Error('curated_sense_missing:'+row.lemma);
 for(const row of curation.excludedSynonyms??[])if(!row.reason.trim()||!/^https:\/\//.test(row.reference)||!entries.some(e=>usageNorm(e.display_lemma)===usageNorm(row.lemma)&&e.senses.some(s=>gloss(s.definition_en)===gloss(row.definition)))||!entries.some(e=>usageNorm(e.display_lemma)===usageNorm(row.term)&&e.senses.some(s=>gloss(s.definition_en)===gloss(row.definition))))throw Error('invalid_synonym_exclusion:'+row.lemma+':'+row.term);
 mkdirSync(out,{recursive:true});const descriptors:Record<string,{sha256:string;bytes:number;entries:number}>={};
 for(const descriptor of plan.shards){const shard=Object.fromEntries([...result].filter(([id])=>id.startsWith(descriptor.shard))),body=gzipSync(stableJson(shard),{level:9});writeFileSync(join(out,descriptor.shard+'.json.gz'),body);descriptors[descriptor.shard]={sha256:bytesHash(body),bytes:body.length,entries:Object.keys(shard).length};}
 const report={version:1,sourceRelease:plan.release,preparedPlanSha:bytesHash(planBytes),curationSha:bytesHash(curationBytes),stats,shards:descriptors};
 writeFileSync(join(out,'manifest.json'),stableJson(report)+'\n');console.log(JSON.stringify({complete:true,...stats,compressedBytes:Object.values(descriptors).reduce((n,d)=>n+d.bytes,0)}));
}
