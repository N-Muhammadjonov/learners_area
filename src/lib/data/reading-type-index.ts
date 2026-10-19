import { activateReadingSchedules } from "@/lib/services/reading/schedules";
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { questionType, questionTypesFor, resolveQuestionType } from "@/lib/content/question-types";

export const READING_TYPE_PAGE_SIZE = 24;
// Compatibility projection for historical source codes, generated from the canonical registry.
// Canonical IDs win first; aliases never become extra learner products.
export function readingCanonicalTypeSql() {
  const types = questionTypesFor("reading");
  const codes = [...new Set(types.flatMap(type => [type.id, ...type.importShapes]))];
  const cases = codes.map(code => {
    const descriptor = questionType(code, "reading") ?? resolveQuestionType(code, "reading");
    return sql`when ${code.toLowerCase()} then ${descriptor!.id}`;
  });
  const ternary=types.filter(t=>t.answerModel.kind==='ternary').flatMap(t=>[t.id,...t.importShapes]);
  const authored=sql`(select array_agg(distinct upper(regexp_replace(v,'[[:space:]]+','_','g')) order by upper(regexp_replace(v,'[[:space:]]+','_','g'))) from jsonb_array_elements_text(case when jsonb_typeof(q.answer_constraint->'allowed_values')='array' then q.answer_constraint->'allowed_values' else '[]'::jsonb end) v)`;
  const isTernary=sql`lower(coalesce(q.type_code,q.type::text)) in (${sql.join(ternary.map(code=>sql`${code.toLowerCase()}`),sql`,`)})`;
  return sql`case when ${isTernary} and ${authored}=array['NO','NOT_GIVEN','YES'] then 'yes_no_not_given'
    when ${isTernary} and ${authored}=array['FALSE','NOT_GIVEN','TRUE'] then 'true_false_not_given'
    else case lower(coalesce(q.type_code, q.type::text)) ${sql.join(cases, sql` `)} else null end end`;
}
const live = sql`p.publication_state = 'published' or (p.publication_state = 'scheduled' and p.publish_at <= now())`;
const accessible = sql`(${live}) and not exists (
  select 1 from general_reading_passages gp join general_reading_sets gs on gs.id=gp.set_id
  where gp.passage_id=p.id and not (gs.publication_state='published' or (gs.publication_state='scheduled' and gs.publish_at<=now())))`;
export async function readingTypeFacets(executor: typeof db = db) {
  await activateReadingSchedules(executor);
  const result = await executor.execute<{ type: string; count: number }>(sql`
    select ${readingCanonicalTypeSql()} as type, count(distinct p.id)::int as count
    from reading_passages p join reading_questions q on q.passage_id=p.id
    where ${accessible} group by 1`);
  return questionTypesFor("reading").flatMap(type => {
    const count = result.rows.find(row => row.type === type.id)?.count ?? 0;
    return count > 0 ? [{ ...type, count }] : [];
  });
}
export async function readingTypePassages(type: string, page = 1, executor: typeof db = db) {
  if (!questionType(type, "reading")) return [];
  await activateReadingSchedules(executor);
  const offset = (Math.max(1, Math.min(10000, Math.floor(page) || 1)) - 1) * READING_TYPE_PAGE_SIZE;
  const result = await executor.execute<{ id: string; title: string; set_id: string | null; passage_no: number | null }>(sql`
    select p.id,p.title,g.set_id,g.passage_no from reading_passages p
    left join general_reading_passages g on g.passage_id=p.id
    where ${accessible} and exists (select 1 from reading_questions q where q.passage_id=p.id and ${readingCanonicalTypeSql()}=${type})
    order by p.created_at,p.id limit ${READING_TYPE_PAGE_SIZE + 1} offset ${offset}`);
  return result.rows;
}
