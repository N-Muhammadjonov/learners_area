import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {readingHistoryDTO} from '../../js/adapters/reading-v44.js';
import {RegionFailureNotice,BackLink} from '../shared/presentation.js';
import {IconReading} from '../../js/generated/icons.js';
/** Original src/app/app/(shell)/reading/history/page.tsx: every Reading attempt, newest first. */
export function mountHistory(context){
 const {root,url,signal,dict}=context,host=el('div',{'data-native-view':'reading-history'});root.append(host);let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   const {rows}=readingHistoryDTO(raw);
   host.replaceChildren(el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},
    BackLink({fallbackHref:'/app/reading',label:dict.common.back}),
    el('h1',{class:'font-display text-2xl text-ink-900'},dict.reading.historyTitle),
    rows.length===0?el('div',{class:'flex flex-col items-center gap-2 py-10 text-center'},el('p',{class:'font-display text-ink-900'},dict.dashboard.noAttemptsYet),el('a',{class:'btn-primary',href:'/app/reading'},dict.reading.pickPassage)):null,
    rows.map(({attempt,passage})=>el('a',{href:`/app/reading/attempts/${attempt.id}`,class:'block'},el('div',{class:'card flex items-center justify-between p-5 hover:border-signal-400'},
     el('div',{},el('p',{class:'text-sm font-medium text-ink-900'},passage.title),el('p',{class:'text-xs text-ink-300'},attempt.status==='completed'?`${dict.reading.score}: ${attempt.score}/${attempt.totalQuestions}`:dict.reading.resumeAttempt)),IconReading({}))))));
  }catch(e){
   if(signal.aborted)return;
   host.replaceChildren(RegionFailureNotice({region:'reading-history',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}
