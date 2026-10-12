import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createTestDatabase} from "./support/pglite";
import {grammarBundleSchema} from "../src/lib/grammar/import-schema";
import {importGrammarBundle} from "../src/lib/data/grammar-import";
import {ingestVideoOccurrences} from "../src/lib/services/lexical/reading-occurrences";
const original=JSON.parse(readFileSync("public/content/grammar-foundation-original.json","utf8"));
test("Grammar import previews without writes, appends original exercises atomically and refuses duplicates",async()=>{
 const bundle=grammarBundleSchema.parse(original);const d=await createTestDatabase();
 try {
  assert.deepEqual(await importGrammarBundle(bundle,true,d.db),{ok:true,dryRun:true,topics:2,exercises:4});
  assert.equal((await d.query<{n:number}>("select count(*)::int n from grammar_topics"))[0]!.n,0);
  assert.deepEqual(await importGrammarBundle(bundle,false,d.db),{ok:true,dryRun:false,topics:2,exercises:4});
  assert.deepEqual(await importGrammarBundle(bundle,false,d.db),{ok:false,error:"conflict"});
  assert.equal((await d.query<{n:number}>("select count(*)::int n from grammar_exercises where translate_prompt_uz is not null and activation_prompt is not null"))[0]!.n,4);
  const invalid=structuredClone(original);invalid.topics[0].exercises[0].correctOption="Foreign answer";
  assert.equal(grammarBundleSchema.safeParse(invalid).success,false);
  invalid.topics[0].exercises[0].sourceOwnerUserId="private-owner";
  assert.equal(grammarBundleSchema.safeParse(invalid).success,false);
 }finally{await d.close();}
});
test("Video vocabulary uses the shared canonical sense and resolves only the authored context",async()=>{
 const d=await createTestDatabase();
 try {
  const [video]=await d.query<{id:string}>("insert into video_lessons(provider,video_id,title)values('youtube','AbcDef12345','Original authored lesson')returning id");
  const entry={word:"bank",pos:"noun",def:"a financial institution",uz:"bank",ex:"She saved her money in the bank."};
  const body=entry.ex+"\nThey sat on the river bank.";
  await d.db.transaction(tx=>ingestVideoOccurrences(tx,video!.id,body,[entry,entry]));
  const rows=await d.query<{source_type:string;passage_id:string|null;video_lesson_id:string;resolution_status:string;sentence_text:string}>("select * from lexical_occurrences order by start_char");
  assert.equal(rows.length,2);assert.equal(rows[0]!.source_type,"video");assert.equal(rows[0]!.passage_id,null);
  assert.equal(rows[0]!.video_lesson_id,video!.id);assert.equal(rows[0]!.resolution_status,"resolved");
  assert.equal(rows[1]!.resolution_status,"unresolved");
  assert.equal((await d.query<{n:number}>("select count(*)::int n from lexemes"))[0]!.n,1);
  assert.equal((await d.query<{n:number}>("select count(*)::int n from lexical_units"))[0]!.n,1);
 }finally{await d.close();}
});
