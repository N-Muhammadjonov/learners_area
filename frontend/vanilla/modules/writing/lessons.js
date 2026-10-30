import {el,button,card,navBack,link,viewRegion,post,state,safeArray,txt,label,uuid,missing,errMessage} from './shared.js';
const originalTab='lessons';
export function mountTab(ctx,root){const host=el('div',{'data-writing-lessons':'',class:'writing-groups'});root.append(host);viewRegion(ctx,host,'writing-lessons',data=>{
 const rows=safeArray(data.lessons??data.rows);
 if(!rows.length){host.replaceChildren(card(el('h2',{class:'font-semibold'},label(ctx,'writingWorkspace.lessons.emptyTitle')),el('p',{class:'text-sm text-ink-500'},label(ctx,'writingWorkspace.lessons.emptyBody'))));return;}
 host.replaceChildren(...rows.map(l=>{const t=ctx.dict.writingWorkspace.lessons;return el('article',{class:'card p-5 flex flex-col gap-2'},
  link(`/app/writing/lessons/${encodeURIComponent(l.id)}`,l.title,'font-display text-lg text-ink-900'),
  el('p',{class:'text-xs text-signal-600'},t.category?.[l.category]??l.category),
  l.summary?el('p',{class:'text-sm text-ink-500'},l.summary):null,
  l.durationMinutes?el('span',{class:'text-xs'},String(l.durationMinutes)+' min'):null,
  l.completedAt?el('span',{class:'text-band-good'},t.completed):null); }));});}
export function mount(ctx){const id=ctx.url.pathname.split('/')[4],host=el('article',{'data-writing-native':'','data-route-usable':'writing-lesson',class:'mx-auto max-w-3xl flex flex-col gap-5'});ctx.root.append(host);if(!uuid(id)){host.append(missing(ctx));return;}
 viewRegion(ctx,host,'writing-lesson',async(data,load)=>{
  const row=data.detail??data,lesson=row.lesson;if(!lesson||lesson.id!==id){host.replaceChildren(missing(ctx));return;}const t=ctx.dict.writingWorkspace.lessons;const heading=el('header',{},el('p',{class:'text-xs font-semibold uppercase tracking-wide text-signal-600'},t.category?.[lesson.category]??lesson.category),el('h1',{class:'font-display text-2xl text-ink-900'},lesson.title),lesson.summary?el('p',{class:'text-base text-ink-500'},lesson.summary):null);
  const paragraphs=String(lesson.body??'').split(/\n{2,}/).filter(Boolean);
  let done=Boolean(row.completedAt);
  const complete=button(done?t.completed:t.markDone,async()=>{if(done)return;complete.disabled=true;try{await post(ctx,`/api/writing/lessons/${id}`,{},'POST');done=true;complete.textContent=t.completed;}catch(e){complete.disabled=false;error.textContent=errMessage(ctx,e);}},{signal:ctx.signal});complete.disabled=done;
  const error=el('p',{role:'alert',class:'writing-error'});
  host.replaceChildren(navBack(ctx,'/app/writing?tab=lessons'),heading,el('div',{class:'academic-text flex flex-col gap-4 text-base text-ink-900','data-writing-lesson-body':''},paragraphs.map(p=>el('p',{class:'whitespace-pre-line'},p))),complete,error);
 });}
