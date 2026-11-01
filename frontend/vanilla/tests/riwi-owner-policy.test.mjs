import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

test('Owner policy requires preview and sends the displayed exact hash',async()=>{
  const dom=new JSDOM('<main></main>');
  const old={document:globalThis.document,Node:globalThis.Node};
  globalThis.document=dom.window.document;globalThis.Node=dom.window.Node;
  try {
    const {assessmentPolicyPanel}=await import('../modules/staff-final30/owner-riwi.js');
    const calls=[];
    const candidate={id:'candidate-id',scope:'writing.task1.*',version:1,state:'candidate',
      contentHash:'a'.repeat(64),overlay:{maxWeaknesses:3}};
    const adapter={
      async previewAssessmentPolicy(value){calls.push(['preview',value]);return {regression:{passed:true}};},
      async createAssessmentPolicy(value){calls.push(['create',value]);return {policyVersion:candidate};},
      async getAssessmentPolicies(){return {items:[candidate]};},
      async approveAssessmentPolicy(...args){calls.push(['approve',...args]);},
    };
    const controller=new dom.window.AbortController();
    const panel=assessmentPolicyPanel({locale:'en',signal:controller.signal},[],adapter);
    document.querySelector('main').append(panel);
    const button=label=>[...panel.querySelectorAll('button')].find(b=>b.textContent===label);
    assert.equal(button('Save candidate').disabled,true);
    button('Preview').click();await new Promise(setImmediate);
    assert.equal(button('Save candidate').disabled,false);
    assert.equal(calls.filter(c=>c[0]==='create').length,0);
    button('Save candidate').click();await new Promise(setImmediate);
    assert.equal(calls.filter(c=>c[0]==='create').length,1);
    button('Approve').click();await new Promise(setImmediate);
    assert.deepEqual(calls.at(-1),['approve','candidate-id','a'.repeat(64)]);
    controller.abort();
  } finally {globalThis.document=old.document;globalThis.Node=old.Node;dom.window.close();}
});
