import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { convertLegacyPackage, jsonLiteral } from "../src/lib/listening/source-parser";
import { packageActivities } from "../src/lib/listening/activities";
import { gradePackage, listeningPackageSchema } from "../src/lib/listening/package";
import { extractEmbeddedListeningMedia } from "../src/lib/listening/embedded-media";
import { inspectListeningPackage } from "../src/lib/listening/inspect";
import { strToU8 } from "fflate";
const read = (html:string) => new JSDOM(html).window.document;
const parse = (n:number) => convertLegacyPackage({"source.html":readFileSync(`tests/fixtures/listening/authored-test${n}.html`,"utf8")},2000,read,{audioPath:"audio.mp3",fallbackTestId:`Listening Test ${n}.html`});
test("unversioned authored ZIP runs its HTML without inventing native question grading; broken native manifests still fail", async()=>{
 const html='<title>Different authored test</title><button onclick="document.body.dataset.clicked=1">Own exercise</button>';
 const manifest={test_id:"different-test",sections:["Part 1"],questions:["Authored question"],answers:{1:"answer"},vocabulary:[{word:"keen",pos:"adjective",uz:"ishtiyoqli",def:"interested",ex:"I am keen.",also:[]}]};
 const run=(raw:string)=>inspectListeningPackage({entries:{"index.html":strToU8(html),"audio.mp3":new Uint8Array([73,68,51,4,0,0]),"data/package.json":strToU8(raw)},textFiles:{"index.html":html,"data/package.json":raw},zipName:"Different.zip",probeDuration:async()=>2000,read});
 const result=await run(JSON.stringify(manifest));
 assert.equal(result.payload.questions.length,0);assert.equal(result.payload.title,"Different authored test");
 assert.equal(result.payload.authoredRuntime?.files["index.html"],html);assert.equal(result.payload.vocabulary[0]?.word,"keen");
 await assert.rejects(run(JSON.stringify({...manifest,schemaVersion:1})),/package_invalid/);
 await assert.rejects(run('{broken'),/package_invalid/);
});
test("ambiguous embedded audio refuses import rather than assigning the wrong recording",()=>{
 const repeated=extractEmbeddedListeningMedia('<audio src="data:audio/mpeg;base64,YQ=="></audio><audio src="data:audio/mpeg;base64,YQ=="></audio>');
 assert.equal(Object.keys(repeated.entries).length,1);assert.equal(repeated.html.includes("base64"),false);
 assert.throws(()=>extractEmbeddedListeningMedia('data:audio/mpeg;base64,YQ== data:audio/mpeg;base64,Yg=='),/explicit ZIP package manifest/);
});
test("two authored HTML families retain their own questions, exercises and transcripts",()=>{
 const first=parse(1),second=parse(2);
 assert.equal(first.questions.length,40);assert.equal(first.keyword1.length,20);
 assert.deepEqual(packageActivities(first),["exam","review","script","mcq","recall","vocab"]);
 assert.equal(second.testId,"listening-test-2");assert.equal(second.title,"Listening Test 2");assert.equal(second.questions.length,40);assert.equal(second.keyword1.length,60);assert.equal(second.vocabulary.length,20);
 assert.ok(second.sections.every(s=>s.transcript.length>100));
 assert.deepEqual(packageActivities(second),["exam","review","script","mcq","matching","completion","vocab","retry"]);
 assert.equal(second.questions.filter(q=>q.kind==="matching").length,4);assert.equal(second.questions.filter(q=>q.kind==="mcq").length,16);assert.equal(second.questions.filter(q=>q.kind==="completion").length,20);
 assert.deepEqual(second.questions.find(q=>q.number===31)?.options,["A) a collection was donated","B) the public showed an interest in them","C) an expert decided some of them were valuable"]);
 assert.ok(second.questions[0]!.instruction.includes("ONE WORD"));assert.equal(second.questions[20]!.instruction.includes("THREE WORDS"),true);
 assert.equal(gradePackage(second,Object.fromEntries(second.questions.map(q=>[q.number,q.key]))).filter(q=>q.correct).length,40);
 assert.equal(gradePackage(second,{6:"1 November"}).find(q=>q.number===6)?.correct,true);
 assert.equal(gradePackage(second,{17:"D",18:"F",19:"A",20:"C"}).filter(q=>q.correct).length,4);
 assert.equal(first.keyword1.filter(row=>row.sourceQuestion===31).length,2,"duplicate authored source Q31 has distinct gap identities");
});
test("the shared schema permits future data-driven test variants without pretending every HTML is known",()=>{
 const p=parse(2);p.studyPack!.activities=["exam","review","completion"];p.vocabulary=[];p.keyword1=[];
 assert.deepEqual(packageActivities(listeningPackageSchema.parse(p)),["exam","review","completion"]);
 assert.throws(()=>convertLegacyPackage({"source.html":"<script>window.evil=true</script>"},2000,read,{audioPath:"audio.mp3"}));
 assert.throws(()=>jsonLiteral('const DATA = (() => {throw Error("must not execute")})()',"const DATA ="));
 assert.throws(()=>listeningPackageSchema.parse({...p,questions:[...p.questions,p.questions[0]]}));
});
