import {h,shuffle,normalizeGameAnswer,gameButton,gameFrame,gameResult,gameTimers} from './game-common.js';
import {sentenceFor,gapPrompt,eligibleWords,choiceOptions} from './game-content.js';

/** Each practice game owns its round and timer. Only the API can award ledger points. */
export function classicGame(ctx,host,{id,words,answer}){
 const g=ctx.dict.vocabulary.games,timers=gameTimers(ctx),pool=eligibleWords(words,id);
 const deck=shuffle(pool).filter(w=>id!=='choice'||choiceOptions(w,pool).length>1).slice(0,id==='builder'?8:10);let index=0,correct=0,value='',checked=null,picked=null,hint=false,built=[],tiles=[],options=[],busy=false,error=false,epoch=0;
 const target=()=>sentenceFor(deck[index]??{}).split(/\s+/).filter(Boolean);
 function prepare(){epoch++;value='';checked=null;picked=null;hint=false;built=[];busy=false;error=false;tiles=shuffle(target().map((word,key)=>({word,key})));const w=deck[index];options=w?shuffle(choiceOptions(w,shuffle(pool))):[];}
 function advance(){timers.cancel();index++;prepare();paint();}
 function restart(){timers.cancel();index=0;correct=0;prepare();paint();}
 async function verdict(submission){
  if(checked!==null||busy)return;const current=epoch;busy=true;error=false;paint();
  let result;try{result=await answer(deck[index].id,submission);}catch{result=null;}
  if(ctx.signal.aborted||current!==epoch)return;busy=false;
  if(result?.verified!==true||typeof result.correct!=='boolean'){error=true;picked=null;paint();host.querySelector('input')?.focus();return;}
  checked=result.correct;if(checked)correct++;paint();timers.later(advance,id==='choice'?(checked?900:1800):(checked?950:1700));
 }
 const status=()=>h('span',{class:checked?'text-sm text-band-good':'text-sm text-band-bad'},checked?g.score:`${g.wrongAnswer}: ${id==='builder'?target().join(' '):deck[index].term}`);
 const controls=()=>h('div',{class:'flex flex-wrap items-center justify-between gap-2'},status(),gameButton(g.next,advance,{'data-game-next':''}));
 function check(){if(checked!==null||busy||!value.trim())return;void verdict({kind:'spelling',text:value});}
 function paint(){if(ctx.signal.aborted)return;const w=deck[index];
  if(!w){host.replaceChildren(gameFrame(ctx,id,String(correct),!deck.length?h('p',{class:'text-sm text-ink-500'},g.noEligible):gameResult(ctx,correct,deck.length,restart)));return;}
  const counter=`${g.progress} ${index+1} / ${deck.length}${id==='builder'?'':` · ${g.score} ${correct}`}`,body=[];
  if(id==='choice'){
   body.push(h('p',{class:'rounded-md bg-paper-sunken p-4 text-center text-lg text-ink-900','data-mcq-prompt':''},w.definitionEn),h('div',{class:'grid gap-2 sm:grid-cols-2'},options.map(option=>{const right=normalizeGameAnswer(option)===normalizeGameAnswer(w.term),state=picked&&checked!==null?(right?'right':option===picked?'wrong':'idle'):'idle';return gameButton(option,()=>{if(picked||busy)return;picked=option;void verdict({kind:'spelling',text:option});},{'data-option':option,'data-state':state,'data-choice':words.find(x=>x.term===option)?.id,disabled:!!picked||busy,class:'btn border text-sm '+(state==='right'?'border-band-good bg-band-good/10 text-band-good':state==='wrong'?'border-band-bad bg-band-bad/10 text-band-bad':'border-ink-100 bg-paper-raised text-ink-900')});})));
   if(picked&&checked!==null)body.push(h('div',{class:'flex flex-wrap items-center justify-between gap-2','data-mcq-feedback':'',role:'status','aria-live':'polite'},h('span',{class:'text-xs text-ink-500'},`${checked?g.score:g.wrongAnswer}: ${w.term}`),gameButton(g.next,advance,{'data-mcq-next':''})));
  }else if(id==='builder'){
   body.push(h('p',{class:'text-xs text-ink-500'},g.builderHint+' · '+w.term),h('div',{class:'flex min-h-[52px] flex-wrap items-center gap-1.5 rounded-md border border-dashed border-ink-100 bg-paper-sunken p-2','data-builder-answer':''},built.length?built.map(tile=>gameButton(tile.word,()=>{if(checked!==null||busy)return;built=built.filter(x=>x.key!==tile.key);tiles.push(tile);paint();},{class:'rounded-sm bg-signal-600 px-2 py-1 text-xs text-signal-contrast','data-built-tile':tile.key})):h('span',{class:'px-1 text-xs text-ink-300'},g.scrambleHint)),h('div',{class:'flex flex-wrap gap-1.5','data-builder-tiles':''},tiles.map(tile=>gameButton(tile.word,()=>{if(checked!==null||busy)return;tiles=tiles.filter(x=>x.key!==tile.key);built.push(tile);paint();},{class:'rounded-sm border border-ink-100 px-2 py-1 text-xs text-ink-900 hover:border-signal-600','data-builder-tile':tile.key}))),h('div',{class:'flex flex-wrap items-center gap-2'},gameButton(g.check,()=>{if(checked!==null||busy||!built.length||tiles.length)return;const text=built.map(x=>x.word).join(' ');void verdict({kind:'sentence',text});},{class:'btn-primary',disabled:checked!==null||busy||!built.length||!!tiles.length,'data-game-check':''}),gameButton(g.clear,()=>{if(busy||checked!==null)return;timers.cancel();built=[];tiles=shuffle(target().map((word,key)=>({word,key})));checked=null;paint();},{class:'btn-ghost text-xs',disabled:busy||checked!==null})));
   if(checked!==null)body.push(controls());
  }else{
   let prompt=w.translationUz;
   if(id==='gap')prompt=gapPrompt(w);
   body.push(h('p',{class:`rounded-md bg-paper-sunken p-4 ${id==='translation'?'text-center text-lg':'text-sm'} text-ink-900`,[id==='gap'?'data-gap-sentence':'data-translation-prompt']:''},prompt));
   const submit=gameButton(g.check,check,{class:'btn-primary',disabled:checked!==null||busy||!value.trim(),'data-game-check':''}),input=h('input',{class:'input max-w-xs',placeholder:g.typeAnswer,'aria-label':g[id],value,readOnly:checked!==null||busy,autoCapitalize:'off',spellcheck:false,onInput:event=>{value=event.target.value;submit.disabled=checked!==null||busy||!value.trim();},onKeyDown:event=>{if(event.key==='Enter'){event.preventDefault();check();}}}),row=h('div',{class:'flex flex-wrap items-center gap-2'},input,submit);
   if(id==='gap'){const hintText=h('span',{class:'text-xs text-ink-500',hidden:!hint},`${g.hintLabel}: ${w.term.slice(0,Math.max(2,Math.ceil(w.term.length/3)))}…`);row.append(gameButton(g.hintLabel,()=>{hint=true;hintText.hidden=false;},{class:'btn-ghost text-xs'}),hintText);}body.push(row);
   if(checked!==null){if(id==='gap')body.push(controls());else{
    const feedback=checked?h('div',{class:'rounded-md border border-band-good/40 bg-band-good/10 px-3 py-2','data-translation-reveal':''},h('p',{class:'text-sm text-band-good'},g.score),h('p',{class:'mt-1 text-sm text-ink-800','data-translation-answer':''},[w.term,...w.acceptedTranslations??[]].join(' · ')),w.collocations?h('p',{class:'mt-1 text-xs text-ink-500'},w.collocations):null):h('div',{class:'rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2','data-translation-example':''},h('p',{class:'text-sm text-warn-800'},g.tryAgain),w.exampleSentence?h('p',{class:'mt-1 text-sm text-ink-700'},w.exampleSentence):null);
    body.push(h('div',{class:'flex flex-col gap-2'},feedback,h('div',{class:'flex flex-wrap items-center justify-between gap-2'},!checked?gameButton(g.tryAgain,()=>{timers.cancel();value='';checked=null;paint();host.querySelector('input')?.focus();},{'data-translation-retry':''}):null,gameButton(g.next,advance,{'data-game-next':''}))));
   }}
  }
  if(busy)body.push(h('p',{role:'status','aria-live':'polite','data-game-verifying':''},ctx.dict.common.loading));
  if(error)body.push(h('p',{role:'alert','data-game-verification-error':'',class:'text-sm text-band-warn'},g.answerUnverified));
  host.replaceChildren(gameFrame(ctx,id,counter,body));
 }
 prepare();paint();
}

