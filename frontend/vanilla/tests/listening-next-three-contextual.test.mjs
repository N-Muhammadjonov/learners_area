import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';
import {paintedBridge} from '../modules/listening/authored-progressive.js';

function dataFor(testNumber){
 const name=String(testNumber).padStart(2,'0');
 const runtime=JSON.parse(readFileSync(
  new URL('../../../services/backend/assets/listening/test-'+name+'.json',import.meta.url),'utf8'));
 const html=runtime.files[runtime.entryPath];
 const start=html.indexOf('const DATA=')+'const DATA='.length;
 assert(start>10);
 let depth=0,quoted=false,escaped=false;
 for(let i=start;i<html.length;i++){
  const c=html[i];
  if(quoted){
   if(escaped)escaped=false;
   else if(c==='\\')escaped=true;
   else if(c==='"')quoted=false;
   continue;
  }
  if(c==='"'){quoted=true;continue;}
  if(c==='{'||c==='[')depth++;
  if((c==='}'||c===']')&&--depth===0){
   return JSON.parse(html.slice(start,i+1));
  }
 }
 throw Error('Missing original DATA for test '+testNumber);
}
test('Listening Tests 4-6 have twelve intact transcript sources with real text',()=>{
 let total=0;
 for(let number=4;number<=6;number++){
  const data=dataFor(number);
  for(let part=1;part<=4;part++){
   const source=data.transcript[String(part)];
   assert.equal(typeof source,'string');
   assert(source.length>2500,'Test '+number+' Part '+part+' is incomplete');
   total+=source.length;
  }
 }
 assert(total>43000);
});

test('Script Completion source spans align with original source and retain every graded gap',()=>{
 const w=new JSDOM('<div id="scriptTabs"><button data-spart="1" class="active">Part 1</button></div><div id="activity-script" class="active"><div id="scriptHost"></div></div>',{runScripts:'outside-only'}).window;
 try {
  w.renderScript=()=>null;
  w.DATA={transcript:{'1':''},script_completion:[]};
  w.scriptPart=1;
  w.escapeHtml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  w.buildScriptTranscript=()=>'<p>unsupported</p>';
  w.eval(originalScriptAccessibility('fixture'));
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  for(let number=4;number<=6;number++){
   const data=dataFor(number);
   w.DATA=data;
   for(let part=1;part<=4;part++){
    const html=w.buildScriptTranscript(part);
    const host=w.document.querySelector('#scriptHost');
    host.innerHTML='<div class="script-transcript">'+html+'</div>';
    const sections=[...host.querySelectorAll('[data-script-source-start]')];
    assert(sections.length>0,'Test '+number+' Part '+part+' has no source offsets');
    for(const span of sections){
     const offset=Number(span.dataset.scriptSourceStart);
     assert.equal(span.textContent,data.transcript[part].slice(offset,offset+span.textContent.length),
      'Test '+number+' Part '+part+' lexical segment is not source-exact');
    }
    const expected=data.script_completion.filter(item=>item.part===part).length;
    const actual=host.querySelectorAll('.script-gap-wrap').length;
    assert.equal(actual,expected,'Test '+number+' Part '+part+' lost exercise inputs');
   }
  }
 } finally {w.close();}
});

test('All transcript words have an offset-preserving contextual fallback and save markers',()=>{
 const script=paintedBridge('fixture',{},'Notes','storage',null,false,[]);
 assert.match(script,/mode:'script'/);
 assert.match(script,/startChar:begin,endChar:end/);
 assert.match(script,/occurrences\.filter/);
 assert.match(script,/if\(matches\.length!==1\)return;/);
 new Function(script);
 const parent=readFileSync(new URL('../modules/listening/authored.js',import.meta.url),'utf8');
 assert.match(parent,/contextualScriptWord\(d\)/);
 assert.match(parent,/refreshScriptSaved\(\)/);
 assert.match(parent,/onSavedStatus:saved/);
});
