import {el,mountStaff,BackLink,dateOnly,put} from './kit.js';
import {studentResults} from '../../js/adapters/staff-final30/people.js';
import {UUID} from '../../js/adapters/staff-final30/core.js';
import {studentLearningPanel} from './learning-results.js';
import {bandAxis} from '../shared/band-axis.js';
export {summarize} from './mock-summary.js';
import {summarize} from './mock-summary.js';
/** Source: admin/people/[id]/page.tsx + components/admin/StudentResults.tsx. Roles: admin, owner. */
const SKILLS=['reading','listening','speaking','writing'];
const fmt=v=>v===null||v===undefined?'—':v.toFixed(1);
/** Pure computation copied from the source component (no re-grading: bands are server values). */

const NS='http://www.w3.org/2000/svg';
const svg=(tag,attrs={},...kids)=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));for(const k of kids.flat())if(k!=null)put(n,k instanceof Node?k:document.createTextNode(String(k)));return n;};
function trend(chart,t){
 const x=i=>chart.length===1?480:40+i*880/(chart.length-1),axis=bandAxis(chart.map(r=>r.value),{top:35,bottom:285}),y=axis.y;
 const root=svg('svg',{viewBox:'0 0 960 345',role:'img','aria-label':t.trend,class:'w-full','data-full-mock-trend':''});
 for(const v of axis.ticks){put(root,svg('line',{x1:40,x2:920,y1:y(v),y2:y(v),stroke:'currentColor',opacity:'0.12'}),svg('text',{x:5,y:y(v)+5,fill:'currentColor','font-size':14,'data-band-tick':v.toFixed(1)},v.toFixed(1)));}
 put(root,svg('polyline',{points:chart.map((r,i)=>`${x(i)},${y(r.value)}`).join(' '),fill:'none',stroke:'rgb(var(--accent))','stroke-width':3}));
 chart.forEach((r,i)=>{if(i===0||i===chart.length-1||i%Math.ceil(chart.length/6)===0)put(root,svg('text',{x:x(i),y:322,'text-anchor':'middle',fill:'currentColor','font-size':12},r.date.toISOString().slice(5,10)));
  put(root,svg('circle',{cx:x(i),cy:y(r.value),r:6,fill:'rgb(var(--accent))'},svg('title',{},`${dateOnly(r.date)} · ${r.skill??''} · ${r.title??''}: ${fmt(r.value)}`)),svg('text',{x:x(i),y:y(r.value)-14,'text-anchor':'middle',fill:'currentColor','font-size':16},fmt(r.value)));});
 return root;
}
export function renderResults(dict,data){
 const t=dict.studentResults,s=summarize(data.attempts,data.testIds);
 const sec=el('section',{class:'space-y-5','data-student-results':'','data-completed-mocks':String(s.complete),'data-total-mocks':String(s.total),'data-latest-band':s.latest===null?'none':s.latest.toFixed(1)},el('h2',{class:'font-display text-2xl'},t.title));
 if(data.unavailable){put(sec,el('p',{role:'alert'},dict.errors.unknown));return sec;}
 const imp=s.improvement===null?'—':`${s.improvement>0?'+':''}${fmt(s.improvement)}`;
 put(sec,el('dl',{class:'grid gap-3 sm:grid-cols-2 xl:grid-cols-5'},[[t.taken,String(s.finished.length)],[t.latest,fmt(s.latest)],[t.best,fmt(s.best)],[t.average,fmt(s.average)],[t.improvement,imp]].map(([l,v])=>el('div',{class:'card p-4'},el('dt',{class:'text-xs uppercase tracking-wide text-ink-500'},l),el('dd',{class:'mt-2 font-display text-2xl text-signal-600'},v)))));
 if(s.total>0)put(sec,el('div',{class:'space-y-2'},el('p',{},`${t.completed}: ${s.complete} / ${s.total}`),el('progress',{class:'h-3 w-full accent-signal-600',max:s.total,value:s.complete})));
 if(s.latest!==null)put(sec,el('div',{class:'space-y-2'},el('p',{},`${t.latest}: ${fmt(s.latest)} / 9.0`),el('progress',{class:'h-3 w-full accent-signal-600',max:9,value:s.latest})));
 if(s.chart.length)put(sec,el('div',{class:'card p-4'},trend(s.chart,t),el('p',{class:'text-xs text-ink-500'},t.bandNote)));
 put(sec,el('div',{class:'grid gap-4 md:grid-cols-2'},SKILLS.map(k=>{const rows=s.skillFinished.filter(a=>a.skill===k).reverse().slice(0,30);
  return el('article',{class:'card space-y-3 p-5','data-skill':k},el('h3',{class:'font-display text-xl'},dict.nav[k]),el('ul',{class:'space-y-2'},rows.map(a=>el('li',{class:'flex flex-wrap justify-between gap-2 border-b border-ink-100 py-2'},el('span',{},`${a.title??dict.nav.mockTests} · ${dateOnly(a.finishedAt)}`),el('span',{},a.estimatedBand===null?(a.rawScore??'—'):fmt(a.estimatedBand))))),
   rows.length===0?el('p',{class:'text-sm text-ink-500'},t.noResults):null,el('p',{class:'text-sm text-ink-500'},`${t.practice}: ${data.practice[k]??'—'}`));})));
 return sec;
}
export const mount=mountStaff({name:'management-student-results',roles:['admin','owner'],notFoundBack:null,
 load:ctx=>{const id=ctx.url.pathname.split('/').filter(Boolean).at(-1);if(!UUID.test(id))return Promise.reject(Object.assign(new Error('not_found'),{status:404}));return studentResults(id,ctx.signal);},
 render(ctx,data){const {dict}=ctx;return el('div',{class:'mx-auto max-w-6xl space-y-6'},BackLink({fallbackHref:'/app/admin/people',label:dict.nav.people}),el('div',{},el('h1',{class:'font-display text-3xl'},data.student.name),el('p',{class:'text-ink-500'},data.student.email??'Telegram')),renderResults(dict,data),studentLearningPanel(ctx,data.student.id,`/app/admin/people/${data.student.id}`));}});
