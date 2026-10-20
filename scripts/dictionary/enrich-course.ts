import {addCorpusInflections} from './morphology';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {join} from 'node:path';
import {entrySchema,normalizeSearch,projectId,stableJson,sha,type Entry} from '../../src/lib/dictionary/model';
import {dictionaryPos} from '../../src/lib/dictionary/labels';
/** Material-only input: never read a database URL, users, sessions or learner rows.
 * Existing canonical sense IDs and text offsets remain the source of authority.
 * Placeholder/ambiguous data is quarantined, never promoted by a spelling match. */
const [prepared,corpusFile,out]=process.argv.slice(2);if(!prepared||!corpusFile||!out)throw Error('Usage: enrich-course.ts VERIFIED-PREPARED MATERIAL-CORPUS.json NEW-entries.json.gz');
const plan=JSON.parse(readFileSync(join(prepared,'release-plan.json'),'utf8'));
const entries:Entry[]=plan.shards.flatMap((d:{shard:string})=>JSON.parse(gunzipSync(readFileSync(join(prepared,d.shard+'.json.gz'))).toString()));
type Gloss={id:string;term:string;part_of_speech:string|null;definition_en:string;translation_uz:string|null;lexical_unit_id:string|null;provenance:string|null};
const corpus=JSON.parse(readFileSync(corpusFile,'utf8')) as {lexemes:Gloss[];texts:{source:string;id:string;body:string}[];occurrences:{lexeme_id:string;surface_form:string}[]};
const references=JSON.parse(readFileSync(new URL('../../content/dictionary/editorial-references.json',import.meta.url),'utf8')).references as {term:string;definition_en:string;translation_uz:string;url:string;part_of_speech?:string}[];
const corrections=JSON.parse(readFileSync(new URL('../../content/dictionary/context-corrections.json',import.meta.url),'utf8')).corrections as {id:string;after:{definition_en:string;translation_uz:string};status:'ai_draft'|'source_checked';reference_url?:string}[];
const byHead=new Map<string,Entry[]>();for(const e of entries){const key=normalizeSearch(e.display_lemma),list=byHead.get(key)??[];list.push(e);byHead.set(key,list);}
const byId=new Map(entries.map(e=>[e.lexeme_id,e])),quarantine:{id:string;term:string;reason:string}[]=[],mapped:{app_sense_id:string;dictionary_sense_id:string;dictionary_lexeme_id:string;status:string}[]=[];let addedEntries=0,addedSenses=0,forms=0;
const attribution={source_name:'Learners Area',snapshot_id:'course-material-20261020',creator:'Learners Area course author',source_url:'https://learnersarea.uz',license_reference:'Owner-provided course material; reuse requested by owner',license_url:'',attribution_text:'Owner-provided course glossary. Source meaning and Uzbek translation have not received an independent human editorial review. External reference URLs identify fact checks only.'};
for(const original of corpus.lexemes){const correction=corrections.find(c=>c.id===original.id),base=correction?{...original,...correction.after,provenance:'course_context_editorial'}:original,g=base.part_of_speech?base:{...base,part_of_speech:references.find(r=>normalizeSearch(r.term)===normalizeSearch(base.term))?.part_of_speech??null};const norm=normalizeSearch(g.term),definition=(g.definition_en??'').trim(),uz=(g.translation_uz??'').trim();
 if(!g.part_of_speech){quarantine.push({id:g.id,term:g.term,reason:'part_of_speech_missing'});continue;}
 if(!definition||!uz||/important expression from/i.test(definition)||/kontekst orqali o‘rganiladigan|kontekst orqali o'rganiladigan/i.test(uz)){quarantine.push({id:g.id,term:g.term,reason:'missing_or_placeholder_meaning'});continue;}
 const candidates=byHead.get(norm)??[],exact=candidates.flatMap(e=>e.senses.filter(s=>normalizeSearch(s.definition_en)===normalizeSearch(definition)).map(s=>({e,s})));
 if(exact.length===1){mapped.push({app_sense_id:g.id,dictionary_sense_id:exact[0]!.s.sense_id,dictionary_lexeme_id:exact[0]!.e.lexeme_id,status:'existing_exact_identity'});continue;}
 if(exact.length>1){quarantine.push({id:g.id,term:g.term,reason:'ambiguous_exact_identity'});continue;}
 // Unknown phrase POS remains the authored label (<=30 chars), never guessed from a translation.
 const pos=dictionaryPos(g.part_of_speech??'phrase').slice(0,30)||'phrase';
 const matching=candidates.filter(e=>dictionaryPos(e.part_of_speech)===pos);
 let entry=matching.length===1?matching[0]:g.lexical_unit_id?byId.get(g.lexical_unit_id):undefined;
 if(!entry){const lexicalType=norm.includes(' ')?'phrase':'word',id=g.lexical_unit_id??projectId('course-lexeme',[norm,pos,lexicalType].join('|'));
  if(byId.has(id))throw Error('course_lexeme_identity_conflict');
  entry={schema_version:'1.0.0',release_id:plan.expected.release,lexeme_id:id,display_lemma:g.term,normalized_search_form:norm,part_of_speech:pos,lexical_type:lexicalType,homograph_group:null,is_satellite:false,pronunciations:[],forms:[],senses:[],relations:[],collocations:[],attribution:[attribution]};entries.push(entry);byId.set(id,entry);const list=byHead.get(norm)??[];list.push(entry);byHead.set(norm,list);addedEntries++;
 }
 const ref=references.find(r=>normalizeSearch(r.term)===norm);
 // Keep the authored English/Uzbek unchanged so a checked external fact never
 // silently rewrites source identity or replaces an existing student's sense.
 const sense={sense_id:g.id,definition_en:definition,definition_uz:uz,translations:[{translation_id:projectId('course-translation',g.id),text:uz,order:0}],examples:[],editorial:{status:correction?correction.status:ref?'source_checked' as const:'owner_supplied' as const,translation_status:correction?'ai_draft' as const:'owner_supplied' as const,reference_urls:correction?.reference_url?[correction.reference_url]:ref?[ref.url]:[],provenance:g.provenance??'owner_course_material'}};
 if(entries.some(e=>e.senses.some(s=>s.sense_id===g.id)))throw Error('course_sense_identity_conflict');entry.senses.push(sense);if(!entry.attribution.some(a=>a.snapshot_id===attribution.snapshot_id))entry.attribution.push(attribution);addedSenses++;
 // Only author-bound surface variants are added; no heuristic stemming or
 // first-sense assignment from an arbitrary text token.
 for(const o of corpus.occurrences.filter(o=>o.lexeme_id===g.id)){const form=normalizeSearch(o.surface_form);if(form&&form.length<=160&&form!==norm&&!entry.forms.some(f=>normalizeSearch(f.surface_form)===form)){entry.forms.push({surface_form:o.surface_form,form_type:'authored_context_surface'});forms++;}}
 mapped.push({app_sense_id:g.id,dictionary_sense_id:g.id,dictionary_lexeme_id:entry.lexeme_id,status:sense.editorial.status});
}

const supplement=JSON.parse(readFileSync(new URL('../../content/dictionary/grammar-supplement.json',import.meta.url),'utf8')).entries as {term:string;key:string;part_of_speech:string;definition_en:string;translation_uz:string;reference_url:string}[];
const corpusTerms=new Set(corpus.texts.flatMap(t=>[...t.body.matchAll(/[A-Za-z]+(?:['’\u02bc\u02bb-][A-Za-z]+)*/g)].map(m=>normalizeSearch(m[0]))));let grammarSenses=0;
for(const g of supplement){const norm=normalizeSearch(g.term);if(!corpusTerms.has(norm))continue;const id=projectId('grammar-lexeme',norm+'|'+g.part_of_speech),senseId=projectId('grammar-sense',norm+'|'+g.part_of_speech+'|'+g.key);let entry=byId.get(id);
 if(!entry){if((byHead.get(norm)??[]).some(e=>dictionaryPos(e.part_of_speech)===g.part_of_speech))continue;
  entry={schema_version:'1.0.0',release_id:plan.expected.release,lexeme_id:id,display_lemma:g.term,normalized_search_form:norm,part_of_speech:g.part_of_speech,lexical_type:norm.includes("'")?'fixed_expression':'word',homograph_group:null,is_satellite:false,pronunciations:[],forms:[],senses:[],relations:[],collocations:[],attribution:[{...attribution,creator:'Learners Area editorial assistant',snapshot_id:'grammar-supplement-20261020',attribution_text:'Original grammar explanation. English usage checked against the linked primary reference; Uzbek translation is an AI editorial draft, not a human-reviewed dictionary translation.'}]};entries.push(entry);byId.set(id,entry);addedEntries++;
 }
 entry.senses.push({sense_id:senseId,definition_en:g.definition_en,definition_uz:g.translation_uz,translations:[{translation_id:projectId('grammar-translation',senseId),text:g.translation_uz,order:0}],examples:[],editorial:{status:'source_checked',translation_status:'ai_draft',reference_urls:[g.reference_url],provenance:'grammar_supplement'}});grammarSenses++;
}

const morphology=addCorpusInflections(entries,corpus.texts);
for(const e of entries)entrySchema.parse(e);
const value={version:1,sourceRelease:plan.expected.release,sourceInventorySha:plan.expected.entryInventorySha,corpusSha:sha(readFileSync(corpusFile,'utf8')),entries,corrections,summary:{baseEntries:plan.expected.lexemes,entries:entries.length,addedEntries,addedSenses,authorBoundForms:forms,correctedContextMeanings:corrections.length,morphology,grammarSenses,mapped: mapped.length,quarantined:quarantine.length,independentHumanReviewed:0},mappings:mapped,quarantine};
writeFileSync(out,gzipSync(Buffer.from(stableJson(value)),{level:9}),{flag:'wx'});writeFileSync(out+'.report.json',JSON.stringify({summary:value.summary,mappings:mapped,quarantine},null,2),{flag:'wx'});console.log(JSON.stringify(value.summary));
