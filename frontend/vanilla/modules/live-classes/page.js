import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {parseLiveClasses,localDate,safeExternalUrl} from './contract.js';
import {joinControl} from './join.js';
import {resourceBlocks} from './resources.js';
/** Original: main src/app/app/(shell)/live-classes/page.tsx. No GET live-class API exists yet.
 * Proposed /api/frontend/view?route=%2Fapp%2Flive-classes DTO; fail closed on missing endpoint.
 */
export async function mount(ctx){const {root,signal,dict,locale}=ctx,t=dict.liveClasses;
 const host=el('section',{'data-route-usable':'live-classes',class:'mx-auto flex max-w-3xl flex-col gap-6'},el('h1',{class:'font-display text-2xl text-ink-900'},t.title));const body=el('div',{'data-live-classes-host':''});host.append(body);root.append(host);
 let generation=0;
 function renderCards(data){const content=el('div',{class:'flex flex-col gap-6','data-live-classes-content':'','data-async-content':'live-classes'});
  if(!data.courseAvailable){content.append(el('p',{class:'text-sm text-ink-500'},dict.formCopy.noCourse));return content;}
  if(data.metadataUnavailable)content.append(RegionFailureNotice({region:'live-class-metadata',message:dict.errors.unknown,retryLabel:dict.errorPage.retry,refresh:reload}));
  const section=(heading,rows,past=false)=>el('section',{},el('h2',{class:'mb-2 text-sm font-semibold uppercase tracking-wide text-ink-300'},heading),rows.length?el('div',{class:'flex flex-col gap-2'},rows.map(c=>{
   const card=el('div',{class:'card flex flex-col gap-2 p-5','data-live-class':c.id});
   const title=el('div',{class:'min-w-0'},el('p',{class:'text-sm font-medium text-ink-900'},c.title));
   if(!past&&c.topic)title.append(el('p',{class:'text-xs text-ink-500'},c.topic));
   const meta=past?`${localDate(c.scheduledAt,locale,{dayOnly:true})} · ${t.status[c.status]}`:`${localDate(c.scheduledAt,locale)} · ${c.durationMinutes} ${dict.common.minutes} · ${data.teachers.get(c.teacherUserId)??t.teacher}${c.status==='live'?' · '+t.liveNow:''}`;
   title.append(el('p',{class:'text-xs text-ink-300'},meta));
   if(past&&data.attendance.has(c.id))title.append(el('span',{class:'text-xs text-band-good'},` · ${t.youAttended}`));
   let action=null;
   if(past){const url=safeExternalUrl(c.recordingUrl);if(url)action=el('a',{href:url,target:'_blank',rel:'noopener noreferrer',class:'btn-secondary'},t.recording);}
   else action=joinControl(ctx,c,data.attendance.get(c.id));
   card.append(el('div',{class:'flex items-center justify-between gap-3'},title,action),resourceBlocks(ctx,data.materials.get(c.id)??[]));return card;
  })):el('p',{class:'text-sm text-ink-500'},past?'':t.noClasses));
  content.append(section(t.upcoming,data.upcoming));if(data.past.length)content.append(section(t.past,data.past,true));return content;
 }
 async function reload(){const id=++generation;body.replaceChildren(el('div',{role:'status','aria-busy':'true','data-async-loading':'live-classes',class:'flex flex-col gap-3'},[0,1,2].map(()=>el('div',{class:'h-20 animate-pulse rounded-xl bg-ink-50'}))));
  try{const data=parseLiveClasses(await viewData('/app/live-classes',signal));if(signal.aborted||id!==generation)return;body.replaceChildren(renderCards(data));}
  catch(e){if(signal.aborted||id!==generation)return;if(e?.status===401){void ctx.navigate('/login',{replace:true});return;}body.replaceChildren(el('div',{'data-integration-required':'live-classes'},RegionFailureNotice({region:'live-classes',message:dict.auth.errorServer,retryLabel:dict.errorPage.retry,refresh:reload})));}}
 signal.addEventListener('abort',()=>{generation++;body.replaceChildren();},{once:true});void reload();
}
