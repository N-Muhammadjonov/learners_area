import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { Entry } from "../../src/lib/dictionary/model";
const dom = new JSDOM("<html><body></body></html>", {url:"http://localhost/vocabulary?tab=dictionary"});
for (const key of ["window","document","navigator","HTMLElement","Element","Node","Event","MouseEvent","HTMLDialogElement"] as const) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
Object.assign(dom.window.HTMLDialogElement.prototype,{showModal(this: HTMLDialogElement){this.setAttribute("open","");},close(this: HTMLDialogElement){this.removeAttribute("open");}});
const React = await import("react"); Object.assign(globalThis,{React});
const {act}=React; const {createRoot}=await import("react-dom/client");
const {DictionaryPanel}=await import("../../src/components/vocabulary/DictionaryPanel");
const dict=(await import("../../src/lib/i18n/en")).default;
const word:Entry={schema_version:"1.0.0",release_id:"rel-test",lexeme_id:"word",display_lemma:"bank",normalized_search_form:"bank",part_of_speech:"n",lexical_type:"word",homograph_group:null,is_satellite:false,pronunciations:[],forms:[],relations:[],collocations:[],attribution:[],senses:[0,1].map(n=>({sense_id:`sense-${n}`,definition_en:`English definition ${n}`,definition_uz:`Uzbek definition ${n}`,translations:[{translation_id:`translation-${n}`,text:n?"qirg'oq":"bank",order:0}],examples:[{example_id:`example-${n}`,text_en:`English example ${n}`,text_uz:`Uzbek example ${n}`}]}))};
const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.getAttribute("aria-label")===text||b.textContent?.replace(/\s/g,"")===text.replace(/\s/g,""))!;
async function mount(run:()=>Promise<void>, searchError=false){
 document.body.innerHTML='<div id="root"></div>'; const root=createRoot(document.querySelector("#root")!);
 const original=globalThis.fetch; const calls:{path:string;body:unknown}[]=[]; let fail=searchError;
 globalThis.fetch=async(url,init)=>{const path=String(url); calls.push({path,body:init?.body?JSON.parse(String(init.body)):null});let data:unknown={};let status=200;
 if(path.includes("/search")){if(fail){status=503;fail=false;} else data={release_id:"rel-test",results:[{lexeme_id:"word",display_lemma:"bank",part_of_speech:"n",translation_uz:"bank"}]};}
 else if(path.endsWith("/recent"))data={recent:[]}; else if(path.includes("/folders"))data={folders:[{id:"folder",name:"Travel",count:4}]}; else if(path.includes("/entries/"))data={entry:word,saved:[]};
 return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});};
 try{await act(async()=>root.render(React.createElement(DictionaryPanel,{dict})));await run();return calls;}finally{await act(async()=>root.unmount());globalThis.fetch=original;}
}
async function search(){const input=document.querySelector<HTMLInputElement>('input[role="combobox"]')!;await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value")!.set!.call(input,"bank");input.dispatchEvent(new dom.window.Event("input",{bubbles:true}));});await act(async()=>new Promise(r=>setTimeout(r,260)));}
async function open(){await search();await act(async()=>document.querySelector<HTMLButtonElement>('[id="dictionary-hit-0"] button')!.click());}
test("canonical meanings open independently; exact sense opens folder modal only on Add; cancelling does not save",async()=>{
 const calls=await mount(async()=>{await open();assert.equal(document.querySelector("dialog"),null);assert.ok(document.body.textContent?.includes("noun"));assert.equal(document.body.textContent?.includes("English definition 0"),false);
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-controls="dictionary-sense-sense-0"]')!.click());assert.ok(document.body.textContent?.includes("English definition 0"));assert.equal(document.body.textContent?.includes("English definition 1"),false);
 await act(async()=>document.querySelector<HTMLButtonElement>('[aria-controls="dictionary-sense-sense-1"]')!.click());assert.ok(document.body.textContent?.includes("English definition 1"));assert.ok(document.body.textContent?.includes("English definition 0"));
 const adds=[...document.querySelectorAll<HTMLButtonElement>("button")].filter(b=>b.textContent?.includes(dict.globalDictionary.save));await act(async()=>adds[1]!.click());assert.ok(document.querySelector("dialog[open]"));assert.ok(document.querySelector("dialog")?.textContent?.includes("qirg'oq"));assert.ok(document.querySelector("dialog")?.textContent?.includes("Travel4"));
 await act(async()=>document.querySelector<HTMLButtonElement>('dialog button[aria-label="Close"]')!.click());assert.equal(document.querySelector("dialog"),null);
 for(const absent of ["Grammar","Thesaurus","More examples","B1","Play pronunciation"])assert.equal(document.body.textContent?.includes(absent),false);
 });assert.equal(calls.filter(c=>c.path.endsWith("/save")).length,0);
});
test("folder confirmation saves the selected sense identity and selected existing folder",async()=>{
 const calls=await mount(async()=>{await open();await act(async()=>document.querySelector<HTMLButtonElement>('[aria-controls="dictionary-sense-sense-1"]')!.click());await act(async()=>document.querySelector<HTMLButtonElement>('[data-dictionary-sense="sense-1"] button[aria-label="Add to Vocabulary"]')!.click());await act(async()=>document.querySelector<HTMLInputElement>('input[value="folder"]')!.click());await act(async()=>button(dict.globalDictionary.confirmFolder).click());assert.equal(document.querySelector("dialog"),null);assert.ok(button(dict.globalDictionary.saved).disabled);});
 assert.deepEqual(calls.find(c=>c.path.endsWith("/save"))?.body,{lexemeId:"word",senseId:"sense-1",releaseId:"rel-test",folderId:"folder"});
});
test("search failure exposes Retry and a retry recovers results",async()=>{await mount(async()=>{await search();assert.ok(document.querySelector('[role="alert"]'));await act(async()=>button(dict.globalDictionary.retry).click());await act(async()=>new Promise(r=>setTimeout(r,260)));assert.ok(document.querySelector('[id="dictionary-hit-0"]'));},true);});

