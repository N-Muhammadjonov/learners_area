import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { authoredTextLookup } from "../src/lib/listening/authored-text-lookup";
import { authoredWordTarget } from "../src/lib/listening/authored-word-target";
import type { VocabularySessionItem } from "../src/lib/services/lexical/listening-occurrences";

test("only a double click inside the painted word can open authored transcript lookup",()=>{
  const dom=new JSDOM('<div id="script"><p>We find out answers. <input aria-label="gap"></p><button>Play</button></div>',{runScripts:'outside-only'});
  const {window:w}=dom,d=w.document,messages:unknown[]=[];
  const node=d.querySelector('p')!.firstChild!;
  const realRange=d.createRange.bind(d);
  Object.assign(d,{caretRangeFromPoint:()=>{const r=realRange();r.setStart(node,9);return r;}});
  Object.defineProperty(w.Range.prototype,'getClientRects',{value:()=>[{left:10,right:50,top:20,bottom:40}]});
  w.eval(`const send=(...args)=>window.capture(args);${authoredTextLookup}`);
  Object.assign(w,{capture:(value:unknown)=>messages.push(value)});
  const fire=(type:string,selector:string,x:number,y:number)=>d.querySelector(selector)!.dispatchEvent(new w.MouseEvent(type,{bubbles:true,clientX:x,clientY:y,button:0,detail:type==='dblclick'?2:1}));
  fire('click','p',20,30);assert.equal(messages.length,0);
  fire('dblclick','p',200,30);assert.equal(messages.length,0,'nearest caret in empty horizontal space is not a text hit');
  fire('dblclick','p',20,90);assert.equal(messages.length,0,'line spacing is not a text hit');
  fire('dblclick','input',20,30);fire('dblclick','button',20,30);assert.equal(messages.length,0);
  fire('dblclick','p',20,30);assert.equal(messages.length,1);
  const [,data]=messages[0] as [string,{word:string;context:string;start:number;end:number}];
  assert.equal(data.word,'out');assert.equal(data.context.slice(data.start,data.end),'out');
  dom.window.close();
});

test('authored multiword expressions outrank a member word without guessing a sense',()=>{
  const entry={term:'find out',partOfSpeech:'phrasal verb',example:'We find out answers.'} as VocabularySessionItem;
  assert.equal(authoredWordTarget('out','We find out answers.',8,11,[entry]).word,'find out');
  assert.equal(authoredWordTarget('out','We find out answers.',8,11,[entry]).knownIndex,0);
  assert.equal(authoredWordTarget('out','We find out answers. They find out secrets.',31,34,[entry]).knownIndex,undefined,'an example elsewhere in the same block does not license a different occurrence');
  assert.equal(authoredWordTarget('find','We find you out.',3,7,[]).word,'find you out');
  assert.deepEqual(authoredWordTarget('find','different context',3,7,[entry]),{word:'find'});
});
