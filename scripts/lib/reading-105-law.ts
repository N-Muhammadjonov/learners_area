import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CatalogueConnection, CatalogueGroup } from "./reading-105-catalogue";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export type LawRestoration = {
  externalId: string; originalHtmlSha256: string; bodySha256: string;
  paragraphs: { position: number; label: string; text: string }[];
  evidence: { sourceKey: string; quote: string; label: string; start: number; end: number }[];
};
export function restoredLawCatalogue(groups: CatalogueGroup[], file: string) {
  const text = readFileSync(file, "utf8");
  if (sha(text) !== "62843003fe77e53704bb2cb3ce8f2189db93a7b0693d9c988d02677c417e3fc4") throw Error("reading105_law_source_checksum_mismatch");
  const source = JSON.parse(text) as LawRestoration;
  const bodyText = source.paragraphs.map(p => p.text).join("\n\n");
  if (source.originalHtmlSha256 !== "3a777bce07f6590bdab0cc2129d5f37651622122c7188a86417a46bbf6653722" || sha(bodyText) !== source.bodySha256 || bodyText.split(/\s+/).length !== 864) throw Error("reading105_law_source_shape_mismatch");
  return groups.map(g => ({ ...g, passages: g.passages.map(p => p.externalId !== source.externalId ? p : ({
    ...p, held: false, previousBodySha256: p.bodySha256, bodySha256: source.bodySha256, bodyText, restoration: source,
  })) }));
}

const clean = (value: string) => value.replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
export type LawOccurrence = { id: string; surface_form: string; sentence_text: string | null; start_char: number; end_char: number };
/** Match original sentence anchors, never an arbitrary occurrence of a repeated word. */
export function relocateLawOccurrences(body: string, rows: LawOccurrence[]) {
  const groups = new Map<string, LawOccurrence[]>();
  for (const row of rows) {
    if (!row.sentence_text) throw Error("reading105_law_missing_sentence_anchor");
    const key = JSON.stringify([clean(row.sentence_text), row.surface_form]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].flatMap(([key, group]) => {
    const [sentence, surface] = JSON.parse(key) as [string, string];
    const start = body.indexOf(sentence);
    if (start < 0 || body.indexOf(sentence, start + 1) >= 0) throw Error("reading105_law_ambiguous_sentence_anchor");
    const positions: number[] = [];
    for (let i = sentence.toLowerCase().indexOf(surface.toLowerCase()); i >= 0; i = sentence.toLowerCase().indexOf(surface.toLowerCase(), i + surface.length)) positions.push(start + i);
    if (positions.length !== group.length) throw Error("reading105_law_ambiguous_surface_anchor");
    return group.sort((a,b) => a.start_char-b.start_char).map((row,i) => ({ id: row.id, start: positions[i]!, end: positions[i]! + surface.length, sentence }));
  });
}

/** The only content correction in the catalogue repair: an untouched, never-attempted draft. */
export async function restoreLawPassage(connection: CatalogueConnection, passageId: string, source: LawRestoration) {
  const passage = (await connection.query<{body_text:string;source_checksum:string;publication_state:string}>("select body_text,source_checksum,publication_state from reading_passages where id=$1::uuid for update",[passageId])).rows[0]!;
  const paragraphs = (await connection.query<{id:string;position:number;label:string;text:string}>("select id,position,label,text from reading_passage_paragraphs where passage_id=$1::uuid order by position for update",[passageId])).rows;
  if (passage.source_checksum !== source.originalHtmlSha256 || paragraphs.length !== 6 || paragraphs.some((p,i) => p.position !== source.paragraphs[i]!.position || p.label !== source.paragraphs[i]!.label)) throw Error("reading105_law_original_identity_mismatch");
  const already = sha(passage.body_text) === source.bodySha256 && passage.publication_state === "published";
  if (!already) {
    const used = (await connection.query<{used:boolean}>("select exists(select 1 from reading_attempts a where a.passage_id=$1::uuid union all select 1 from reading_assessment_passages m where m.passage_id=$1::uuid union all select 1 from general_reading_progress g where g.passage_id=$1::uuid) used",[passageId])).rows[0]!.used;
    if (used || passage.publication_state !== "draft") throw Error("reading105_law_draft_already_used");
  } else if (paragraphs.some((p,i) => p.text !== source.paragraphs[i]!.text)) throw Error("reading105_law_restored_paragraph_conflict");
  const body = source.paragraphs.map(p => p.text).join("\n\n");
  const occurrences = (await connection.query<LawOccurrence>("select id,surface_form,sentence_text,start_char,end_char from lexical_occurrences where passage_id=$1::uuid order by start_char for update",[passageId])).rows;
  if (occurrences.length !== 20) throw Error("reading105_law_occurrence_count_mismatch");
  const moved = relocateLawOccurrences(body,occurrences);
  const questions = (await connection.query<{id:string;source_key:string;evidence_quote:string|null;evidence_start_char:number|null;evidence_end_char:number|null}>("select id,source_key,evidence_quote,evidence_start_char,evidence_end_char from reading_questions where passage_id=$1::uuid order by \"order\" for update",[passageId])).rows;
  if (questions.length !== 13 || questions.some(q => !source.evidence.some(e => e.sourceKey===q.source_key))) throw Error("reading105_law_question_identity_mismatch");
  if (already) {
    if (moved.some(m => !occurrences.some(o=>o.id===m.id&&o.start_char===m.start&&o.end_char===m.end)) || questions.some(q=>{const e=source.evidence.find(e=>e.sourceKey===q.source_key)!;return q.evidence_quote!==e.quote||q.evidence_start_char!==e.start||q.evidence_end_char!==e.end;})) throw Error("reading105_law_restored_offsets_conflict");
    return false;
  }
  for (const p of source.paragraphs) await connection.query("update reading_passage_paragraphs set text=$1 where passage_id=$2::uuid and position=$3 and label=$4",[p.text,passageId,p.position,p.label]);
  // Park offsets within this transaction to avoid transient unique-span collisions.
  await connection.query("update lexical_occurrences set start_char=start_char+10000000,end_char=end_char+10000000 where passage_id=$1::uuid",[passageId]);
  for (const m of moved) await connection.query("update lexical_occurrences set start_char=$1,end_char=$2,sentence_text=$3 where id=$4::uuid and passage_id=$5::uuid",[m.start,m.end,m.sentence,m.id,passageId]);
  for (const q of questions) {
    const e=source.evidence.find(e=>e.sourceKey===q.source_key)!;
    await connection.query("update reading_questions set evidence_quote=$1,evidence_start_char=$2,evidence_end_char=$3,evidence_type='source_marker' where id=$4::uuid and passage_id=$5::uuid",[e.quote,e.start,e.end,q.id,passageId]);
  }
  await connection.query("update reading_passages set body_text=$1,publication_state='published' where id=$2::uuid",[body,passageId]);
  return true;
}
