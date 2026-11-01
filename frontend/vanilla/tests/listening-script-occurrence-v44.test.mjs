import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {bridge} from '../js/generated/authored-helpers.js';

for(const n of ['01','02']) {
 const source=readFileSync(new URL('../../../content/listening/academic/test-'+n+'/source.html',import.meta.url),'utf8');
 const capture=source.match(/function buildScriptTranscript\(part\)\{[\s\S]*?\}\nfunction renderScript/);
 test('Test '+n+' Script uses source-exact text offsets without altering gaps',()=>{
  assert(capture);
  assert.match(capture[0],/data-script-source-start/);
  assert.match(capture[0],/data-gap=/);
  const start=source.indexOf('const DATA=');
  const data=JSON.parse(source.slice(start+11,source.indexOf(';\nconst PARTS=',start)));
  const build=new Function('DATA','escapeHtml',capture[0].replace(/\nfunction renderScript$/,'')+'\nreturn buildScriptTranscript')(data,s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'));
  for(let part=1;part<=4;part++){
   const html=build(part);
   const starts=[...html.matchAll(/data-script-source-start="(\d+)"/g)].map(m=>Number(m[1]));
   assert(starts.length>=2);
   assert(starts.every((v,i)=>i===0||v>=starts[i-1]));
   const gaps=data.script_completion.filter(g=>g.part===part);
   assert.equal((html.match(/class="script-gap-wrap"/g)||[]).length,gaps.length);
  }
 });
}
test('Only Script Completion exact, editor-resolved occurrence double clicks can request lookup',()=>{
 const script=bridge('fixture',{},'Notes','storage',null,true,[]);
 assert.match(script,/addEventListener\('dblclick'/);
 assert.match(script,/data-script-source-start/);
 assert.match(script,/occurrences\.filter/);
 assert.match(script,/matches\.length!==1/);
 assert.match(script,/source\.slice\(begin,end\)!==word/);
 assert.doesNotMatch(script,/const first=source\.indexOf\(nodeText\)/);
 new Function(script);
});

function wordClick(tab,occurrences){
 const dom=new JSDOM('<div id="scriptTabs">'+tab+'</div><main id="activity-script" class="active"><div id="scriptHost"><div class="script-transcript"><span data-script-source-start="0">hello</span></div></div></main>',{runScripts:'outside-only'});
 try{
  const w=dom.window,span=w.document.querySelector('.script-transcript span'),sent=[];
  w.postMessage=message=>sent.push(message);
  w.document.elementFromPoint=()=>span;
  w.document.caretRangeFromPoint=()=>({startContainer:span.firstChild,startOffset:2});
  w.Range.prototype.getClientRects=()=>[{left:0,right:10,top:0,bottom:10}];
  w.eval('const DATA={transcript:{"1":"other","2":"hello"}};'+bridge('fixture',{},'Notes','storage',null,false,occurrences));
  span.dispatchEvent(new w.MouseEvent('dblclick',{bubbles:true,button:0,clientX:5,clientY:5}));
  return sent.filter(message=>message.op==='word');
 }finally{dom.window.close();}
}
const occurrence={part:2,start:0,end:5,surface:'hello',occurrenceId:'part-two-occurrence'};
for(const [kind,tab]of [
 ['authored active class','<button class="active" data-spart="2">Part 2</button>'],
 ['semantic tab fallback','<button aria-selected="true" data-spart="2">Part 2</button>'],
])test('Script word click resolves the selected Part using '+kind,()=>{
 const messages=wordClick(tab,[{...occurrence,part:1,occurrenceId:'wrong-part'},occurrence]);
 assert.equal(messages.length,1);assert.equal(messages[0].occurrenceId,occurrence.occurrenceId);assert.equal(messages[0].word,'hello');
});
test('ambiguous Script occurrence identities stay closed after active-Part repair',()=>{
 assert.equal(wordClick('<button class="active" data-spart="2">Part 2</button>',[occurrence,{...occurrence,occurrenceId:'duplicate'}]).length,0);
});
