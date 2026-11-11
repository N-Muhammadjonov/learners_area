import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {secureExamGate} from '../modules/listening/secure-exam-gate.js';

function sourceLayout(number){
 const runtime=JSON.parse(fs.readFileSync(new URL('../../../services/backend/assets/listening/test-'+String(number).padStart(2,'0')+'.json',import.meta.url)));
 const html=runtime.files[runtime.entryPath];
 const rows=html.match(/\bconst ACTIVITIES\s*=\s*(\[.*?\n\]);/s)[1];
 return {shell:html.match(/<section\b[^>]*\bclass="hub"[^>]*>.*?<\/section>/s)[0],
  style:html.match(/<style>(.*?)<\/style>/s)[1],
  activities:[...rows.matchAll(/^\['([^']+)','([^']+)','([^']+)','(.*)'\],?$/gm)]
   .map(([,id,number,title,description])=>({id,number,title,description}))};
}

for(const number of [1,7])for(const active of [false,true])test('Listening '+number+' restores its original entry cards, active='+active,async()=>{
 const h=setup({role:'student',path:'/app/listening/tests/'+ID(number)}),id=ID(number),layout=sourceLayout(number);
 try{
  const attemptId=ID(80+number);
  h.stub({['/api/listening/full/'+id+'/start']:{id:attemptId}});
  const gate=secureExamGate(h.ctx,{testId:id,title:'Listening Test '+number,attemptId:active?attemptId:null,
   originalLayout:layout,activities:layout.activities.map(row=>row.id)},id);
  h.ctx.root.append(gate);
  const shadow=gate.shadowRoot;
  assert(shadow);
  assert.equal(shadow.querySelector('h1').textContent,'ListeningTest '+number);
  assert.deepEqual([...shadow.querySelectorAll('.activity-card h2')].map(node=>node.textContent),layout.activities.map(row=>row.title));
  assert.deepEqual([...shadow.querySelectorAll('.activity-card>p')].map(node=>node.textContent),layout.activities.map(row=>row.description));
  assert.equal(shadow.querySelectorAll('.activity-card').length,9);
  assert.equal(shadow.querySelectorAll('[data-listening-activity-locked]').length,8);
  assert.equal(shadow.querySelector('[data-listening-activity-locked] :is(a,button)'),null);
  assert.equal(shadow.querySelector('audio,video,source,iframe'),null);
  assert.equal(h.calls.length,0,'Rendering must not load or replace Cloudflare audio');
  assert.match(shadow.querySelector('style').textContent,/:host\{all:initial;/);
  h.click(shadow.querySelector(active?'[data-listening-resume]':'button.open-chip'));
  await tick();
  assert.equal(h.nav[0].path,'/app/listening/attempts/'+attemptId);
  assert.deepEqual(h.calls.map(call=>[call.path,call.method]),active?[]:[['/api/listening/full/'+id+'/start','POST']]);
 }finally{h.dispose();}
});

test('original entry refuses embedded audio and leaves the existing recording path alone',()=>{
 const h=setup({role:'student'}),id=ID(1),layout=sourceLayout(1);
 try{
  for(const shell of [layout.shell+'<audio src="data:audio/mpeg;base64,AAAA"></audio>',layout.shell+'<script>bad()</script>']){
   assert.throws(()=>secureExamGate(h.ctx,{testId:id,title:'Listening Test 1',attemptId:null,originalLayout:{...layout,shell}},id));
  }
  assert.equal(h.calls.length,0);
 }finally{h.dispose();}
});
