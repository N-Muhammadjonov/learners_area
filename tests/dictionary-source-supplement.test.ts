import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {gunzipSync,gzipSync} from "node:zlib";
import {zipSync,strToU8} from "fflate";
import {applyDraft,entryContentHash,type Entry} from "../src/lib/dictionary/model";
import {encodeShard,bytesHash} from "../src/lib/dictionary/shards";
import {matchesDictionaryContextForm} from "../src/lib/dictionary/context-form";
test("source supplements verify source and target identities and append a sense without rewriting historical meanings",()=>{
 const dir=mkdtempSync(join(tmpdir(),"dictionary-supplement-")),release="rel-v1-111111111111111111111111";
 try{
  const before=applyDraft([],{operation:"add_lexeme",lemma:"reflectivity",partOfSpeech:"n",lexicalType:"word",definitionEn:"Quiet thought",definitionUz:"O‘y",translationUz:"o‘y",examples:[]},release);
  const shard=encodeShard(release,[before],true);mkdirSync(join(dir,"shards"));writeFileSync(join(dir,"shards",shard.descriptor.shard+".json.gz"),shard.body);
  writeFileSync(join(dir,"release-plan.json"),JSON.stringify({release,expected:{lexemes:1},shards:[shard.descriptor]}));
  const archive=zipSync({"fixture/noun.attribute.json":strToU8(JSON.stringify({"test-n":{definition:["The fraction of light reflected"],members:["reflectivity"],partOfSpeech:"n"}}))});
  writeFileSync(join(dir,"source.zip"),archive);
  const draft={sourceArchiveSha256:bytesHash(archive),sourceLicense:"CC-BY-4.0",sourceUrl:"https://example.test/source.zip",entries:[{lemma:"reflectivity",pos:"n",synsetId:"test-n",translationUz:"Yorug‘likni qaytarish koeffitsiyenti",exampleEn:"We measured the reflectivity.",exampleUz:"Biz yorug‘likni qaytarish koeffitsiyentini o‘lchadik.",collocations:["surface reflectivity"],targetLexemeId:before.lexeme_id,expectedEntrySha:entryContentHash(before)}]};
  const run=(value:typeof draft,name:string)=>{writeFileSync(join(dir,"draft.json"),JSON.stringify(value));return spawnSync(process.execPath,["--conditions=react-server","--import","tsx","scripts/dictionary/prepare-source-supplement.ts",dir,join(dir,"source.zip"),join(dir,"draft.json"),join(dir,name)],{cwd:process.cwd(),encoding:"utf8"});};
  const success=run(draft,"candidate.gz");assert.equal(success.status,0,success.stderr);
  const output=JSON.parse(gunzipSync(readFileSync(join(dir,"candidate.gz"))).toString()) as {report:{published:boolean;addedEntries:number;additiveExistingEntries:number};entries:Entry[]};
  assert.equal(output.report.published,false);assert.equal(output.report.addedEntries,0);assert.equal(output.report.additiveExistingEntries,1);
  assert.equal(output.entries[0]!.lexeme_id,before.lexeme_id);assert.deepEqual(output.entries[0]!.senses.find(s=>s.sense_id===before.senses[0]!.sense_id),before.senses[0]);assert.equal(output.entries[0]!.senses.length,2);
  const badArchive=run({...draft,sourceArchiveSha256:"0".repeat(64)},"bad-archive.gz");assert.notEqual(badArchive.status,0);assert.match(badArchive.stderr,/source_identity_mismatch/);assert.equal(existsSync(join(dir,"bad-archive.gz")),false);
  const stale=structuredClone(draft);stale.entries[0]!.expectedEntrySha="0".repeat(64);const badTarget=run(stale,"stale.gz");assert.notEqual(badTarget.status,0);assert.match(badTarget.stderr,/explicit_sense_revision/);assert.equal(existsSync(join(dir,"stale.gz")),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("context supplements keep explicit plural noun-phrase forms for examples and exact occurrence links",()=>{
 const dir=mkdtempSync(join(tmpdir(),"dictionary-context-supplement-")),release="rel-v1-111111111111111111111111";
 try{
  writeFileSync(join(dir,"release-plan.json"),JSON.stringify({release,expected:{lexemes:0},shards:[]}));
  writeFileSync(join(dir,"source.gz"),gzipSync(JSON.stringify({report:{sourceRelease:release},entries:[]})));
  writeFileSync(join(dir,"corpus.json"),JSON.stringify({texts:[]}));
  const row={lemma:"changing room",pos:"n",key:"sports-clothes",definitionEn:"A room for changing clothes.",translationUz:"Kiyim almashtirish xonasi",exampleEn:"The changing rooms were near the pool.",exampleUz:"Kiyim almashtirish xonalari hovuz yaqinida edi.",usageFrames:["the changing rooms"],referenceUrl:"https://example.test/source"};
  const run=(entry:unknown,out:string)=>{writeFileSync(join(dir,"draft.json"),JSON.stringify({version:1,status:"ai_editorial_draft_not_published",policy:"Original fixture",entries:[entry]}));return spawnSync(process.execPath,["--conditions=react-server","--import","tsx","scripts/dictionary/prepare-context-supplement.ts",dir,join(dir,"source.gz"),join(dir,"corpus.json"),join(dir,"draft.json"),join(dir,out)],{cwd:process.cwd(),encoding:"utf8"});};
  const missing=run(row,"missing.gz");assert.notEqual(missing.status,0);assert.match(missing.stderr,/example_missing_head/);assert.equal(existsSync(join(dir,"missing.gz")),false);
  const valid=run({...row,forms:["changing rooms"]},"valid.gz");assert.equal(valid.status,0,valid.stderr);
  const output=JSON.parse(gunzipSync(readFileSync(join(dir,"valid.gz"))).toString()) as {entries:Entry[]};
  const entry=output.entries[0]!;
  assert.equal(matchesDictionaryContextForm(entry,"changing rooms"),true);
  assert.equal(matchesDictionaryContextForm(entry,"changing room"),true);
  assert.equal(matchesDictionaryContextForm(entry,"change rooms"),false);
  assert.deepEqual(entry.forms,[{surface_form:"changing rooms",form_type:"authored_context_form"}]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("multiple context meanings use immutable input guards and retain source-added senses",()=>{
 const dir=mkdtempSync(join(tmpdir(),"dictionary-context-many-senses-")),release="rel-v1-111111111111111111111111";
 try{
  const original=applyDraft([],{operation:"add_lexeme",lemma:"return",partOfSpeech:"n",lexicalType:"word",definitionEn:"A journey back.",definitionUz:"Qaytish",translationUz:"qaytish",examples:[]},release);
  const source=structuredClone(original);
  const homograph={...structuredClone(original),lexeme_id:original.lexeme_id.slice(0,2)+"459073-4bef-4449-bf52-3f47412c91af",senses:[{...structuredClone(original.senses[0]!),sense_id:"14c73c50-efc0-4f4f-ab4c-9c065362f5c3",definition_en:"An unrelated homograph meaning."}]};
  source.senses.push({...structuredClone(source.senses[0]!),sense_id:"9d22dbba-6742-4d16-9a75-36142fe46472",definition_en:"A historical source meaning.",editorial:{status:"source_checked",translation_status:"ai_draft",reference_urls:["https://example.test/source"],provenance:"fixture-source"}});
  const shard=encodeShard(release,[original,homograph],true);mkdirSync(join(dir,"shards"));writeFileSync(join(dir,"shards",shard.descriptor.shard+".json.gz"),shard.body);
  writeFileSync(join(dir,"release-plan.json"),JSON.stringify({release,expected:{lexemes:2},shards:[shard.descriptor]}));
  writeFileSync(join(dir,"source.gz"),gzipSync(JSON.stringify({report:{sourceRelease:release},entries:[source]})));
  writeFileSync(join(dir,"corpus.json"),JSON.stringify({texts:[]}));
  const row={lemma:"return",pos:"n",key:"commercial-process",definitionEn:"The act of sending a bought item back to a seller.",translationUz:"Xarid qilingan mahsulotni sotuvchiga qaytarish",exampleEn:"The return was free.",exampleUz:"Mahsulotni qaytarish bepul edi.",usageFrames:["request a return"],referenceUrl:"https://example.test/source",targetLexemeId:source.lexeme_id,expectedEntrySha:entryContentHash(source)};
  const second={...row,key:"returned-item",definitionEn:"A bought item sent back to the seller."};
  const newHead={...row,lemma:"notice",key:"public-message",definitionEn:"A displayed written message.",exampleEn:"She read the notice.",targetLexemeId:undefined,expectedEntrySha:undefined};
  const run=(entries:unknown[],out:string)=>{writeFileSync(join(dir,"draft.json"),JSON.stringify({version:1,status:"ai_editorial_draft_not_published",policy:"Original fixture",entries}));return spawnSync(process.execPath,["--conditions=react-server","--import","tsx","scripts/dictionary/prepare-context-supplement.ts",dir,join(dir,"source.gz"),join(dir,"corpus.json"),join(dir,"draft.json"),join(dir,out)],{cwd:process.cwd(),encoding:"utf8"});};
  const success=run([row,second,newHead,{...newHead,key:"attention",definitionEn:"Attention paid to something."}],"valid.gz");assert.equal(success.status,0,success.stderr);
  const output=JSON.parse(gunzipSync(readFileSync(join(dir,"valid.gz"))).toString()) as {entries:Entry[];report:{newContextEntries:number;additiveExistingContextEntries:number;contextExamplePairs:number}};
  assert.equal(output.entries.length,2);assert.deepEqual(output.report.newContextEntries,1);assert.equal(output.report.additiveExistingContextEntries,1);assert.equal(output.report.contextExamplePairs,4);
  const result=output.entries.find(e=>e.lexeme_id===source.lexeme_id)!;assert.equal(result.senses.length,4);
  assert.deepEqual(result.senses.slice(0,2),source.senses);assert.deepEqual(result.relations,source.relations);
  assert.equal(output.entries.find(e=>e.display_lemma==="notice")!.senses.length,2);
  const stale=run([row,{...second,expectedEntrySha:"0".repeat(64)}],"stale.gz");assert.notEqual(stale.status,0);assert.match(stale.stderr,/explicit_sense_revision/);assert.equal(existsSync(join(dir,"stale.gz")),false);
  const duplicate=run([row,row],"duplicate.gz");assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/supplement_duplicate_sense/);assert.equal(existsSync(join(dir,"duplicate.gz")),false);
  const wrongHomograph=run([{...row,targetLexemeId:homograph.lexeme_id}],"wrong-homograph.gz");assert.notEqual(wrongHomograph.status,0);assert.match(wrongHomograph.stderr,/explicit_sense_revision/);assert.equal(existsSync(join(dir,"wrong-homograph.gz")),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
