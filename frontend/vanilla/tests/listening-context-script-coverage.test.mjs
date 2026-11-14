import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {paintedBridge} from '../modules/listening/authored-progressive.js';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';

function sourceConstant(html, name) {
  const prefix='const '+name+'=',start=html.indexOf(prefix);
  assert(start>=0,'Missing original '+name);
  const begin=start+prefix.length;
  let depth=0,quoted=false,escaped=false;
  for(let i=begin;i<html.length;i++){
    const char=html[i];
    if(quoted){
      if(escaped)escaped=false;
      else if(char==='\\')escaped=true;
      else if(char==='"')quoted=false;
      continue;
    }
    if(char==='"'){quoted=true;continue;}
    if(char==='{'||char==='[')depth++;
    if((char==='}'||char===']')&&--depth===0)return JSON.parse(html.slice(begin,i+1));
  }
  assert.fail('Incomplete original '+name);
}

function originalTest(number) {
  const source=readFileSync(new URL('../../../services/backend/assets/listening/test-'+String(number).padStart(2,'0')+'.json',import.meta.url),'utf8');
  const runtime=JSON.parse(source);
  assert.equal(runtime.entryPath,'source.html');
  return sourceConstant(runtime.files[runtime.entryPath],'DATA');
}

test('all 32 Listening source runtimes contain four nonempty Script transcripts',()=>{
  const missing=[];
  for(let number=1;number<=32;number++){
    const data=originalTest(number);
    for(let part=1;part<=4;part++){
      if(typeof data.transcript?.[part]!=='string'||!data.transcript[part].trim())
        missing.push('Test '+number+' · Part '+part);
    }
  }
  assert.deepEqual(missing,[],'Canonical transcript source missing: '+missing.join(', '));
});

test('Listening Script numbered source matches are actually present, including out-of-order gaps',()=>{
  let gaps=0;const missing=[],outOfOrder=[];
  for(let number=1;number<=32;number++){
    const data=originalTest(number);
    for(let part=1;part<=4;part++){
      const source=(data.transcript?.[part]||'').toLowerCase(),rows=(data.script_completion||[]).filter(row=>row.part===part).sort((a,b)=>a.n-b.n);
      let previous=-1;
      for(const row of rows){
        gaps++;
        const at=source.indexOf(String(row.match||'').toLowerCase());
        if(at<0)missing.push({number,part,gap:row.n});
        else if(at<previous)outOfOrder.push({number,part,gap:row.n});
        previous=at;
      }
    }
  }
  assert.deepEqual(missing,[],'Source gap text is missing');
  assert(gaps>700,'All configured transcript gaps should be checked');
  assert(outOfOrder.some(row=>row.number===25)&&outOfOrder.some(row=>row.number===31),'Must detect known numbered gap-order conflicts');
});

test('Listening bridge safely forwards exact source offsets for a word without an authored occurrence',()=>{
  const script=paintedBridge('fixture',{},'Notes','test-storage',null,false,[]);
  assert.match(script,/mode:'script'/);
  assert.match(script,/startChar:begin,endChar:end/);
  new Function(script);
});

test('Script annotator preserves readable text and excludes common grammatical words',()=>{
  const dom=new JSDOM('<div id="scriptTabs"><button data-spart="1" class="active">Part 1</button></div><div id="activity-script" class="active"><div id="scriptHost"><div class="script-transcript">He offered food to the visitor.</div></div></div>',{runScripts:'outside-only'});
  try{
    const w=dom.window;
    w.DATA={transcript:{"1":"He offered food to the visitor."},script_completion:[]};
    w.scriptPart=1;
    w.buildScriptTranscript=()=>'';w.renderScript=()=>null;
    w.eval(originalScriptAccessibility('fixture',[{part:1,start:3,end:10,surface:'offered',occurrenceId:'word-1'},{part:1,start:11,end:15,surface:'food',occurrenceId:'word-2'},{part:1,start:23,end:30,surface:'visitor',occurrenceId:'word-3'}]));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const words=[...w.document.querySelectorAll('.la-script-lexical-word')];
    assert.deepEqual(words.map(el=>el.textContent),['offered','food','visitor']);
    assert.deepEqual(words.map(el=>Number(el.dataset.scriptSourceStart)),[3,11,23]);
    assert.equal(w.document.querySelector('.script-transcript').textContent,'He offered food to the visitor.');
    w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{
      token:'fixture',channel:'learners-area-script-saved',
      savedOccurrences:[{section:1,startChar:3,endChar:10}]
    }}));
    assert.equal(words[0].dataset.lexicalSaved,'true');
    assert.equal(words[1].dataset.lexicalSaved,'false');
    w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{
      token:'fixture',channel:'learners-area-script-save-status',
      part:1,start:11,end:15,saved:true
    }}));
    assert.equal(words[1].dataset.lexicalSaved,'true');
    w.dispatchEvent(new w.MessageEvent('message',{source:w.parent,data:{
      token:'foreign',channel:'learners-area-script-save-status',
      part:1,start:23,end:30,saved:true
    }}));
    assert.equal(words[2].dataset.lexicalSaved,'false');
    const calls=[];
    w.parent.postMessage=packet=>calls.push(packet);
    words[0].dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true}));
    assert.equal(calls.length,0,'Selecting a marked word must not dismiss the meaning');
    w.document.getElementById('scriptHost').dispatchEvent(new w.MouseEvent('pointerdown',{bubbles:true}));
    assert.deepEqual(calls.at(-1),{channel:'learners-area-authored-v1',token:'fixture',op:'dismiss-word'});
    w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.deepEqual(calls.at(-1),{channel:'learners-area-authored-v1',token:'fixture',op:'dismiss-word'});
  }finally{dom.window.close();}
});
