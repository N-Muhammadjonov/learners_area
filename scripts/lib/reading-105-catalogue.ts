import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

export const READING_105_SHA256 = "d736cd4bada0f55309a498116e0e408dd64306ad22779d3ba306a20d01529dd6";
const HELD = "t29-p2-the-importance-of-law";
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
type Item = { ref: string; external_id: string; title: string; metadata: { test_no: number | null } };
type SourcePassage = { ref: string; content_item_ref: string; test_ref: string | null; passage_no: number; source_question_count: number; source_word_count: number };
type Bundle = {
  content_items: Item[];
  reading_tests: { ref: string; external_test_no: number }[];
  reading_passages: SourcePassage[];
  content_segments: { ref: string; content_item_ref: string; segment_type: string; position: number; text: string }[];
  reading_paragraphs: { passage_ref: string; segment_ref: string; paragraph_label: string | null }[];
  assessment_questions: { content_item_ref: string }[];
};
export type CataloguePassage = {
  externalId: string; title: string; testNo: number | null; passageNo: number;
  questionCount: number; wordCount: number; bodyText: string; bodySha256: string; held: boolean;
};
export type CatalogueGroup = { sourceRef: string; title: string; passages: CataloguePassage[] };

/** Read only the reviewed source. No DB connection, inference of extra tests, or text repair. */
export function reading105Catalogue(source: string): CatalogueGroup[] {
  const zip = readFileSync(source);
  if (createHash("sha256").update(zip).digest("hex") !== READING_105_SHA256) throw Error("reading105_source_checksum_mismatch");
  const member = "learnersarea_reading_supabase_ready_v1/data/reading_bundle_01_105.json";
  const data = unzipSync(zip, { filter: entry => entry.name === member });
  const bundle = JSON.parse(strFromU8(data[member]!)) as Bundle;
  if (bundle.reading_passages.length !== 105 || bundle.reading_tests.length !== 33) throw Error("reading105_source_shape_mismatch");
  const groups: CatalogueGroup[] = bundle.reading_tests.map(test => ({
    sourceRef: `reading105:test:${String(test.external_test_no).padStart(2, "0")}`,
    title: `Reading Test ${test.external_test_no}`, passages: [],
  }));
  const byTest = new Map(bundle.reading_tests.map((test, i) => [test.ref, groups[i]!]));
  for (const row of bundle.reading_passages) {
    const item = bundle.content_items.find(item => item.ref === row.content_item_ref)!;
    const body = bundle.content_segments.filter(s => s.content_item_ref === item.ref && ["paragraph", "heading", "footnote"].includes(s.segment_type))
      .sort((a, b) => a.position - b.position).map(segment => {
        let text = segment.text.trim();
        const label = bundle.reading_paragraphs.find(p => p.passage_ref === row.ref && p.segment_ref === segment.ref)?.paragraph_label;
        if (!label) text = text.replace(/^[A-Z]\s+(?=\S)/, "").trim();
        return text;
      }).filter(Boolean).join("\n\n");
    const count = bundle.assessment_questions.filter(q => q.content_item_ref === item.ref).length;
    if (count !== row.source_question_count) throw Error(`reading105_question_count:${item.external_id}`);
    let group = row.test_ref ? byTest.get(row.test_ref) : undefined;
    if (row.test_ref && !group) throw Error("reading105_unknown_source_test");
    if (!group) {
      group = { sourceRef: `reading105:standalone:${item.ref}`, title: item.title, passages: [] };
      groups.push(group);
    }
    group.passages.push({ externalId: item.external_id, title: item.title, testNo: item.metadata.test_no ?? null,
      passageNo: row.passage_no, questionCount: count, wordCount: row.source_word_count, bodyText: body, bodySha256: digest(body), held: item.external_id === HELD });
  }
  if (groups.length !== 39 || new Set(groups.flatMap(g => g.passages.map(p => p.externalId))).size !== 105) throw Error("reading105_group_shape_mismatch");
  return groups;
}

export interface CatalogueConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

