import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { createTestDatabase } from "./support/pglite";
import { reading105Catalogue, type CatalogueConnection } from "../scripts/lib/reading-105-catalogue";
import { restoredLawCatalogue, restoreLawPassage, relocateLawOccurrences } from "../scripts/lib/reading-105-law";

const archive = "data/import-sources/learnersarea_reading_105.zip";
const corrected = () => restoredLawCatalogue(reading105Catalogue(archive),"data/import-sources/reading-105-law-restored.json").flatMap(g=>g.passages).find(p=>p.restoration)!;

test("The importance of law full original matches its existing SHA; all 13 original evidence markers are present", () => {
  const p=corrected();
  assert.equal(p.held,false); assert.equal(p.questionCount,13); assert.equal(p.wordCount,892);
  assert.equal(p.bodyText.split(/\s+/).length,864,"full original falls within the original importer's 5% word-count tolerance");
  assert.equal(p.restoration!.originalHtmlSha256,"3a777bce07f6590bdab0cc2129d5f37651622122c7188a86417a46bbf6653722");
  for(const e of p.restoration!.evidence){const paragraph=p.restoration!.paragraphs.find(p=>p.label===e.label)!;assert.equal(paragraph.text.slice(e.start,e.end),e.quote);}
  assert.throws(()=>relocateLawOccurrences(p.bodyText,[{id:'x',surface_form:'law',sentence_text:null,start_char:0,end_char:3}]),/missing_sentence_anchor/);
});

test("Full law restoration repairs text and all vocabulary spans in place; draft usage fails closed and repeated restoration is read-only", async () => {
  const env=await createTestDatabase();
  const connection:CatalogueConnection={query:async(text,params)=>({rows:await env.query(text,params)})};
  try{
    const old=reading105Catalogue(archive).flatMap(g=>g.passages).find(p=>p.held)!;
    const full=corrected(),source=full.restoration!;
    const [user]=await env.query<{id:string}>("insert into users(name) values('Student') returning id");
    const [p]=await env.query<{id:string}>("insert into reading_passages(title,external_id,body_text,publication_state,source_checksum) values($1,$2,$3,'draft',$4) returning id",[old.title,old.externalId,old.bodyText,source.originalHtmlSha256]);
    for(const [i,text] of old.bodyText.split('\n\n').entries())await env.query("insert into reading_passage_paragraphs(passage_id,position,label,text) values($1,$2,$3,$4)",[p!.id,i+1,String.fromCharCode(65+i),text]);
    await env.query("insert into reading_questions(passage_id,\"order\",question_no,source_key,type,question_text,correct_answer,explanation) select $1::uuid,n,n,'q'||n,'short_answer','Fixture question','fixture answer','' from generate_series(1,13) n",[p!.id]);
    const member="learnersarea_reading_supabase_ready_v1/data/reading_bundle_01_105.json";
    const bundle=JSON.parse(strFromU8(unzipSync(readFileSync(archive),{filter:e=>e.name===member})[member]!)) as {lexical_occurrences:{content_item_ref:string;surface_form:string;sentence_text:string;start_char:number;end_char:number}[]};
    const occurrences=bundle.lexical_occurrences.filter(o=>o.content_item_ref==='3d0a6e79-d051-5572-b172-697a22096396');
    assert.equal(occurrences.length,20);
    for(const o of occurrences)await env.query("insert into lexical_occurrences(passage_id,surface_form,sentence_text,start_char,end_char,resolution_status) values($1,$2,$3,$4,$5,'unresolved')",[p!.id,o.surface_form,o.sentence_text,o.start_char,o.end_char]);
    const originals=await env.query<{id:string;surface_form:string}>("select * from lexical_occurrences where passage_id=$1 order by id",[p!.id]);
    const paragraphIds=await env.query("select id from reading_passage_paragraphs where passage_id=$1 order by position",[p!.id]);
    const questionIds=await env.query("select id,question_text,correct_answer,accepted_answers from reading_questions where passage_id=$1 order by \"order\"",[p!.id]);
    const [attempt]=await env.query<{id:string}>("insert into reading_attempts(user_id,passage_id) values($1,$2) returning id",[user!.id,p!.id]);
    await connection.query('begin');
    await assert.rejects(restoreLawPassage(connection,p!.id,source),/draft_already_used/);
    await connection.query('rollback');
    assert.equal((await env.query<{body_text:string}>("select body_text from reading_passages where id=$1",[p!.id]))[0]!.body_text,old.bodyText);
    await env.query("delete from reading_attempts where id=$1",[attempt!.id]);
    await connection.query('begin');assert.equal(await restoreLawPassage(connection,p!.id,source),true);await connection.query('commit');
    const [published]=await env.query<{body_text:string;publication_state:string}>("select body_text,publication_state from reading_passages where id=$1",[p!.id]);
    assert.equal(published!.body_text,full.bodyText);assert.equal(published!.publication_state,'published');
    assert.deepEqual(await env.query("select id from reading_passage_paragraphs where passage_id=$1 order by position",[p!.id]),paragraphIds);
    assert.deepEqual(await env.query("select id,question_text,correct_answer,accepted_answers from reading_questions where passage_id=$1 order by \"order\"",[p!.id]),questionIds);
    const moved=await env.query<{id:string;surface_form:string;start_char:number;end_char:number}>("select * from lexical_occurrences where passage_id=$1 order by id",[p!.id]);
    assert.deepEqual(moved.map(o=>[o.id,o.surface_form]),originals.map(o=>[o.id,o.surface_form]));
    for(const o of moved)assert.equal(full.bodyText.slice(o.start_char,o.end_char).toLowerCase(),o.surface_form.toLowerCase());
    const check=await env.query<{evidence_quote:string}>("select evidence_quote from reading_questions where passage_id=$1",[p!.id]);
    assert.equal(check.filter(q=>q.evidence_quote&&full.bodyText.includes(q.evidence_quote)).length,13);
    await connection.query('begin');assert.equal(await restoreLawPassage(connection,p!.id,source),false);await connection.query('commit');
  }finally{await env.close();}
});
