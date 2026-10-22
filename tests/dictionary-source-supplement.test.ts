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
