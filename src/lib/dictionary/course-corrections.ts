import 'server-only';
import {z} from 'zod';
import {sql} from 'drizzle-orm';
import {db} from '@/db/client';
import {rows} from './store';
import {stableJson} from './model';
import {senseKeyOf} from '@/lib/services/vocabulary/dedupe';
const text=z.string().min(1).max(6000);
export const courseCorrectionSchema=z.object({id:z.string().uuid(),term:z.string().min(1).max(120),part_of_speech:z.string().nullable(),before:z.object({definition_en:z.string(),translation_uz:z.string().nullable(),sense_key:z.string().nullable(),verification_status:z.string().nullable()}).strict(),after:z.object({definition_en:text,translation_uz:text}).strict(),status:z.enum(['ai_draft','source_checked']),provenance:z.literal('course_context_editorial'),reference_url:z.string().url().optional()}).strict();
export type CourseCorrection=z.infer<typeof courseCorrectionSchema>;
/** Only the separately reviewed exact-ID patch is accepted. No spelling-based
 * rewrites, no downgrade of a newly human-verified meaning and no learner/SRS SQL. */
export async function applyCourseCorrections(input:unknown,conn:Pick<typeof db,'execute'|'transaction'>=db){
 const corrections=z.array(courseCorrectionSchema).max(500).parse(input);if(new Set(corrections.map(c=>c.id)).size!==corrections.length)throw Error('duplicate_course_correction');
 return conn.transaction(async tx=>{await tx.execute(sql`select pg_advisory_xact_lock(387384)`);let changed=0;
  for(const c of corrections){const [row]=await rows<{term:string;part_of_speech:string|null;definition_en:string;translation_uz:string|null;sense_key:string|null;verification_status:string|null}>(sql`select term,part_of_speech,definition_en,translation_uz,sense_key,verification_status from lexemes where id=${c.id}::uuid for update`,tx);if(!row||row.term!==c.term||row.part_of_speech!==c.part_of_speech)throw Error('course_correction_identity_changed');
   const key=senseKeyOf({term:c.term,partOfSpeech:c.part_of_speech,meaning:c.after.definition_en});
   if(row.definition_en===c.after.definition_en&&row.translation_uz===c.after.translation_uz&&row.sense_key===key)continue;
   const current={definition_en:row.definition_en,translation_uz:row.translation_uz,sense_key:row.sense_key,verification_status:row.verification_status};if(stableJson(current)!==stableJson(c.before)||!['unverified',null].includes(row.verification_status))throw Error('course_correction_source_changed');
   await tx.execute(sql`update lexemes set definition_en=${c.after.definition_en},translation_uz=${c.after.translation_uz},sense_key=${key},provenance='course_editorial',verification_status='unverified' where id=${c.id}::uuid`);changed++;
  }return {reviewed:corrections.length,changed,humanReviewClaimed:false};
 });
}
