import test from 'node:test';import assert from 'node:assert/strict';
import {setup,tick,ID,api} from './staff-final30/harness.mjs';
import {mount} from '../modules/speaking/speak-or-die.js';
import {mount as hub} from '../modules/speaking/hub.js';
import {mount as practice} from '../modules/speaking/practice.js';
import {createQuestionPicker} from '../modules/speaking/fluency-questions.js';
import routes from '../js/routes.js';

function game(options={}){
 const h=setup({path:'/app/speaking/speak-or-die',role:'student',...options});
 let clock=0,level=.002,nextFrame=0,questionNumber=0,visible='visible';const frames=new Map(),inputs=[];
 Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visible});
 const deps={now:()=>clock,requestFrame:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelFrame:id=>frames.delete(id),questionPicker:{async next(){questionNumber++;return {id:ID(800+questionNumber),part:'part3',promptText:'Synthetic test question '+questionNumber+': explain your choice.',cueCard:null};}},
  voiceFactory:args=>{const input={args,disposed:false,opens:0,async open(){this.opens++;},sample(){assert(!this.disposed);return {rms:level,samples:Float32Array.from({length:128},(_,i)=>i%2?level:-level)};},dispose(){this.disposed=true;}};inputs.push(input);return input;}};
 const state=mount(h.ctx,{...deps,...options.dependencies});
 return {...h,...state,inputs,frames,deps,get now(){return clock;},setVolume(v){level=v;},step(ms=20){clock+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(clock));},steps(n,ms=20){for(let i=0;i<n;i++)this.step(ms);},async start(){h.click(h.q('[data-fluency-start]'));await tick();this.steps(315);assert.equal(state.engine.snapshot().phase,'running');},hide(){visible='hidden';document.dispatchEvent(new h.dom.window.Event('visibilitychange'));},show(){visible='visible';document.dispatchEvent(new h.dom.window.Event('visibilitychange'));}};
}
for(const locale of ['en','uz'])test(locale+': hub replaces only the AI card and robot is absent from hub and practice intro',async()=>{
 const h=setup({path:'/app/speaking',role:'student',locale}),oldCancel=globalThis.cancelAnimationFrame;globalThis.cancelAnimationFrame=h.dom.window.cancelAnimationFrame.bind(h.dom.window);try{hub(h.ctx);assert.equal(h.qa('[data-speaking-card]').length,4);const card=h.q('[data-speaking-card="fluency"]');assert.equal(card.getAttribute('href'),'/app/speaking/speak-or-die');assert(card.textContent.includes(h.ctx.dict.speakingHub.cards.fluency.cta));assert.equal(h.q('[data-speaking-card="ai"]'),null);assert.equal(h.q('.la-mascot'),null);assert(h.q('.fluency-hub-icon'));h.ctx.root.replaceChildren();h.ctx.url=new URL('https://fixture.invalid/app/speaking/practice');h.stub({'/api/speaking/practice/facets':{parts:[]}});practice(h.ctx);await tick();assert.equal(h.q('.la-mascot'),null);assert(h.q('[data-practice-parts]'));}finally{h.dispose();globalThis.cancelAnimationFrame=oldCancel;}
});
test('canonical route is protected and lazy, while the historical AI route remains available',async()=>{for(const path of ['/app/speaking/speak-or-die','/app/speaking/ai']){const route=routes.find(r=>r.pattern===path);assert(route.protected);assert.equal(typeof(await route.load()).mount,'function');}});
test('idle is microphone-free, keyboard levels select real configurations, and rapid Start is single-flight',async()=>{
 const h=game();try{assert.equal(h.inputs.length,0);assert.equal(h.q('[aria-checked="true"]').dataset.fluencyLevel,'intermediate');const advanced=h.q('[data-fluency-level="advanced"]');advanced.focus();advanced.dispatchEvent(new h.dom.window.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(h.engine.snapshot().level,'beginner');h.click(h.q('[data-fluency-start]'));h.click(h.q('[data-fluency-start]'));assert.equal(h.inputs.length,1);await tick();assert.equal(h.engine.snapshot().phase,'calibrating');h.steps(315);assert.equal(h.engine.snapshot().phase,'running');assert.equal(h.qa('.la-mascot').length,1);assert.equal(h.qa('.fluency-waveform i').length,21);}finally{h.dispose();assert(h.inputs.every(input=>input.disposed));assert.equal(h.frames.size,0);}
});
test('question is readable for five seconds before the 60-second game starts',async()=>{
 const h=game();
 try{
  h.click(h.q('[data-fluency-start]'));await tick();
  for(let i=0;i<100&&h.engine.snapshot().phase==='calibrating';i++)h.step();
  const readyAt=h.now;
  assert.equal(h.engine.snapshot().phase,'ready');
  assert.equal(h.engine.snapshot().elapsedMs,0);
  assert.equal(h.q('[data-fluency-preparation]').hidden,false);
  assert.equal(h.q('.fluency-timer').hidden,true);
  h.steps(249);
  assert.equal(h.engine.snapshot().phase,'ready');
  assert.equal(h.engine.snapshot().elapsedMs,0);
  h.step();
  assert.equal(h.now-readyAt,5000);
  assert.equal(h.engine.snapshot().phase,'running');
  assert.equal(h.q('[data-fluency-preparation]').hidden,true);
  assert.equal(h.q('.fluency-timer').hidden,false);
  assert.equal(h.engine.snapshot().remainingMs,60000);
 }finally{h.dispose();}
});
test('real signal projection freezes danger, retains DOM nodes, then silence loses and replay gets a new question',async()=>{
 const h=game();try{h.click(h.q('[data-fluency-level="advanced"]'));await h.start();const arena=h.q('[data-fluency-arena]'),robot=h.q('.la-mascot'),disc=h.q('.fluency-hazard'),bar=h.q('.fluency-waveform i');h.steps(12,100);assert(h.engine.snapshot().dangerProgress>0);h.setVolume(.07);h.steps(8,50);const position=h.engine.snapshot().dangerProgress;assert(h.engine.snapshot().speaking);h.steps(20,100);assert.equal(h.engine.snapshot().dangerProgress,position);assert.equal(h.q('[data-fluency-arena]'),arena);assert.equal(h.q('.la-mascot'),robot);assert.equal(h.q('.fluency-hazard'),disc);assert.equal(h.q('.fluency-waveform i'),bar);assert(parseFloat(bar.style.height)>4);h.setVolume(.002);for(let i=0;i<200&&h.engine.snapshot().phase==='running';i++)h.step(100);assert.equal(h.engine.snapshot().phase,'lost');assert(h.engine.snapshot().elapsedMs>0&&h.engine.snapshot().elapsedMs<60000);assert.equal(h.frames.size,0);assert(h.inputs[0].disposed);assert.equal(robot.dataset.mascotState,'lost');const old=h.q('.fluency-question h2').textContent;h.click(h.q('[data-fluency-again]'));await tick();assert.equal(h.engine.snapshot().level,'advanced');assert.equal(h.engine.snapshot().dangerProgress,0);assert.notEqual(h.q('.fluency-question h2').textContent,old);h.click(h.q('[data-fluency-quit]'));assert.equal(h.engine.snapshot().phase,'idle');assert(h.inputs.every(input=>input.disposed));}finally{h.dispose();}
});
test('continuous injected audio wins at sixty seconds, closes input and resets level selection',async()=>{
 const h=game({locale:'uz'});try{await h.start();h.setVolume(.08);for(let i=0;i<610&&h.engine.snapshot().phase==='running';i++)h.step(100);assert.equal(h.engine.snapshot().phase,'won');assert.equal(h.engine.snapshot().elapsedMs,60000);assert(h.q('.fluency-result').textContent.includes('60 / 60'));assert(h.inputs[0].disposed);assert.equal(h.frames.size,0);h.click(h.q('[data-fluency-change-level]'));assert.equal(h.engine.snapshot().phase,'idle');assert.equal(h.engine.snapshot().elapsedMs,0);assert.equal(h.inputs.length,1);}finally{h.dispose();}
});
test('background and throttling pause without elapsed jumps; explicit Resume reacquires a clean input',async()=>{
 const h=game();try{await h.start();h.setVolume(.07);h.steps(10,100);h.hide();const before=h.engine.snapshot();assert.equal(before.phase,'paused');assert(h.inputs[0].disposed);assert.equal(h.frames.size,0);h.step(50000);h.show();assert.equal(h.engine.snapshot().elapsedMs,before.elapsedMs);assert.equal(h.inputs.length,1);h.click(h.q('[data-fluency-resume]'));await tick();h.setVolume(.002);for(let i=0;i<350&&h.engine.snapshot().phase!=='running';i++){assert.equal(h.engine.snapshot().elapsedMs,before.elapsedMs);h.step();}assert.equal(h.engine.snapshot().phase,'running');assert.equal(h.engine.snapshot().elapsedMs,before.elapsedMs);const resumed=h.engine.snapshot().elapsedMs;h.step(5000);assert.equal(h.engine.snapshot().phase,'paused');assert.equal(h.engine.snapshot().elapsedMs,resumed);assert(h.inputs[1].disposed);h.controller.abort();assert.equal(h.frames.size,0);}finally{h.dispose();}
});
test('device interruption pauses and a stale input callback cannot pause the next round',async()=>{
 const h=game();try{await h.start();h.inputs[0].args.onInterrupted('device_interrupted');assert.equal(h.engine.snapshot().phase,'paused');assert(h.inputs[0].disposed);h.click(h.q('[data-fluency-resume]'));await tick();h.inputs[0].args.onInterrupted('device_interrupted');assert.equal(h.engine.snapshot().phase,'calibrating');h.steps(315);assert.equal(h.engine.snapshot().phase,'running');h.controller.abort();assert(h.inputs.every(input=>input.disposed));assert.equal(h.frames.size,0);}finally{h.dispose();}
});
test('permission and network failure show retry and stop every opened resource',async()=>{
 for(const failure of ['permission','network']){let disposed=0;const h=game({dependencies:{voiceFactory:()=>({open:async()=>{if(failure==='permission')throw Object.assign(Error('denied'),{name:'NotAllowedError'});},dispose(){disposed++;}}),questionPicker:{async next(){if(failure==='network')throw Error('offline');return {id:ID(1),part:'part3',promptText:'Synthetic test question for failure.'};}}}});try{h.click(h.q('[data-fluency-start]'));await tick();assert.equal(h.engine.snapshot().phase,'error');assert(disposed>0);assert.equal(h.frames.size,0);assert.equal(h.q('[data-fluency-start]').hidden,false);assert.equal(h.q('.fluency-status').getAttribute('role'),'alert');}finally{h.dispose();}}
});
test('late permission after Quit cannot restart a cancelled round',async()=>{
 let grant,disposed=0;const h=game({dependencies:{voiceFactory:()=>({open:()=>new Promise(resolve=>grant=resolve),dispose(){disposed++;}})}});try{h.click(h.q('[data-fluency-start]'));h.click(h.q('[data-fluency-quit]'));grant();await tick();assert.equal(h.engine.snapshot().phase,'idle');assert.equal(h.frames.size,0);assert(disposed>0);}finally{h.dispose();}
});
test('suspended audio during opening offers an explicit Resume and cleans the failed input',async()=>{
 let disposed=0;const h=game({dependencies:{voiceFactory:()=>({open:async()=>{throw {code:'audio_suspended'};},dispose(){disposed++;}})}});try{h.click(h.q('[data-fluency-start]'));await tick();assert.equal(h.engine.snapshot().phase,'paused');assert.equal(h.q('[data-fluency-resume]').hidden,false);assert(disposed>0);assert.equal(h.frames.size,0);}finally{h.dispose();}
});
test('late background notification pauses at the last trustworthy sample rather than penalizing throttling',async()=>{
 const h=game();try{await h.start();h.steps(12,100);const before=h.engine.snapshot().elapsedMs;h.deps.cancelFrame([...h.frames.keys()][0]);h.step(50000);h.hide();assert.equal(h.engine.snapshot().phase,'paused');assert.equal(h.engine.snapshot().elapsedMs,before);assert(h.inputs[0].disposed);}finally{h.dispose();}
});
test('question picker uses only authorized bounded GET data and avoids immediate repeats',async()=>{
 const h=setup();try{h.stub({'/api/speaking/practice/questions':{prompts:[{id:ID(601),part:'part3',promptText:'Why is this a synthetic test question?'},{id:ID(602),part:'part3',promptText:'How would you explain this synthetic case?'}]}});const p=createQuestionPicker(),first=await p.next(h.ctx.signal),second=await p.next(h.ctx.signal),third=await p.next(h.ctx.signal);assert.notEqual(first.id,second.id);assert.notEqual(second.id,third.id);assert.equal(h.calls.length,1);assert(h.calls.every(call=>call.method==='GET'));assert(h.calls[0].path.includes('channel=practice_alone'));}finally{h.dispose();}
});
test('empty or failed bank never invents a production question',async()=>{
 const h=setup();try{h.stub({'/api/speaking/practice/questions':{prompts:[]}});await assert.rejects(createQuestionPicker().next(h.ctx.signal),error=>error.code==='question_empty');assert.equal(h.calls.length,3);assert(h.calls.every(call=>call.method==='GET'));}finally{h.dispose();}
});
