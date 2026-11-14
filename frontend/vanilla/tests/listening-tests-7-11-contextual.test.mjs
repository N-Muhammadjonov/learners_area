import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';
import {paintedBridge} from '../modules/listening/authored-progressive.js';

const repoRoot=new URL('../../../',import.meta.url);

function readRuntime(number){
 const name=String(number).padStart(2,'0');
 const encoded=readFileSync(new URL('services/backend/assets/listening/test-'+name+'.json',repoRoot),'utf8');
 const runtime=JSON.parse(encoded);
 const html=runtime.files[runtime.entryPath];
 const marker='const DATA=';
 const start=html.indexOf(marker)+marker.length;
 assert(start>=marker.length,'Missing original DATA: test '+number);
 let depth=0,quoted=false,escaped=false;
 for(let i=start;i<html.length;i++){
  const char=html[i];
  if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"'){quoted=true;continue;}
  if(char==='{'||char==='[')depth++;
  if((char==='}'||char===']')&&--depth===0){
   return {data:JSON.parse(html.slice(start,i+1)),html,encoded};
  }
 }
 throw Error('Unclosed original DATA object in Test '+number);
}

test('Listening Tests 7–11 include 20 actual source transcripts, with Script activities',()=>{
 let parts=0;
 for(let number=7;number<=11;number++){
  const {data,html}=readRuntime(number);
  assert.match(html,/function renderScript\(/,'Missing Script Completion: Test '+number);
  assert.match(html,/activityShell\('script'/,'Missing visible Script Completion activity');
  for(let part=1;part<=4;part++){
   const source=data.transcript[String(part)];
   assert.equal(typeof source,'string');
   assert(source.length>1500,'Test '+number+' Part '+part+' is missing transcript content');
   assert.doesNotMatch(source,/Full verbatim transcript is not present/);
   const gaps=data.script_completion.filter(row=>row.part===part).sort((a,b)=>a.n-b.n);
   assert(gaps.length>=6,'Test '+number+' Part '+part+' lacks graded exercise gaps');
   let cursor=0;
   for(const g of gaps){
    const at=source.toLowerCase().indexOf(String(g.match).toLowerCase(),cursor);
    assert(at>=0,'Test '+number+' Part '+part+' gap '+g.n+' cannot be located');
    cursor=at+String(g.match).length;
   }
   parts++;
  }
 }
 assert.equal(parts,20);
});

test('Test 8 canonical source and runtime hashes match manifest',()=>{
 const {html,encoded,data}=readRuntime(8);
 const source=readFileSync(new URL('content/listening/academic/test-08/source.html',repoRoot),'utf8');
 const manifest=JSON.parse(readFileSync(new URL('services/backend/assets/listening/manifest.json',repoRoot),'utf8'));
 const hash=str=>createHash('sha256').update(str).digest('hex');
 assert.equal(source,html);
 assert.equal(hash(source),manifest.entries['test-08'].sourceSha256);
 assert.equal(hash(encoded),manifest.entries['test-08'].runtimeSha256);
 assert.equal(Buffer.byteLength(encoded),manifest.entries['test-08'].bytes);
 assert.equal(data.script_completion.length,34);
 assert.equal(data.audio_sources.length,4);
 assert.match(html,/setAudioPart\(scriptPart,true\)/);
});

test('Test 8 original Script Completion creates source-exact spans and 34 independent input fields',()=>{
 const {data,html}=readRuntime(8);
 const begin=html.indexOf('function buildScriptTranscript(');
 const end=html.indexOf('/* MCQ Mastery */',begin);
 assert(begin>0&&end>begin);
 const segment=html.slice(begin,end);
 const window=new JSDOM('<div id="scriptHost"></div>',{runScripts:'outside-only'}).window;
 try{
  window.DATA=data;
  window.escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  window.eval(segment);
  let total=0;
  for(let part=1;part<=4;part++){
   const rendered=window.buildScriptTranscript(part);
   const host=window.document.querySelector('#scriptHost');
   host.innerHTML=rendered;
   const sections=[...host.querySelectorAll('[data-script-source-start]')];
   assert(sections.length>=6);
   const original=data.transcript[String(part)];
   for(const span of sections){
    const start=Number(span.dataset.scriptSourceStart);
    assert.equal(span.textContent,original.slice(start,start+span.textContent.length));
   }
   const inputs=host.querySelectorAll('input[data-gap]');
   assert.equal(inputs.length,data.script_completion.filter(g=>g.part===part).length);
   total+=inputs.length;
  }
  assert.equal(total,34);
 }finally{window.close();}
});

test('source-specific dictionary lookup and Vocabulary save bridge remains wired for Test 7–11',()=>{
 const bridge=paintedBridge('fixture',{},'Notes','test-storage',null,false,[]);
 assert.match(bridge,/mode:'script'/);
 assert.match(bridge,/startChar:begin,endChar:end/);
 assert.match(bridge,/occurrences\.filter/);
 new Function(bridge);
 const parent=readFileSync(new URL('frontend/vanilla/modules/listening/authored.js',repoRoot),'utf8');
 assert.match(parent,/contextualScriptWord\(d\)/);
 assert.match(parent,/refreshScriptSaved\(\)/);
 assert.match(parent,/onSavedStatus:saved/);
 assert.match(originalScriptAccessibility('fixture'),/lexicalSaved/);
});
