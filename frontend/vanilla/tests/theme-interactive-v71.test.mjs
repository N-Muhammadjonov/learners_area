/** Actual native controls with isolated data; CSS cascade, not browser paint. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {setup,tick} from './staff-final30/harness.mjs';
import {colorCascade,contrastRatio} from './helpers/css-contrast.mjs';
import {flashcards} from '../modules/vocabulary/game-flashcards.js';
import {classicGame,matchingGame} from '../modules/vocabulary/game-classic.js';
import {typingRace} from '../modules/vocabulary/game-race.js';
import {renderOnboarding} from '../modules/auth/onboarding.js';
import {renderPending} from '../modules/auth/pending.js';
import * as publicAuth from '../modules/auth/public.js';
const styles=['../css/global.css','../css/campus.css','../modules/auth-redesign.css'].map(p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'));
const words=['run','walk','fly'].map((term,i)=>({id:String(i),term,definitionEn:'Move '+term,translationUz:'Harakat',exampleSentence:'We '+term+' every day.',partOfSpeech:'verb',acceptedTranslations:[],sourceType:'reading'}));
function check(h,label){const cascade=colorCascade(document,styles),failures=[];let checked=0;
 for(const node of h.ctx.root.querySelectorAll('*')){const text=(node.matches('input,textarea')?node.value||node.placeholder:[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(' ')).trim();if(!/[\p{L}\p{N}]/u.test(text)||node.closest('[disabled],[aria-disabled=true],[data-sidebar-brand]')||node.matches(':disabled'))continue;const s=cascade.get(node);if(!s.visible)continue;
  // The public footer sits over an absolute dark artwork layer, not the shell's
  // unused Day background. This probe has no layout/paint engine; read that layer.
  const backdrop=node.matches('[data-auth-shell] > .w-full > .text-center')?node.closest('[data-auth-shell]').querySelector('.la-public-background'):null;
  const background=backdrop?cascade.get(backdrop).background:s.background;
  const ratio=contrastRatio(s.color,background);checked++;if(ratio<4.5)failures.push(`${text.slice(0,70)}: ${ratio.toFixed(2)} (${node.className}; ${s.color} / ${background}; ${s.foregroundRule})`);}
 assert(checked>0,label);assert.deepEqual([...cascade.unknown],[],label);assert.deepEqual(failures,[],label);
}
for(const theme of ['day','night'])for(const focus of ['off','on']){
 test(`${theme}/${focus}: seven game initial and answer states remain readable`,async()=>{
  for(const variant of ['cards','choice','match','gap','translation','builder','race','race-wrong']){const id=variant==='race-wrong'?'race':variant;const h=setup({path:'/app/vocabulary/games/'+id});try{
   document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;
   const outer=h.ctx.root;outer.innerHTML='<div data-shell data-campus-shell><main data-shell-main></main></div>';h.ctx.root=outer.querySelector('main');let serial=0;h.ctx.gameSetTimeout=()=>++serial;h.ctx.gameClearTimeout=()=>{};
   const args={id,words,source:'My words',answer:async()=>({verified:true,correct:variant!=='race-wrong',awarded:0})};
   if(id==='cards')flashcards(h.ctx,h.ctx.root,args);else if(id==='race')typingRace(h.ctx,h.ctx.root,args);else if(id==='match')matchingGame(h.ctx,h.ctx.root,args);else classicGame(h.ctx,h.ctx.root,args);
   check(h,id+' initial');
   if(id==='cards'){h.click(h.q('[data-flashcard]'));check(h,id+' flipped');h.click(h.q('[data-mark=notYet]'));}
   else if(id==='choice')h.click(h.q('[data-option]'));
   else if(id==='match'){h.click(h.q('[data-match-left="0"]'));h.click(h.q('[data-match-right="1"]'));}
   else if(id==='builder')h.click(h.q('[data-builder-tile]'));
   else if(id==='race'){h.input(h.q('[data-race-input]'),'run');h.click(h.q('[data-race-submit]'));await tick();}
   else {h.input(h.q('input'),'incorrect');h.click(h.q('[data-game-check]'));}
   check(h,id+' answer');
  }finally{h.dispose();}}
 });
 test(`${theme}/${focus}: login, registration, reset and account-status controls remain readable`,async()=>{
  for(const path of ['/login','/register','/reset-password','/reset-password/confirm','/onboarding','/pending']){const h=setup({path,theme});try{
   window.localStorage.setItem('la-theme',theme);document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;
   h.stub({'/api/frontend/public':{version:1,public:{auth:{passwordEnabled:true,telegramOnly:false,telegramIntentEnabled:false,telegramConfigured:false,googleConfigured:false}}}});
   if(path==='/onboarding')h.ctx.root.append(renderOnboarding(h.ctx));
   else if(path==='/pending'){h.ctx.session.user.accountStatus='pending';h.ctx.root.append(renderPending(h.ctx,{openRequest:null}));}
   else await h.mount(publicAuth);
   document.documentElement.dataset.theme=theme;document.documentElement.dataset.focus=focus;check(h,path);
  }finally{h.dispose();}}
 });
}
