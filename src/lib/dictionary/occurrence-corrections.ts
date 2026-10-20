import "server-only";
import {z} from "zod";
import {sql} from "drizzle-orm";
import {db} from "@/db/client";
import {rows} from "./store";
import {sha} from "./model";
import {recoverReadingOffset} from "@/lib/services/lexical/recover-reading-offset";

const offsets = z.object({start:z.number().int().nonnegative(),end:z.number().int().positive()}).strict().refine(value=>value.end>value.start);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuidArray=(ids:string[])=>sql`ARRAY[${sql.join(ids.map(id=>sql`${id}::uuid`),sql`, `)}]::uuid[]`;
export const occurrenceCorrectionSchema = z.object({
  version:z.literal(1),passages:z.array(z.object({id:z.string().uuid(),bodySha:digest,corrections:z.array(z.object({
    id:z.string().uuid(),lexemeId:z.string().uuid(),surface:z.string().min(1).max(120),sentenceSha:digest,before:offsets,after:offsets,
  }).strict()).min(1).max(1000)}).strict()).max(200),
}).strict();

/** Exact-ID, source-hash guarded recovery. No sense/meaning, saved word, context
 * ID, grading or SRS changes; collisions/source edits abort the entire batch. */
export async function applyOccurrenceCorrections(input:unknown,conn:Pick<typeof db,"execute"|"transaction">=db) {
  const plan=occurrenceCorrectionSchema.parse(input),patches=plan.passages.flatMap(p=>p.corrections.map(c=>({...c,passageId:p.id})));
  if(patches.length>5000 || new Set(plan.passages.map(p=>p.id)).size!==plan.passages.length || new Set(patches.map(c=>c.id)).size!==patches.length)throw Error("invalid_occurrence_correction_inventory");
  return conn.transaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(387384)`);
    const sources=new Map((await rows<{id:string;body_text:string}>(sql`select id,body_text from reading_passages where id=any(${uuidArray(plan.passages.map(p=>p.id))}) for update`,tx)).map(p=>[p.id,p.body_text]));
    for(const p of plan.passages)if(!sources.has(p.id)||sha(sources.get(p.id)!)!==p.bodySha)throw Error("occurrence_source_changed");
    const existing=await rows<{id:string;passage_id:string;lexeme_id:string|null;source_type:string;start_char:number;end_char:number;surface_form:string;sentence_text:string|null;resolution_status:string}>(sql`select id,passage_id,lexeme_id,source_type,start_char,end_char,surface_form,sentence_text,resolution_status from lexical_occurrences where passage_id=any(${uuidArray(plan.passages.map(p=>p.id))}) for update`,tx);
    const byId=new Map(existing.map(o=>[o.id,o])),pending:typeof patches=[];
    for(const c of patches){
      const o=byId.get(c.id),body=sources.get(c.passageId)!;
      if(!o||o.passage_id!==c.passageId||o.source_type!=="reading"||o.lexeme_id!==c.lexemeId||o.resolution_status!=="resolved"||o.surface_form!==c.surface||sha(o.sentence_text??"")!==c.sentenceSha)throw Error("occurrence_identity_changed");
      const proven=recoverReadingOffset(body,{startChar:c.before.start,endChar:c.before.end,surfaceForm:o.surface_form,sentenceText:o.sentence_text});
      if(!proven||proven.startChar!==c.after.start||proven.endChar!==c.after.end||body.slice(c.after.start,c.after.end).toLowerCase()!==c.surface.toLowerCase())throw Error("occurrence_context_not_proven");
      if(o.start_char===c.after.start&&o.end_char===c.after.end)continue;
      if(o.start_char!==c.before.start||o.end_char!==c.before.end)throw Error("occurrence_offset_changed");
      pending.push(c);
    }
    const targets=new Map(patches.map(c=>[c.id,`${c.passageId}:${c.after.start}:${c.after.end}`]));
    const occupied=new Set<string>();
    for(const o of existing){const target=targets.get(o.id)??`${o.passage_id}:${o.start_char}:${o.end_char}`;if(occupied.has(target))throw Error("occurrence_target_collision");occupied.add(target);}
    if(pending.length){
      // Stage temporary, non-overlapping positive offsets INSIDE this locked
      // transaction, then install final offsets. Readers see only before/after;
      // this avoids immediate unique-index conflicts when old offsets overlap.
      const temporaryBase=Math.max(0,...existing.map(o=>o.end_char))+1;
      if(temporaryBase+pending.length*128>2147483647)throw Error("occurrence_offset_budget_exceeded");
      const values=pending.map((c,index)=>({id:c.id,start:c.after.start,end:c.after.end,temp:temporaryBase+index*128}));
      const json=JSON.stringify(values);
      await tx.execute(sql`update lexical_occurrences o set start_char=p.temp,end_char=p.temp+length(o.surface_form) from jsonb_to_recordset(${json}::jsonb) as p(id uuid,start integer,"end" integer,temp integer) where o.id=p.id`);
      await tx.execute(sql`update lexical_occurrences o set start_char=p.start,end_char=p."end" from jsonb_to_recordset(${json}::jsonb) as p(id uuid,start integer,"end" integer,temp integer) where o.id=p.id`);
    }
    return {reviewed:patches.length,changed:pending.length,sensesUnchanged:true,learnerDataUnchanged:true,humanSemanticReviewClaimed:false};
  });
}
