import {el,mountStaff,heading,centreDateTime,listen} from './kit.js';
import {overview} from '../../js/adapters/staff-final30/owner.js';
import {StatCard} from '../../js/generated/ui.js';
import {h} from '../../js/native.js';
import {STATS_EN,STATS_UZ} from './statistics-strings.js';
import {ACADEMIC_EN,ACADEMIC_UZ} from './monitoring-strings.js';
const fmtNumber=n=>new Intl.NumberFormat().format(n);
function academicPanel(ctx,a){
 const dict=ctx.dict,t=ctx.locale==='uz'?ACADEMIC_UZ:ACADEMIC_EN,stats=ctx.locale==='uz'?STATS_UZ:STATS_EN;
 const percent=v=>v==null?'—':`${v.toFixed(1)}%`;
 const homework=a.homework, max=Math.max(1,...a.daily.map(x=>x.count));
 const form=el('form',{class:'card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3','data-owner-academic-filters':''},
  el('label',{class:'flex flex-col gap-1 text-xs font-medium text-ink-700'},t.dateFrom,el('input',{class:'input',type:'date',name:'from',value:a.filters.from??''})),
  el('label',{class:'flex flex-col gap-1 text-xs font-medium text-ink-700'},t.dateTo,el('input',{class:'input',type:'date',name:'to',value:a.filters.to??''})),
  el('label',{class:'flex flex-col gap-1 text-xs font-medium text-ink-700'},t.studentSearch,el('input',{class:'input',type:'search',name:'student',maxLength:100,value:a.filters.student,placeholder:t.studentSearch,autocomplete:'off'})),
  el('label',{class:'flex flex-col gap-1 text-xs font-medium text-ink-700'},t.teacherSearch,el('input',{class:'input',type:'search',name:'teacher',maxLength:100,value:a.filters.teacher,placeholder:t.teacherSearch,autocomplete:'off'})),
  el('label',{class:'flex flex-col gap-1 text-xs font-medium text-ink-700'},t.moduleFilter,(()=>{const select=el('select',{class:'input',name:'module'},[el('option',{value:''},t.allAcademicModules),...a.moduleSummary.map(r=>el('option',{value:r.module},stats.modules[r.module]))]);select.value=a.filters.module??'';return select;})()));
 const formError=el('p',{role:'alert',class:'text-sm text-band-bad sm:col-span-2 lg:col-span-3','data-owner-filter-error':''});
 const formActions=el('div',{class:'flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3'},
  el('button',{type:'submit',class:'btn-primary'},t.applyAcademicFilters),el('a',{href:'/app/owner',class:'btn-secondary'},t.clearAcademicFilters),
  el('p',{class:'text-xs text-ink-500'},t.filterHelp));form.append(formError,formActions);
 listen(form,'submit',event=>{event.preventDefault();const value=key=>String(form.elements.namedItem(key)?.value??''),from=value('from'),to=value('to');formError.textContent='';
  if(from&&to){const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');if(!Number.isFinite(start)||!Number.isFinite(end)||end<start){formError.textContent=t.rangeInvalid;return;}if((end-start)/86400000>89){formError.textContent=t.rangeTooLong;return;}}
  const params=new URLSearchParams();for(const key of ['from','to','student','teacher','module']){const field=value(key).trim();if(field)params.set(key,field);}
  void ctx.navigate('/app/owner'+(params.size?'?'+params.toString():''));
 },ctx.signal);
 const cards=[
  [t.centreActive,fmtNumber(a.activeStudents)],
  [t.onlineStudents,fmtNumber(a.onlineStudents),t.presenceNote],
  [t.academicallyActiveStudents,fmtNumber(a.activity.students),`${t.recordsInRange}: ${fmtNumber(a.activity.records)}`],
  [t.completionRate,a.completionPercent==null?t.noAssignments:percent(a.completionPercent),`${t.completed}: ${fmtNumber(homework.completed)} / ${fmtNumber(homework.assigned)}`],
  [t.pendingReviews,fmtNumber(a.pendingReviews)],
  [t.overdueTasks,fmtNumber(homework.overdue)],
  [t.writingSubmissions,fmtNumber(a.writingSubmissions)],
 ];
 const moduleRows=a.moduleSummary.map(r=>el('tr',{class:'border-b border-ink-100 last:border-0'},
  el('th',{scope:'row',class:'py-2 pr-3 text-left font-medium'},stats.modules[r.module]),
  el('td',{class:'py-2 pr-3'},`${fmtNumber(r.completed)} / ${fmtNumber(r.started)}`),
  el('td',{class:'py-2 pr-3'},r.started?percent(100*r.completed/r.started):'—'),
  el('td',{class:'py-2 pr-3'},r.accuracy==null?'—':percent(r.accuracy)),
  el('td',{class:'py-2'},r.band==null?'—':r.band.toFixed(2))));
 const moduleTable=el('div',{class:'overflow-x-auto'},el('table',{class:'w-full text-left text-sm'},
  el('thead',{},el('tr',{class:'border-b border-ink-100 text-xs text-ink-500'},[dict.nav.module??t.module,stats.completed,stats.rate,stats.accuracy,stats.band].map(x=>el('th',{scope:'col',class:'py-2 pr-3'},x)))),
  el('tbody',{},moduleRows)));
 const chart=el('div',{class:'flex h-40 items-end gap-2','role':'img','aria-label':t.dailyActivity,'data-owner-academic-weekly':''},a.daily.map(x=>el('div',{class:'flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 text-xs'},
  el('span',{class:'text-ink-500'},fmtNumber(x.count)),el('div',{class:'w-full rounded-t bg-sky-300',style:{height:`${Math.max(2,x.count/max*72)}%`}}),el('span',{class:'text-ink-500'},x.day.slice(5)))));
 const attention=a.attention.length?el('ul',{class:'divide-y divide-ink-100','data-owner-attention':''},a.attention.map(r=>el('li',{class:'flex flex-wrap items-center justify-between gap-3 py-3'},
  el('div',{},el('a',{href:`/app/admin/people/${r.id}`,class:'font-medium text-ink-900 underline'},r.name),el('p',{class:'text-xs text-ink-500'},`${t.lastAcademic}: ${r.lastAcademicAt?centreDateTime(r.lastAcademicAt,ctx.locale):'—'}`)),
  el('div',{class:'flex gap-2 text-xs'},r.overdue?el('span',{class:'badge bg-band-bad/10 text-band-bad'},`${t.overdue}: ${r.overdue}`):null,r.pendingReviews?el('span',{class:'badge bg-gold/20 text-ink-700'},`${t.pendingReviews}: ${r.pendingReviews}`):null)))):el('p',{class:'text-sm text-ink-500'},t.noAttention);
 return el('section',{class:'space-y-4','data-owner-academic-overview':''},el('div',{},el('h2',{class:'font-display text-2xl text-ink-900'},ctx.locale==='uz'?'Markaz bo‘yicha o‘quv ko‘rinishi':'Centre-wide academic overview'),el('p',{class:'text-xs text-ink-500'},t.recordedOnly)),
  form,el('div',{class:'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'},cards.map(([label,value,hint])=>h(StatCard,{label,value,hint}))),
  el('div',{class:'grid gap-4 xl:grid-cols-2'},el('section',{class:'card space-y-3 p-5'},el('h3',{class:'font-display text-lg text-ink-900'},t.dailyActivity),chart),el('section',{class:'card space-y-3 p-5'},el('h3',{class:'font-display text-lg text-ink-900'},t.needsAttention),attention)),
  el('section',{class:'card space-y-3 p-5'},el('h3',{class:'font-display text-lg text-ink-900'},t.modulePerformance),moduleTable));
}
/** Source: owner/page.tsx (requireOwner). Role: owner only; presentation redirect mirrors source `/app`. */
export const mount=mountStaff({name:'management-owner',roles:['owner'],load:ctx=>overview(ctx.signal,Object.fromEntries(['from','to','student','teacher','module'].map(k=>[k,ctx.url.searchParams.get(k)??'']))),
 render(ctx,data){
  const {dict}=ctx,t=dict.owner;
  const byRole=r=>data.counts.filter(x=>x.role===r).reduce((s,x)=>s+x.count,0),active=data.counts.filter(x=>x.status==='active').reduce((s,x)=>s+x.count,0),total=data.counts.reduce((s,x)=>s+x.count,0);
  const notConfigured=data.integrations.filter(x=>x.state==='not_configured'||x.state==='unverified').length;
  const link=(href,title,body)=>el('a',{href,class:'card flex flex-col gap-1 p-5 hover:border-signal-600'},el('span',{class:'font-display text-lg text-ink-900'},title),el('span',{class:'text-xs text-ink-500'},body));
  const asset=k=>data.brand.assets.find(a=>a.key===k)?.path;
  const img=(src,cls,theme)=>el('img',{src,alt:data.brand.siteName,class:`${theme} ${cls}`,loading:'lazy',decoding:'async'});
  const logo=(kind,cls)=>{const day=kind==='master'?asset('logoMasterDark'):kind==='horizontal'?asset('logoHorizontalDark'):asset('logoMarkLight'),night=asset('logoMarkDark');
   if(!day||!night)return null;return el('span',{class:`inline-flex items-center ${cls}`,'data-brand-logo':kind},img(day,'h-full w-auto object-contain','brand-asset-light'),img(night,'h-full w-auto object-contain','brand-asset-dark'));};
  return el('div',{class:'mx-auto flex max-w-4xl flex-col gap-6'},heading(t.title,t.subtitle),
   el('div',{class:'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'},h(StatCard,{label:dict.people.title,value:String(total),hint:`${active} ${dict.admission.statusActive.toLowerCase()}`}),h(StatCard,{label:dict.admission.title,value:String(data.pendingCount)}),h(StatCard,{label:dict.nav.teacher,value:String(byRole('teacher'))}),h(StatCard,{label:dict.integration.title,value:String(notConfigured),hint:dict.integration.notConfigured})),
   academicPanel(ctx,data.academic),
   el('div',{class:'grid gap-3 sm:grid-cols-2'},link('/app/admin/admissions',t.admissions,dict.admission.explainer),link('/app/admin/people',t.people,dict.people.subtitle),link('/app/teacher/students',ctx.locale==='uz'?ACADEMIC_UZ.title:ACADEMIC_EN.title,ctx.locale==='uz'?ACADEMIC_UZ.ownerScope:ACADEMIC_EN.ownerScope),link('/app/teacher/homework',ctx.locale==='uz'?ACADEMIC_UZ.homework:ACADEMIC_EN.homework,ctx.locale==='uz'?ACADEMIC_UZ.homeworkBody:ACADEMIC_EN.homeworkBody),link('/app/owner/dictionary',dict.globalDictionary.owner,dict.globalDictionary.search),link('/app/owner/integrations',t.integrations,dict.integration.subtitle),link('/app/owner/retention',t.retention,dict.retention.subtitle),link('/app/owner/audit',t.audit,dict.people.subtitle),link('/app/owner/transfer',t.transfer,t.transferWarning)),
   el('div',{class:'card p-5','data-brand-preview':''},el('h2',{class:'font-display text-lg text-ink-900'},t.brandTitle),el('p',{class:'mt-1 text-xs text-ink-500'},t.brandHint),
    el('div',{class:'mt-4 flex flex-wrap items-center gap-6'},logo('master','h-32 max-w-full'),el('div',{class:'flex flex-col gap-2'},logo('horizontal','h-10 max-w-[min(22rem,70vw)]'),logo('mark','h-10'))),
    el('dl',{class:'mt-5 grid gap-1 text-xs text-ink-500 sm:grid-cols-2','data-brand-asset-list':''},data.brand.assets.map(a=>el('div',{class:'flex min-w-0 items-center justify-between gap-3 border-b border-ink-100 py-1'},el('dt',{class:'shrink-0 font-medium text-ink-700'},t.brandAssets[a.key]),el('dd',{class:'truncate font-mono','data-brand-asset':a.key},a.path)))),
    el('p',{class:'mt-3 text-xs text-ink-300'},`${data.brand.siteName} · ${data.brand.favicon}`)));
 }});
