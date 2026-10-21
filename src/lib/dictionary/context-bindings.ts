import "server-only";
import {z} from "zod";
import {sql} from "drizzle-orm";
import {db} from "@/db/client";
import {listeningStudySegments} from "@/lib/listening/study-segments";
import type {ListeningPackage} from "@/lib/listening/package";
import {sentenceAt} from "@/lib/services/lexical/listening-occurrences";
import {activeRelease,entriesByIds,rows} from "./store";
import {normalizeSearch,senseMeaningHash,sha,type Entry} from "./model";
import {materializeDictionarySense} from "./materialize-sense";
import {matchesDictionaryContextForm} from "./context-form";

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const spanSchema=z.object({
 start:z.number().int().nonnegative(),end:z.number().int().positive(),surface:z.string().min(1).max(120),
 entryId:z.string().uuid(),senseId:z.string().uuid(),meaningSha:digest,
 formParts:z.array(z.object({start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict()).min(2).max(8).optional(),
 // Replacing an existing authored link requires its exact previous identity.
 before:z.object({id:z.string().uuid(),lexemeId:z.string().uuid().nullable(),status:z.enum(["resolved","unresolved","review"])}).strict().optional(),
}).strict().refine(row=>row.end>row.start);
export const contextBindingSchema=z.object({
 version:z.literal(1),releaseId:z.string().min(1).max(100),reviewer:z.string().trim().min(1).max(120),
 materials:z.array(z.object({
  source:z.enum(["reading","retention","listening"]),sourceId:z.string().uuid(),bodySha:digest,
  sectionNumber:z.number().int().min(1).max(4).optional(),segmentKey:z.string().min(1).max(40).optional(),
  spans:z.array(spanSchema).min(1).max(2000),
 }).strict()).min(1).max(64),
}).strict();
export type ContextBindingPlan=z.infer<typeof contextBindingSchema>;
type Material=ContextBindingPlan["materials"][number];
type Occurrence={id:string;lexeme_id:string|null;resolution_status:"resolved"|"unresolved"|"review";start_char:number;end_char:number;surface_form:string;section_number:number|null;segment_key:string|null};
const sourcePredicate=(material:Material)=>material.source==="reading"?sql`passage_id=${material.sourceId}::uuid`:material.source==="retention"?sql`retention_text_version_id=${material.sourceId}::uuid`:sql`listening_test_id=${material.sourceId}::uuid and section_number=${material.sectionNumber!} and segment_key=${material.segmentKey!}`;

/** Import explicit, editor-selected occurrence meanings. No spelling ranking,
 * first-sense fallback, learner selection or whole-sentence sense propagation.
 * Any source, meaning, overlap or old-link mismatch aborts the entire batch. */
export async function applyContextBindings(input:unknown,conn:Pick<typeof db,"execute"|"transaction">=db){
 const plan=contextBindingSchema.parse(input);
 const identity=(m:Material)=>[m.source,m.sourceId,m.sectionNumber??"",m.segmentKey??""].join(":");
 const total=plan.materials.reduce((n,m)=>n+m.spans.length,0);
 if(total>5000||new Set(plan.materials.map(identity)).size!==plan.materials.length)throw Error("context_binding_inventory_invalid");
 for(const m of plan.materials)if(m.source==="listening"?(!m.sectionNumber||!m.segmentKey):(m.sectionNumber!==undefined||m.segmentKey!==undefined))throw Error("context_binding_segment_invalid");
 return conn.transaction(async tx=>{
  await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
  if((await activeRelease(tx)).active_release_id!==plan.releaseId)throw Error("release_mismatch");
  const ids=[...new Set(plan.materials.flatMap(m=>m.spans.map(s=>s.entryId)))];
  const entries=new Map<string,Entry>();
  for(let at=0;at<ids.length;at+=100)for(const [id,entry] of await entriesByIds(ids.slice(at,at+100),plan.releaseId,tx))entries.set(id,entry);
  const bodies=new Map<string,string>();
  const oldRows=new Map<string,Occurrence[]>();
  for(const m of [...plan.materials].sort((a,b)=>identity(a).localeCompare(identity(b)))){
   let body:string|undefined;
   if(m.source==="listening"){
    const [row]=await rows<{payload:ListeningPackage}>(sql`select payload from listening_packages where test_id=${m.sourceId}::uuid for update`,tx);
    const matches=row?listeningStudySegments(row.payload).filter(s=>s.section===m.sectionNumber&&s.key===m.segmentKey):[];
    if(matches.length===1)body=matches[0]!.text;
   }else{
    const [row]=await rows<{body_text:string}>(m.source==="reading"?sql`select body_text from reading_passages where id=${m.sourceId}::uuid for update`:sql`select body_text from retention_text_versions where id=${m.sourceId}::uuid for update`,tx);
    body=row?.body_text;
   }
   if(body===undefined||sha(body)!==m.bodySha)throw Error("context_source_changed");
   bodies.set(identity(m),body);
   const existing=await rows<Occurrence>(sql`select id,lexeme_id,resolution_status,start_char,end_char,surface_form,section_number,segment_key from lexical_occurrences where source_type=${m.source} and ${sourcePredicate(m)} for update`,tx);
   oldRows.set(identity(m),existing);
   const ordered=[...m.spans].sort((a,b)=>a.start-b.start||a.end-b.end);
   for(let i=0;i<ordered.length;i++){
    const s=ordered[i]!,entry=entries.get(s.entryId),sense=entry?.senses.find(row=>row.sense_id===s.senseId);
    if(s.end>body.length||body.slice(s.start,s.end)!==s.surface)throw Error("context_surface_changed");
    if(/[\p{L}\p{M}]/u.test(body.slice(s.start-1,s.start))||/[\p{L}\p{M}]/u.test(body.slice(s.end,s.end+1)))throw Error("context_partial_word");
    if(i&&ordered[i-1]!.end>s.start)throw Error("context_binding_overlap");
    if(!entry||!sense||senseMeaningHash(entry,sense)!==s.meaningSha)throw Error("context_meaning_changed");
    if(!matchesDictionaryContextForm(entry,s.surface,s.formParts))throw Error("context_surface_not_dictionary_form");
    if(existing.some(o=>o.start_char<s.end&&o.end_char>s.start&&(o.start_char!==s.start||o.end_char!==s.end)))throw Error("context_existing_overlap_requires_review");
   }
  }
  let inserted=0,updated=0,unchanged=0;
  const canonical=new Map<string,string>();
  for(const m of plan.materials)for(const s of m.spans){
   let appSense=canonical.get(s.senseId);
   if(!appSense){appSense=await materializeDictionarySense(tx,entries.get(s.entryId)!,s.senseId);canonical.set(s.senseId,appSense);}
   const [lexeme]=await rows<{definition_en:string;lexical_unit_id:string|null}>(sql`select definition_en,lexical_unit_id from lexemes where id=${appSense}::uuid`,tx);
   const sense=entries.get(s.entryId)!.senses.find(row=>row.sense_id===s.senseId)!;
   if(!lexeme||normalizeSearch(lexeme.definition_en)!==normalizeSearch(sense.definition_en))throw Error("context_mapped_meaning_changed");
   const existing=oldRows.get(identity(m))!.find(o=>o.start_char===s.start&&o.end_char===s.end);
   if(existing?.lexeme_id===appSense&&existing.resolution_status==="resolved"&&existing.surface_form===s.surface){unchanged++;continue;}
   const body=bodies.get(identity(m))!,sentence=sentenceAt(body,s.start,s.end);
   if(existing){
    if(!s.before||existing.id!==s.before.id||existing.lexeme_id!==s.before.lexemeId||existing.resolution_status!==s.before.status||existing.surface_form!==s.surface)throw Error("context_previous_link_changed");
    await tx.execute(sql`update lexical_occurrences set lexeme_id=${appSense}::uuid,lexical_unit_id=${lexeme.lexical_unit_id}::uuid,resolution_status='resolved',resolution_source='context_editorial',sentence_text=${sentence},is_target_vocabulary=true where id=${existing.id}::uuid`);
    updated++;
   }else{
    if(s.before)throw Error("context_previous_link_missing");
    await tx.execute(sql`insert into lexical_occurrences(source_type,passage_id,retention_text_version_id,listening_test_id,section_number,segment_key,start_char,end_char,surface_form,lexeme_id,lexical_unit_id,resolution_status,resolution_source,sentence_text,occurrence_type,is_target_vocabulary) values(${m.source},${m.source==="reading"?m.sourceId:null}::uuid,${m.source==="retention"?m.sourceId:null}::uuid,${m.source==="listening"?m.sourceId:null}::uuid,${m.sectionNumber??null},${m.segmentKey??null},${s.start},${s.end},${s.surface},${appSense}::uuid,${lexeme.lexical_unit_id}::uuid,'resolved','context_editorial',${sentence},'vocabulary',true)`);
    inserted++;
   }
  }
  return {materials:plan.materials.length,reviewedSpans:total,inserted,updated,unchanged,learnerDataChanged:false,semanticReviewAutomated:false};
 });
}
