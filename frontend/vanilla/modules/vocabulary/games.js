import {h,request,guardArray,params,SETS,GAMES,notifyLedger} from './shared.js';
import {anySignal} from '../../js/signals.js';
import {privateScope} from '../../js/private-scope.js';
import {flashcards} from './game-flashcards.js';
import {classicGame,matchingGame} from './game-classic.js';
import {typingRace} from './game-race.js';
import {nextHandoffWord,handoffSlice,handoffSourceDeck,mergeHandoffState} from './game-handoff.js';
export const gameURL=(id,set,folderId,topicPack,extras={})=>`/app/vocabulary/games/${id}?${params({set,...set==='folder'?{folderId}:{},...set==='topic'?{topicPack}:{},...extras})}`;
const setQuery=(set,folder,pack)=>params({set,...set==='folder'?{folderId:folder}:{},...set==='topic'?{topicPack:pack}:{}});

export function mountGames(ctx,host,id=null){
 const {dict,signal,url}=ctx,t=dict.vocabulary,g=t.games;let folders=[],packs=[],selected=SETS.includes(url.searchParams.get('set'))?url.searchParams.get('set'):'due',folder=url.searchParams.get('folderId')??'',pack=url.searchParams.get('topicPack')??'',sequence=0,roundLife,metaFailed=false,attempt=null,batch=/^\d+$/.test(url.searchParams.get('batch')??'')?Number(url.searchParams.get('batch')):null,
 from=GAMES.includes(url.searchParams.get('from'))&&url.searchParams.get('from')!==id?url.searchParams.get('from'):null,
 cursor=url.searchParams.get('cursor')??null,sessionDeck=[],sessionBatch=null,pendingSave=Promise.resolve(true),
 busyAnswers=0,switching=false;
 const head=h('div',{class:'flex flex-col gap-4'}),game=h('div'),
 switcher=h('nav',{'data-game-switcher':'',class:'vocabulary-game-switcher',hidden:!id}),
 node=h('div',{class:id==='cards'?'vocabulary-cards-page mx-auto flex w-full flex-col gap-4':id?'mx-auto flex w-full max-w-4xl flex-col gap-4':'flex flex-col gap-4',...(id?{'data-dedicated-game':id}:{'data-games-library':''})},head,game,switcher);host.append(node);
 function source(){const detail=selected==='folder'?folders.find(x=>x.id===folder)?.name:selected==='topic'?packs.find(x=>x.id===pack)?.label:null;return [g.set[selected],detail].filter(Boolean).join(' · ');}
 function address(){const next=new URL(window.location.href),query=new URLSearchParams(setQuery(selected,folder,pack));if(batch!==null)query.set('batch',String(batch));if(from){query.set('from',from);if(cursor)query.set('cursor',cursor);}next.search=query.toString();window.history.replaceState(window.history.state,'',next.pathname+next.search);ctx.url.search=next.search;}
 function select(label,options,current,change,attrs={}){return h('label',{class:'flex flex-col gap-1 text-xs text-ink-500'},label,h('select',{class:'input','aria-label':label,value:current,...attrs,onChange:event=>{change(event.target.value);batch=null;from=null;cursor=null;address();renderHead();void load();}},options.map(o=>h('option',{value:o.value},o.label))));}
 function renderHead(data=null,loading=false,failed=false){const controls=[select(g.set.label,SETS.map(value=>({value,label:g.set[value]})),selected,value=>selected=value,{'data-game-set':''})];
  if(selected==='folder'&&folders.length)controls.push(select(t.folders.title,folders.map(x=>({value:x.id,label:`${x.name} · ${x.count??0}`})),folder,value=>folder=value));
  if(selected==='topic'&&packs.length)controls.push(select(t.packs.title,packs.map(x=>({value:x.id,label:`${x.label} · ${x.wordCount??0}`})),pack,value=>pack=value));
  const status=h('p',{class:id?'text-xs text-ink-500 sm:col-span-2':'mt-3 text-xs text-ink-500','data-game-set-status':'','aria-live':'polite'},loading?dict.common.loading:failed?g.loadError:`${source()} · ${data?.total??0} ${t.packs.words}${!id&&data?` · ${data.due??0} ${t.summary.dueToday}`:''}`);
  head.replaceChildren(h('a',{href:id?'/app/vocabulary/games?'+setQuery(selected,folder,pack):'/app/vocabulary',class:'btn-ghost w-fit',...(id?{'data-game-back':''}:{'data-games-back-to-vocabulary':''})},'← '+(id?g.backToGames:dict.nav.vocabulary)),h('header',{class:id?'flex flex-wrap items-end justify-between gap-3':''},h('div',{},h('h1',{class:'font-display text-2xl text-ink-900'},id?g[id]:g.title),h('p',{class:'mt-1 text-sm text-ink-500',...(id?{'data-game-source':''}:{})},id?g.source+': '+source():g.hint)),id&&data?h('div',{class:'flex flex-wrap items-center gap-2'},h('span',{class:'text-xs text-ink-500'},String(data.total??0)+' '+t.packs.words),attempt?h('button',{type:'button',class:'btn-secondary','data-game-restart':'',onClick:()=>void restartAttempt()},ctx.locale==='uz'?'Qayta urinish':'Try again'):null):null),id?h('section',{class:'card grid gap-2 p-4 sm:grid-cols-2','aria-label':g.set.label,'data-game-set-controls':''},controls,status):h('section',{class:'card p-4','aria-label':g.set.label},h('div',{class:'grid gap-2 sm:grid-cols-2'},controls),status));
 }
 function library(data){const total=data?.total??0,icons={cards:'🃏',choice:'✅',match:'🧩',gap:'✏️',race:'⌨️',translation:'📖',builder:'🧱'};
  game.replaceChildren(h('div',{class:'vocabulary-game-grid','data-vocabulary-games':''},GAMES.map(key=>h('a',{
   href:gameURL(key,selected,folder,pack),'data-game':key,'data-available':String(total>0),class:'vocabulary-game-tile'
  },h('span',{class:'vocabulary-game-tile-icon','aria-hidden':'true'},icons[key]),
     h('strong',{class:'vocabulary-game-tile-title'},g[key]),
     h('span',{class:'vocabulary-game-tile-hint'},g[key+'Hint']),
     !total?h('span',{class:'vocabulary-game-tile-status'},g.noWordsInSet):null))),
    !total?h('p',{class:'text-sm text-ink-500'},g.noWords):null,
    h('p',{class:'text-xs text-ink-500'},g.casualNote));
 }
 async function restartAttempt(){
  if(!id||!attempt||roundLife?.signal.aborted)return;
  const button=head.querySelector('[data-game-restart]');if(button)button.disabled=true;
  try{
   const old=attempt;
   const newAttempt=await request('/api/vocabulary/games',{method:'POST',body:{...scope(),action:'start',deck:old.deck,state:{}},signal:roundLife.signal});
   if(roundLife.signal.aborted)return;
   attempt=newAttempt.attempt;
   await load();
  }catch{
   if(button)button.disabled=false;
   game.prepend(h('p',{role:'alert',class:'text-sm text-band-bad'},g.loadError));
  }
 }
 function scope(){return {gameId:id,set:selected,...selected==='folder'?{folderId:folder}:{},...selected==='topic'?{topicPack:pack}:{},...id==='cards'&&batch!==null?{batchIndex:batch}:{}};}

 function renderSwitcher(){
  if(!id)return;
  const title=ctx.locale==='uz'?'Boshqa o‘yinda davom ettirish':'Continue in another game';
  const helper=ctx.locale==='uz'
   ?'Shu to‘plamdagi qolgan so‘zlardan davom eting. Natijalar va o‘yin ballari saqlanadi.'
   :'Continue with the remaining words in this set. Saved results and game scores stay intact.';
  switcher.replaceChildren(h('h2',{class:'text-base font-medium text-ink-900'},title),
   h('p',{class:'text-xs text-ink-500'},helper),
   h('div',{class:'vocabulary-game-switch-grid'},GAMES.filter(key=>key!==id).map(key=>h('button',{
    type:'button',class:'vocabulary-game-switch-button','data-game-switch':key,
    disabled:switching||busyAnswers>0||!attempt,
    onClick:()=>void switchGame(key)
   },h('span',{},g[key]),h('span',{class:'vocabulary-game-switch-action'},ctx.locale==='uz'?'da davom ettirish':'Continue here')))));
 }
 async function switchGame(nextGame){
  if(!id||!attempt||switching||busyAnswers>0||roundLife?.signal.aborted)return;
  switching=true;renderSwitcher();
  try{
   if(await pendingSave===false)throw Error('unsaved_attempt');
   const full=handoffSourceDeck(attempt,sessionDeck);
   const next=nextHandoffWord(id,attempt.state??{},full);
   if(!full.length)throw Error('empty_attempt');
   const extras={
    ...(Number.isSafeInteger(sessionBatch)?{batch:sessionBatch}:{}),
    from:id,cursor:next??'end'
   };
   await ctx.navigate(gameURL(nextGame,selected,folder,pack,extras));
  }catch{
   if(!roundLife?.signal.aborted)game.prepend(h('p',{role:'alert',class:'text-sm text-band-bad','data-game-switch-error':''},
    ctx.locale==='uz'?'Davom etish uchun natijani saqlab bo‘lmadi. Qayta urinib ko‘ring.':'Could not save this position. Please try again.'));
  }finally{switching=false;if(!roundLife?.signal.aborted)renderSwitcher();}
 }
 async function load(){
  const current=++sequence;roundLife?.abort();roundLife=new window.AbortController();
  const roundSignal=anySignal([signal,roundLife.signal]);
  attempt=null;sessionDeck=[];sessionBatch=null;pendingSave=Promise.resolve(true);
  switching=false;busyAnswers=0;renderHead(null,true);
  switcher.replaceChildren();
  game.replaceChildren(h('p',{class:'card p-4 text-sm text-ink-500',role:'status','aria-busy':'true'},dict.common.loading));
  try{
   const query=setQuery(selected,folder,pack);
   const options={signal:roundSignal,timeoutMs:12000};
   let data,handoff=null;
   if(id&&from){
    const sourceScope={
     gameId:from,set:selected,
     ...selected==='folder'?{folderId:folder}:{},
     ...selected==='topic'?{topicPack:pack}:{},
     ...from==='cards'&&batch!==null?{batchIndex:batch}:{}
    };
    const source=await request('/api/vocabulary/games?'+params({...sourceScope,attempt:1}),options);
    if(roundSignal.aborted||current!==sequence)return;
    if(!source.attempt)throw Error('handoff_source_missing');
    let full=handoffSourceDeck(source.attempt);
    let section=null;
    if(batch!==null){
     section=await request('/api/vocabulary/games?'+query+'&game=cards&batches=1&batch='+batch,options);
     if(roundSignal.aborted||current!==sequence)return;
     const present=new Set(guardArray(section,'words').map(w=>w.id));
     full=full.filter(wordId=>present.has(wordId));
     if(!full.length)full=section.words.map(w=>w.id);
    }
    if(cursor==='end'){
     sessionDeck=full;sessionBatch=batch;
     attempt={state:{_handoff:{sourceDeck:full}},deck:full,revision:0};
     renderHead(section??{total:full.length});
     game.replaceChildren(h('section',{class:'card flex flex-col gap-3 p-5','data-game-group-complete':'',role:'status'},
      h('h2',{class:'text-lg font-medium text-ink-900'},ctx.locale==='uz'?'Guruhdagi so‘zlar tugadi':'This word group is complete'),
      h('p',{class:'text-sm text-ink-500'},ctx.locale==='uz'
       ?'Bu guruhda qolgan so‘z yo‘q. Flashcards orqali keyingi ochilgan guruhga o‘ting.'
       :'No words remain in this group. Open the next unlocked group in Flashcards.'),
      h('a',{class:'btn-primary w-fit',href:gameURL('cards',selected,folder,pack,batch!==null?{batch}:{})},g.cards)));
     renderSwitcher();return;
    }
    if(!cursor||!full.includes(cursor))throw Error('handoff_cursor_changed');
    handoff={sourceDeck:full,cursor,batchIndex:batch};
    if(id==='cards'){
     data=section??await request('/api/vocabulary/games?'+query+'&game=cards&batches=1'+(batch!==null?'&batch='+batch:''),options);
    }else{
     const ids=handoffSlice(full,cursor,24);
     if(!ids.length)throw Error('handoff_deck_empty');
     data=await request('/api/vocabulary/games?'+query+'&limit=24&game='+id+'&entryIds='+encodeURIComponent(ids.join(',')),options);
    }
   }else{
    data=await request('/api/vocabulary/games?'+query+
     (id==='cards'?'&game=cards&batches=1'+(batch!==null?'&batch='+batch:'')
      :id?'&limit=24&random=1&game='+id:'&limit=1'),options);
   }
   if(roundSignal.aborted||current!==sequence)return;
   if(id==='cards'&&Number.isSafeInteger(data.batchIndex)){batch=data.batchIndex;address();}
   if(id&&!handoff){
    const saved=await request('/api/vocabulary/games?'+params({...scope(),attempt:1}),options);
    if(roundSignal.aborted||current!==sequence)return;
    attempt=saved.attempt??null;
    if(attempt&&id!=='cards'){
     data=await request('/api/vocabulary/games?'+query+'&limit=24&game='+id+
      '&entryIds='+encodeURIComponent(attempt.deck.join(',')),options);
    }
   }
   if(roundSignal.aborted||current!==sequence)return;
   if(!id){renderHead(data);library(data);return;}
   let words=guardArray(data,'words');
   if(attempt){
    const lookup=new Map(words.map(w=>[w.id,w]));
    if(!Array.isArray(attempt.deck)||attempt.deck.some(entry=>!lookup.has(entry)))throw Error('attempt_deck_changed');
    words=attempt.deck.map(entry=>lookup.get(entry));
   }
   sessionBatch=Number.isSafeInteger(data.batchIndex)?data.batchIndex:
    Number.isSafeInteger(attempt?.state?._handoff?.batchIndex)?attempt.state._handoff.batchIndex:batch;
   sessionDeck=handoff?.sourceDeck??handoffSourceDeck(attempt,words.map(w=>w.id));
   if(!words.length){
    renderHead(data);game.replaceChildren(h('p',{class:'card p-4 text-sm text-ink-500',role:'status','data-game-empty':''},
     data.total?g.noEligible:g.noWordsInSet));renderSwitcher();return;
   }
   if(!attempt){
    const initial=handoff
     ?mergeHandoffState(id,id==='cards'
       ?{deck:handoff.sourceDeck,index:handoff.sourceDeck.indexOf(handoff.cursor)}
       :{},sessionDeck,sessionBatch)
     :{};
    const created=await request('/api/vocabulary/games',{method:'POST',body:{
     ...scope(),action:'start',deck:words.map(w=>w.id),state:initial
    },signal:roundSignal,timeoutMs:12000});
    if(roundSignal.aborted||current!==sequence)return;
    attempt=created.attempt;
   }
   if(handoff){from=null;cursor=null;address();}
   renderHead(data);
   const gameCtx={...ctx,signal:roundSignal};
   let saveQueue=Promise.resolve(true);
   const save=state=>{
    const nextState=mergeHandoffState(id,state,sessionDeck,sessionBatch);
    saveQueue=saveQueue.catch(()=>false).then(async()=>{
     if(roundSignal.aborted||current!==sequence)return false;
     const payload=await request('/api/vocabulary/games',{method:'POST',body:{
      ...scope(),action:'save',attemptId:attempt.attemptId,revision:attempt.revision,state:nextState
     },signal:roundSignal,timeoutMs:12000});
     if(roundSignal.aborted||current!==sequence)return false;
     attempt=payload.attempt;sessionDeck=handoffSourceDeck(attempt,sessionDeck);
     return true;
    });
    pendingSave=saveQueue.catch(()=>false);return pendingSave;
   };
   const answer=async(entryId,submission)=>{
    busyAnswers++;renderSwitcher();
    try{
     const result=await request('/api/vocabulary/games',{method:'POST',body:{
      entryId,set:selected,gameId:id,
      ...id==='cards'&&Number.isSafeInteger(data.batchIndex)?{batchIndex:data.batchIndex}:{},
      ...selected==='folder'?{folderId:folder}:{},
      ...selected==='topic'?{topicPack:pack}:{},submission
     },signal:roundSignal,timeoutMs:12000});
     if(roundSignal.aborted)return null;
     privateScope.invalidate('vocabulary:');if(result.awarded>0)notifyLedger();
     return result;
    }catch{return null;}
    finally{busyAnswers=Math.max(0,busyAnswers-1);if(!roundSignal.aborted)renderSwitcher();}
   };
   const props={id,words,source:source(),marks:data.selfAssessments??{},answer,
    batches:data.batches,batchIndex:data.batchIndex,ordered:!!handoff,
    progress:attempt.state??{},save,onRetry:restartAttempt,
    onBatch:next=>{batch=next;from=null;cursor=null;address();void load();}
   };
   if(id==='cards')flashcards(gameCtx,game,props);
   else if(id==='race')typingRace(gameCtx,game,props);
   else if(id==='match')matchingGame(gameCtx,game,props);
   else classicGame(gameCtx,game,props);
   renderSwitcher();
  }catch{
   if(!signal.aborted&&current===sequence){
    renderHead(null,false,true);
    game.replaceChildren(h('div',{class:'card flex items-center gap-3 p-4 text-sm text-band-bad',role:'alert'},
     h('p',{},g.loadError),h('button',{type:'button',class:'btn-secondary','data-game-load-retry':'',
      onClick:()=>metaFailed?void init():void load()},dict.errorPage.retry)));
   }
  }
 }
 async function init(){renderHead(null,true);try{const [f,p]=await Promise.all([request('/api/vocabulary/folders',{signal}),request('/api/vocabulary/packs',{signal})]);if(signal.aborted)return;metaFailed=false;folders=guardArray(f,'folders');packs=guardArray(p,'packs').map(x=>({...x,label:typeof x.label==='object'?x.label[ctx.locale]??x.label.en:x.label}));folder=folders.some(x=>x.id===folder)?folder:folders[0]?.id??'';pack=packs.some(x=>x.id===pack)?pack:packs[0]?.id??'';await load();}catch{if(!signal.aborted){metaFailed=true;renderHead(null,false,true);game.replaceChildren(h('div',{class:'card flex items-center gap-3 p-4 text-sm text-band-bad',role:'alert'},h('p',{},g.loadError),h('button',{type:'button',class:'btn-secondary','data-game-load-retry':'',onClick:()=>void init()},dict.errorPage.retry)));}}}
 signal.addEventListener('abort',()=>{sequence++;roundLife?.abort();},{once:true});void init();
}

