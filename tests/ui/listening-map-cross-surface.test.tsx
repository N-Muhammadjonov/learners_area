import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import { convertLegacyPackage } from "../../src/lib/listening/source-parser";
import { mapDiagramSections } from "../../src/lib/listening/activities";
import { listeningQuestionIdentity } from "../../src/lib/listening/question-identity";
import { structuredSource } from "../support/structured-listening-fixture";
const dom = new JSDOM('<html><body></body></html>', {url:"http://localhost/app/listening"});
for (const k of ["window","document","navigator","HTMLElement","HTMLButtonElement","HTMLInputElement","HTMLSelectElement","HTMLAnchorElement","Element","Node","Event","MouseEvent","localStorage","sessionStorage"] as const)
  Object.defineProperty(globalThis,k,{value:dom.window[k],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,self:globalThis});
dom.window.HTMLMediaElement.prototype.pause=()=>{};
URL.createObjectURL=()=>"blob:map-qa"; URL.revokeObjectURL=()=>{};
const React=await import("react"); Object.assign(globalThis,{React});
const {act}=React;
const {createRoot}=await import("react-dom/client");
const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
const {FullListeningActivity}=await import("../../src/components/listening/FullListeningActivity");
const {NativeListeningExam}=await import("../../src/components/listening/NativeListeningExam");
const {ListeningTryout}=await import("../../src/components/import/ListeningTryout");
const {ListeningPractice}=await import("../../src/components/listening/ListeningPractice");
const payload=convertLegacyPackage({"source.html":structuredSource()},500,html=>new JSDOM(html).window.document,{audioPath:"fixture.mp3"});
const router={back(){},forward(){},refresh(){},push(){},replace(){},prefetch(){}};
async function mount(element: React.ReactElement, run:(container:HTMLElement)=>Promise<void>) {
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  try {await act(async()=>root.render(<AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>));await run(container);}
  finally {await act(async()=>root.unmount());container.remove();}
}
async function click(c:HTMLElement,label:string) {
  const button=[...c.querySelectorAll("button")].find(b=>b.textContent?.trim()===label);assert.ok(button,`button ${label}`);
  await act(async()=>button.dispatchEvent(new dom.window.MouseEvent("click",{bubbles:true})));
}
function visible(c:HTMLElement,yes:boolean,image=false) {
  assert.equal(!!c.querySelector("[data-listening-map]"),yes,"sanitized map placement");
  if(image)assert.equal(!!c.querySelector('img'),yes,"image.map placement agrees");
}
const reviewData={questions:payload.questions,sections:payload.sections,studyPack:payload.studyPack,mapDiagram:payload.mapDiagram};
const reviewProps={id:"map-qa",userId:"learner-qa",title:payload.title,activity:2,data:reviewData,audioUrl:null,imageUrl:"/map-qa.png",initial:{},dict:en};
test("REVIEW-MAP-01 real Review starts Part 1 without map, shows Part 3, hides Parts 2/4",async()=>{
  await mount(<FullListeningActivity {...reviewProps}/>,async c=>{
    visible(c,false,true); await click(c,"PART 2");visible(c,false,true);
    await click(c,"PART 3");visible(c,true,true);assert.match(c.textContent??"",/Authored question 11/);
    await click(c,"PART 4");visible(c,false,true);
  });
});
test("REVIEW-MAP-02 legacy kind-less package retains helper-owned Part 2 fallback",async()=>{
  const data={...reviewData,questions:payload.questions.map(q=>({...q,kind:undefined,typeCode:undefined}))};
  assert.deepEqual(mapDiagramSections(data),[2]);
  await mount(<FullListeningActivity {...reviewProps} data={data}/>,async c=>{
    visible(c,false,true);await click(c,"PART 2");visible(c,true,true);await click(c,"PART 3");visible(c,false,true);
  });
});
test("REVIEW-MAP-03 historical unpartitioned review retains its visible stimulus",async()=>{
  await mount(<FullListeningActivity {...reviewProps} data={{...reviewData,studyPack:undefined}}/>,async c=>visible(c,true,true));
});
test("CROSS-MAP-01 the SAME parsed Part 3 fixture agrees in native exam (both visual forms)",async()=>{
  const questions=payload.questions.map(({key:_key,evidence:_evidence,alternatives:_alternatives,pair:_pair,...q})=>({...q,id:`q-${q.number}`}));
  await mount(<NativeListeningExam dict={en} attemptId="map-attempt" testId="map-qa" title={payload.title} audioUrl="/fixture.mp3" imageUrl="/map-qa.png" mapDiagram={payload.mapDiagram} mapSections={mapDiagramSections(payload)} questions={questions} initial={{}} audioPosition={0} audioStartedAt={null}/>,async c=>{
    visible(c,false,true);
    for(const part of [2,3,4]){await click(c,en.fullListeningHub.examScreen.section.replace("{n}",String(part)));visible(c,part===3,true);}
    assert.doesNotMatch(c.textContent??"",/Authored evidence|Authored transcript/);
  });
});
test("CROSS-MAP-02 same fixture in preview, Map Mastery and MCQ exclusion",async()=>{
  await mount(<ListeningTryout dict={en} payload={payload} audioFile={new dom.window.File([],"fixture.mp3")} image={null}/>,async c=>{
    visible(c,false);await click(c,"PART 2");visible(c,false);await click(c,"PART 3");visible(c,true);await click(c,"PART 4");visible(c,false);
    await click(c,en.fullListeningHub.research.map);await click(c,"PART 3");visible(c,true);
    for(const n of [11,12,13,14])assert.match(c.textContent??"",new RegExp(`Authored question ${n}`));
    await click(c,en.fullListeningHub.research.mcq);visible(c,false);
    for(const n of [11,12,13,14,26,27,28,29,30])assert.doesNotMatch(c.textContent??"",new RegExp(`Authored question ${n}`));
  });
});
test("CROSS-MAP-03 native Map Mastery receives actual map questions, never MCQ",async()=>{
  const maps=payload.questions.filter(q=>q.kind==="map");assert.deepEqual(maps.map(q=>q.number),[11,12,13,14]);
  assert.ok(maps.every(q=>listeningQuestionIdentity(q).storageType!=="multiple_choice"));
  await mount(<ListeningPractice id="map-qa" title={payload.title} kind="map" questions={maps.map(q=>({...q,at:q.evidence.at}))} audioUrl={null} initial={{}} dict={en} mapDiagram={payload.mapDiagram}/>,async c=>{
    visible(c,true);assert.match(c.textContent??"",/Authored question 11/);await click(c,en.fullListeningHub.research.next);assert.match(c.textContent??"",/Authored question 12/);
  });
});
