import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ID,tick} from './staff-final30/harness.mjs';
import {mount} from '../modules/writing/exam.js';

test('CD split and task navigation preserve the editor, both drafts and ordered final saves',async()=>{
 const id=ID(70),h=setup({path:'/app/writing/exam/'+id,role:'student'}),oldFetch=globalThis.fetch,oldConfirm=globalThis.confirm,calls=[];
 try{
  const entries=[1,2].map(position=>({position,taskType:'task'+position,promptId:ID(70+position),prompt:'Exact source task '+position,content:'',revision:0}));
  h.stub({'/api/frontend/view':{version:1,route:'/app/writing/exam/'+id,data:{paper:{id,mode:'full',remainingSeconds:3600,entries},materials:{}}}});
  globalThis.confirm=()=>true;globalThis.fetch=async(path,options)=>{const body=JSON.parse(options.body);calls.push({path,body});return Response.json({ok:true,revision:body.revision});};
  mount(h.ctx);await tick();assert(h.q('[data-cd-exam="writing"]'));const editor=h.q('[data-exam-editor]');
  h.input(editor,'First task draft');const divider=h.q('[role=separator]');divider.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));assert.equal(divider.getAttribute('aria-valuenow'),'48');assert.equal(h.q('[data-exam-editor]'),editor);
  h.click(h.q('[data-exam-task-tab="task2"]'));assert(h.q('.cd-instruction').textContent.includes('250 words'));h.input(editor,'Second task draft');
  h.click(h.q('[data-exam-task-tab="task1"]'));assert.equal(editor.value,'First task draft');assert.equal(h.q('[data-exam-words]').textContent,'words: 3');
  h.click(h.q('[aria-label="Notes"]'));const notes=h.q('.cd-notes textarea');h.input(notes,'Private temporary note');h.click(h.q('[data-exam-submit]'));await tick(8);
  assert.equal(calls.length,3);assert.deepEqual(calls.slice(0,2).map(c=>[c.body.position,c.body.content]),[[1,'First task draft'],[2,'Second task draft']]);assert(calls[2].path.endsWith('/finalize'));assert.equal(calls[2].body.reason,'submitted');assert(!JSON.stringify(calls).includes('Private temporary note'));
 }finally{globalThis.fetch=oldFetch;globalThis.confirm=oldConfirm;h.dispose();}
});
