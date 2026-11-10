import test from 'node:test';import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';import {modulePrewarm} from '../js/module-prewarm.js';
import {mount} from '../modules/listening/tests-catalogue.js';
import {projection} from './phase1/fixture-projections.mjs';import {privateScope} from '../js/private-scope.js';import {listeningAudio} from '../modules/listening/audio-preload.js';
for(const [name,resources]of Object.entries({saveData:{connection:{saveData:true}},slow3g:{connection:{effectiveType:'3g'}},lowMemory:{deviceMemory:2},lowCPU:{hardwareConcurrency:2}}))test(name+': optional code prefetch consumes no request budget',async()=>{
 const h=setup({path:'/app/reading/lessons'});let calls=0;try{const warmer=modulePrewarm({root:h.ctx.root,routes:[{pattern:'/app/listening/lessons',protected:true,load:async()=>{calls++;return {};}}],signal:h.ctx.signal,window,document,navigator:{onLine:true,...resources},setTimer:()=>0,clearTimer(){}});assert.equal(await warmer.warm('/app/listening/lessons'),false);assert.equal(calls,0);warmer.dispose();}finally{h.dispose();}
});
test('catalogue opening does not speculatively download every unlocked private recording',async()=>{
 const h=setup({path:'/app/listening/tests'}),old=globalThis.fetch;let mediaRequests=0;
 try{privateScope.setScope('phase2-synthetic');listeningAudio.clear();globalThis.location={origin:'https://fixture.invalid'};globalThis.fetch=async()=>{mediaRequests++;return new Response('{}',{status:503});};h.stub({'/api/frontend/view':{version:1,route:'/app/listening/academic',data:projection('/app/listening/tests')}});mount(h.ctx);await tick(5);assert(h.q('[data-listening-academic-grid]'));assert.equal(mediaRequests,0);
 }finally{listeningAudio.clear();privateScope.setScope(null);h.dispose();globalThis.fetch=old;delete globalThis.location;}
});