export function matchingGame(ctx,host,{words,answer}){
 const g=ctx.dict.vocabulary.games,timers=gameTimers(ctx);let left,right,selected=null,wrong=null,matched=new Set(),busy=false,error=false,epoch=0;
 function restart(){epoch++;timers.cancel();left=shuffle(eligibleWords(words,'match')).slice(0,6);right=shuffle(left);selected=null;wrong=null;matched=new Set();busy=false;error=false;paint();}
 async function choose(word){
  if(!selected||matched.has(word.id)||wrong||busy)return;const chosen=selected,current=epoch;busy=true;error=false;paint();
  let result;try{result=await answer(chosen.id,{kind:'pair',pairEntryId:word.id});}catch{result=null;}
  if(ctx.signal.aborted||current!==epoch)return;busy=false;
  if(result?.verified!==true||typeof result.correct!=='boolean'){error=true;paint();return;}
  if(result.correct){matched.add(chosen.id);selected=null;paint();}else{wrong=word.id;paint();timers.later(()=>{wrong=null;selected=null;paint();},600);}
 }
 function paint(){if(ctx.signal.aborted)return;const board=h('div',{class:'grid gap-3 sm:grid-cols-2','data-matching-game':''},h('ul',{class:'flex flex-col gap-2'},left.map(w=>h('li',{},gameButton(w.term,()=>{if(!wrong&&!busy){selected=w;error=false;paint();}},{'data-left':w.term,'data-match-left':w.id,'aria-pressed':selected?.id===w.id,disabled:matched.has(w.id)||busy,class:'w-full rounded-sm border px-3 py-2 text-left text-sm '+(matched.has(w.id)?'border-band-good bg-band-good/10 text-band-good':selected?.id===w.id?'border-signal-600 bg-signal-100 text-signal-700':'border-ink-100 bg-paper-raised text-ink-900')})))),h('ul',{class:'flex flex-col gap-2'},right.map(w=>h('li',{},gameButton(w.definitionEn,()=>choose(w),{'data-right':w.id,'data-match-right':w.id,disabled:matched.has(w.id)||!selected||!!wrong||busy,class:'w-full rounded-sm border px-3 py-2 text-left text-xs '+(matched.has(w.id)?'border-band-good bg-band-good/10 text-band-good':wrong===w.id?'border-band-bad bg-band-bad/10 text-band-bad':'border-ink-100 bg-paper-raised text-ink-700')})))));
  host.replaceChildren(gameFrame(ctx,'match',`${matched.size} / ${left.length}`,[board,busy?h('p',{role:'status'},ctx.dict.common.loading):null,error?h('p',{role:'alert','data-game-verification-error':''},g.answerUnverified):null,matched.size===left.length?gameResult(ctx,matched.size,left.length,restart):null]));
 }restart();
}
