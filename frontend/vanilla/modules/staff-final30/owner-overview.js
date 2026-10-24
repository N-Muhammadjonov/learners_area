import {el,mountStaff,heading} from './kit.js';
import {overview} from '../../js/adapters/staff-final30/owner.js';
import {StatCard} from '../../js/generated/ui.js';
import {h} from '../../js/native.js';
/** Source: owner/page.tsx (requireOwner). Role: owner only; presentation redirect mirrors source `/app`. */
export const mount=mountStaff({name:'management-owner',roles:['owner'],load:ctx=>overview(ctx.signal),
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
   el('div',{class:'grid gap-3 sm:grid-cols-2'},link('/app/admin/admissions',t.admissions,dict.admission.explainer),link('/app/admin/people',t.people,dict.people.subtitle),link('/app/owner/dictionary',dict.globalDictionary.owner,dict.globalDictionary.search),link('/app/owner/integrations',t.integrations,dict.integration.subtitle),link('/app/owner/retention',t.retention,dict.retention.subtitle),link('/app/owner/audit',t.audit,dict.people.subtitle),link('/app/owner/transfer',t.transfer,t.transferWarning)),
   el('div',{class:'card p-5','data-brand-preview':''},el('h2',{class:'font-display text-lg text-ink-900'},t.brandTitle),el('p',{class:'mt-1 text-xs text-ink-500'},t.brandHint),
    el('div',{class:'mt-4 flex flex-wrap items-center gap-6'},logo('master','h-32 max-w-full'),el('div',{class:'flex flex-col gap-2'},logo('horizontal','h-10 max-w-[min(22rem,70vw)]'),logo('mark','h-10'))),
    el('dl',{class:'mt-5 grid gap-1 text-xs text-ink-500 sm:grid-cols-2','data-brand-asset-list':''},data.brand.assets.map(a=>el('div',{class:'flex min-w-0 items-center justify-between gap-3 border-b border-ink-100 py-1'},el('dt',{class:'shrink-0 font-medium text-ink-700'},t.brandAssets[a.key]),el('dd',{class:'truncate font-mono','data-brand-asset':a.key},a.path)))),
    el('p',{class:'mt-3 text-xs text-ink-300'},`${data.brand.siteName} · ${data.brand.favicon}`)));
 }});