/** Link existing canonical IDs only. Any identity/membership conflict aborts the whole transaction. */
export async function repairReading105Catalogue(connection: CatalogueConnection, ownerId: string, groups: CatalogueGroup[], apply: boolean) {
  await connection.query("begin isolation level repeatable read");
  try {
    await connection.query("select pg_advisory_xact_lock(hashtext('reading105:catalogue:v1'))");
    const owner = await connection.query("select id from users where id=$1::uuid and role='owner' and account_status='active' for share", [ownerId]);
    if (owner.rows.length !== 1) throw Error("reading105_active_owner_required");
    const rows = (await connection.query<{ id: string; external_id: string; title: string; test_no: number | null; passage_no: number; source_word_count: number; body_text: string; publication_state: string; question_count: number }>(
      `select p.*,(select count(*)::int from reading_questions q where q.passage_id=p.id) question_count from reading_passages p where p.external_id=any($1::text[]) for share`,
      [groups.flatMap(g => g.passages.map(p => p.externalId))])).rows;
    const byExternal = new Map(rows.map(row => [row.external_id, row]));
    if (rows.length !== 105 || byExternal.size !== 105) throw Error("reading105_existing_passages_required");
    // Validate ALL originals, including the held draft, before creating any catalogue row.
    for (const source of groups.flatMap(g => g.passages)) {
      const row = byExternal.get(source.externalId)!;
      if (!row || row.title !== source.title || row.test_no !== source.testNo || row.passage_no !== source.passageNo || row.source_word_count !== source.wordCount || row.question_count !== source.questionCount || digest(row.body_text) !== source.bodySha256) throw Error(`reading105_identity_mismatch:${source.externalId}`);
      if (source.held ? row.publication_state !== "draft" : row.publication_state !== "published") throw Error(`reading105_publication_mismatch:${source.externalId}`);
    }
    let createdSets = 0, linked = 0;
    const held: string[] = [];
    const sets: { id: string; sourceRef: string; linked: number; questions: number; academic: boolean }[] = [];
    for (const group of groups) {
      const found = (await connection.query<{ id: string; title: string; publication_state: string }>("select id,title,publication_state from general_reading_sets where source_ref=$1 for update", [group.sourceRef])).rows;
      if (found.length > 1 || found.some(s => s.title !== group.title || s.publication_state !== "published")) throw Error(`reading105_set_conflict:${group.sourceRef}`);
      let setId = found[0]?.id;
      if (!setId) {
        const created = await connection.query<{ id: string }>("insert into general_reading_sets(title,source_ref,publication_state) values($1,$2,'published') returning id", [group.title, group.sourceRef]);
        setId = created.rows[0]!.id;
        createdSets++;
      }
      const allowed = group.passages.filter(p => !p.held);
      for (const passage of group.passages) {
        const row = byExternal.get(passage.externalId)!;
        const membership = (await connection.query<{ set_id: string; passage_no: number; reading_mode: string }>("select set_id,passage_no,reading_mode from general_reading_passages where passage_id=$1::uuid", [row.id])).rows[0];
        if (passage.held) {
          if (membership) throw Error("reading105_held_passage_has_membership");
          held.push(passage.externalId);
          continue;
        }
        if (membership) {
          if (membership.set_id !== setId || membership.passage_no !== passage.passageNo || membership.reading_mode !== "general_practice") throw Error(`reading105_membership_conflict:${passage.externalId}`);
        } else {
          await connection.query("insert into general_reading_passages(passage_id,set_id,passage_no) values($1::uuid,$2::uuid,$3)", [row.id, setId, passage.passageNo]);
          linked++;
        }
      }
      const members = (await connection.query<{ passage_id: string }>("select passage_id from general_reading_passages where set_id=$1::uuid", [setId])).rows;
      if (members.length !== allowed.length || members.some(m => !allowed.some(p => byExternal.get(p.externalId)!.id === m.passage_id))) throw Error(`reading105_unexpected_set_membership:${group.sourceRef}`);
      const questions = allowed.reduce((n, p) => n + p.questionCount, 0);
      sets.push({ id: setId, sourceRef: group.sourceRef, linked: members.length, questions, academic: members.length === 3 && questions === 40 });
    }
    const result = { applied: apply, sourceSha256: READING_105_SHA256, createdSets, linked, totalSets: sets.length, totalLinked: sets.reduce((n, s) => n + s.linked, 0), academicSets: sets.filter(s => s.academic).length, held, sets };
    if (result.totalLinked !== 104 || result.academicSets !== 28) throw Error("reading105_result_shape_mismatch");
    if (apply && (createdSets || linked)) await connection.query("insert into audit_log(actor_user_id,action,metadata) values($1::uuid,'reading105.catalogue_repair',$2::jsonb)", [ownerId, JSON.stringify(result)]);
    await connection.query(apply ? "commit" : "rollback");
    return result;
  } catch (error) {
    await connection.query("rollback");
    throw error;
  }
}
