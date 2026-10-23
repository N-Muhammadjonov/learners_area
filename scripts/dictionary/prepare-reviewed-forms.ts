/** Prepares explicit, source-checked surface forms locally; never publishes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync,gzipSync} from 'node:zlib';
import {join} from 'node:path';
import {z} from 'zod';
import {decodeShard,type ShardDescriptor} from '../../src/lib/dictionary/shards';
import {entrySchema,entryContentHash,normalizeSearch,stableJson,type Entry} from '../../src/lib/dictionary/model';
const [prepared,input,draftPath,out]=process.argv.slice(2);
if(!prepared||!input||!draftPath||!out)throw Error('Usage: prepare-reviewed-forms.ts PREPARED ADDITIONS.gz DRAFT NEW-OUTPUT.gz');
const draft=z.object({version:z.literal(1),status:z.literal('ai_editorial_draft_not_published'),rows:z.array(z.object({entryId:z.string().uuid(),beforeEntrySha:z.string().regex(/^[a-f0-9]{64}$/),lemma:z.string().min(1),forms:z.array(z.string().trim().min(1).max(120)).min(1).max(30),referenceUrl:z.string().url(),reason:z.string().min(1)}).strict())}).strict().parse(JSON.parse(readFileSync(draftPath,'utf8')));
const plan=JSON.parse(readFileSync(join(prepared,'release-plan.json'),'utf8'));
const entries=new Map<string,Entry>(plan.shards.flatMap((d:ShardDescriptor)=>[...decodeShard(plan.release,d,readFileSync(join(prepared,'shards',d.shard+'.json.gz')))]));
if(entries.size!==plan.expected.lexemes)throw Error('complete_source_required');
const candidate=JSON.parse(gunzipSync(readFileSync(input)).toString()) as {report:Record<string,unknown>;entries:Entry[]};
if(candidate.report.sourceRelease!==plan.release)throw Error('supplement_release_mismatch');
const additions=new Map(candidate.entries.map(e=>{entrySchema.parse(e);return[e.lexeme_id,e]as const;}));
if(additions.size!==candidate.entries.length)throw Error('duplicate_candidate_identity');
for(const e of additions.values()){if(e.release_id!==plan.release)throw Error('candidate_entry_release_mismatch');entries.set(e.lexeme_id,e);}
let addedForms=0;const seen=new Set<string>();
for(const row of draft.rows){
 if(seen.has(row.entryId))throw Error('duplicate_form_revision');seen.add(row.entryId);
 const entry=entries.get(row.entryId);
 if(!entry||entry.display_lemma!==row.lemma||entryContentHash(entry)!==row.beforeEntrySha)throw Error('form_revision_identity_changed');
 const forms=[...entry.forms],norms=new Set(forms.map(f=>normalizeSearch(f.surface_form)));
 for(const form of row.forms){const norm=normalizeSearch(form);if(norm===entry.normalized_search_form||norms.has(norm))throw Error('duplicate_reviewed_form');norms.add(norm);forms.push({surface_form:form,form_type:'explicit_source_checked_form'});addedForms++;}
 const revised=entrySchema.parse({...entry,forms});
 if(stableJson({...revised,forms:entry.forms})!==stableJson(entry))throw Error('non_form_fields_changed');
 entries.set(revised.lexeme_id,revised);additions.set(revised.lexeme_id,revised);
}
const report={...candidate.report,reviewedFormHeads:draft.rows.length,reviewedForms:addedForms,sourceEnglishMeaningsChanged:0,historicalReleaseChanged:false,published:false};
writeFileSync(out,gzipSync(stableJson({report,entries:[...additions.values()]})),{flag:'wx'});
writeFileSync(out+'.report.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report));