test("the reading layout keeps top search, adds the exact collapsed meaning with plus, and shows no reference brands or links",async()=>{
 const original=word.senses[0]!.editorial;word.senses[0]!.editorial={status:"source_checked",translation_status:"ai_draft",provenance:"editorial_fixture",reference_urls:["https://dictionary.cambridge.org/dictionary/english/bank"]};
 try{const calls=await mount(async()=>{await open();assert.ok(document.querySelector('form[role="search"] input[role="combobox"]'));assert.equal(document.querySelector('a[href*="cambridge"]'),null);assert.equal(document.body.textContent?.includes("Cambridge"),false);assert.equal(document.body.textContent?.includes(dict.vocabulary.contextUnverified),false);assert.equal(document.body.textContent?.includes("English definition 1"),false);
 const plus=document.querySelector<HTMLButtonElement>('[data-dictionary-sense="sense-1"] button[aria-label="Add to Vocabulary"]')!;assert.ok(plus.textContent?.includes("+"));await act(async()=>plus.click());assert.ok(document.querySelector("dialog")?.textContent?.includes("qirg'oq"));await act(async()=>document.querySelector<HTMLButtonElement>('dialog button[aria-label="Close"]')!.click());
 assert.ok([...document.querySelectorAll("summary")].some(s=>s.textContent===dict.globalDictionary.synonyms));assert.ok([...document.querySelectorAll("summary")].some(s=>s.textContent===dict.globalDictionary.collocations));
 });assert.equal(calls.filter(c=>c.path.endsWith("/save")).length,0);}finally{word.senses[0]!.editorial=original;}
});

test("pronunciation speaks the displayed entry in English only after a click and exposes unavailable playback",async()=>{
 const spoken: {text:string;lang:string;voice:unknown;onend:null|(()=>void);onerror:null|((event:{error:string})=>void)}[]=[];
 class Utterance {lang="";voice:unknown=null;onend=null;onerror=null;constructor(public text:string){}}
 const synthesis={cancel(){},getVoices(){return [{localService:true,lang:"en-GB",name:"English"}];},speak(utterance:InstanceType<typeof Utterance>){spoken.push(utterance);}};
 Object.defineProperty(dom.window,"speechSynthesis",{configurable:true,value:synthesis});
 Object.defineProperty(dom.window,"SpeechSynthesisUtterance",{configurable:true,value:Utterance});
 try{await mount(async()=>{await open();assert.equal(spoken.length,0);const pronounce=button(`${dict.vocabulary.games.pronounce}: bank`);assert.ok(pronounce.querySelector("svg"));await act(async()=>pronounce.click());assert.equal(spoken.length,1);assert.equal(spoken[0]!.text,"bank");assert.equal(spoken[0]!.lang,"en-GB");assert.equal(pronounce.getAttribute("aria-pressed"),"true");await act(async()=>spoken[0]!.onend?.());assert.equal(pronounce.getAttribute("aria-pressed"),"false");});
 delete (dom.window as unknown as Record<string,unknown>).speechSynthesis;
 await mount(async()=>{await open();await act(async()=>button(`${dict.vocabulary.games.pronounce}: bank`).click());assert.ok(document.querySelector('[role="status"]')?.textContent?.includes(dict.globalDictionary.pronunciationUnavailable));});
 }finally{delete (dom.window as unknown as Record<string,unknown>).speechSynthesis;delete (dom.window as unknown as Record<string,unknown>).SpeechSynthesisUtterance;}
});
