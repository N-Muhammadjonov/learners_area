/** Native implementation of main's Management Statistics page and LearningSummary. */
import {el,mountStaff,centreDateTime,put,fill} from './kit.js';
import {centreStatistics,RESULT_MODULES} from '../../js/adapters/staff-final30/statistics.js';
import {STATS_EN,STATS_UZ} from './statistics-strings.js';
export const statText=ctx=>ctx.dict?.managementStats??(ctx.locale==='uz'?STATS_UZ:STATS_EN);
const num=x=>x==null?'—':x.toFixed(1);
const path=(module)=>module?`/app/admin/statistics?module=${module}`:'/app/admin/statistics';
export function moduleCards(t,summary,selected,baseHref){
 const cards=summary.map(r=>{
  const a=el('a',{href:`${baseHref}?module=${r.module}#result-history`,class:'card flex flex-col gap-2 p-4','data-result-module':r.module},
   el('h3',{class:'font-semibold'},t.modules[r.module]),
   el('p',{},`${t.completed}: ${r.completed} / ${r.started}`),
   el('p',{},`${t.learners}: ${r.learners} · ${t.rate}: ${r.started?Math.round(r.completed/r.started*100)+'%':'—'}`),
   el('p',{},`${t.accuracy}: ${r.accuracy==null?'—':num(r.accuracy)+'%'}`),
   el('p',{},`${t.band}: ${num(r.band)}`));
  if(selected===r.module)a.setAttribute('aria-current','page');return a;
 });
 return el('section',{class:'space-y-4','data-learning-summary':''},el('h2',{class:'font-display text-2xl'},t.results),el('p',{class:'text-sm'},t.scope),el('div',{class:'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'},cards));
}
export const mount=mountStaff({name:'management-statistics',roles:['owner'],
 load:ctx=>centreStatistics(RESULT_MODULES.includes(ctx.url.searchParams.get('module'))?ctx.url.searchParams.get('module'):null,ctx.signal),
 render(ctx,d){const t=statText(ctx),max=Math.max(1,...d.daily.map(r=>r.count));
  const filter=el('nav',{class:'flex flex-wrap gap-2'},el('a',{href:path(null),class:'chip'},t.all),RESULT_MODULES.map(m=>el('a',{href:path(m),class:d.selected===m?'chip chip-active':'chip'},t.modules[m])));
  const plot=d.daily.length?el('div',{class:'flex h-48 items-end gap-2',role:'img','aria-label':t.activity},d.daily.map(r=>el('div',{class:'flex h-full flex-1 flex-col justify-end text-center text-xs'},el('span',{},r.count),el('div',{class:'rounded-t bg-sky-300',style:{height:(r.count/max*75)+'%'}}),el('span',{},r.day.slice(5))))):el('p',{},t.empty);
  const th=s=>el('th',{scope:'col'},s);
  const table=el('table',{class:'w-full text-left text-sm'},el('thead',{},el('tr',{},th(ctx.dict.people.name),th(t.started),th(t.completed),th(t.accuracy),th(t.band))),el('tbody',{},d.students.map(r=>el('tr',{class:'border-b border-ink-100'},el('td',{class:'py-3'},el('a',{href:`/app/admin/people/${r.id}`,class:'underline'},r.name)),el('td',{},r.started),el('td',{},r.completed),el('td',{},r.accuracy==null?'—':`${num(r.accuracy)}%`),el('td',{},num(r.band))))));
  return el('div',{class:'w-full min-w-0 space-y-6','data-management-statistics':''},el('h1',{class:'font-display text-3xl'},t.title),moduleCards(t,d.summary,d.selected,'/app/admin/statistics'),filter,
   el('section',{class:'card p-5 space-y-4'},el('h2',{class:'text-xl font-semibold'},t.activity),plot),
   el('section',{class:'card p-5 space-y-3'},el('h2',{class:'text-xl font-semibold'},t.top),el('div',{class:'overflow-x-auto'},table),d.students.length?null:el('p',{},t.empty)));
 }});
