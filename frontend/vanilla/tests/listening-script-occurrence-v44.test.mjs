import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
