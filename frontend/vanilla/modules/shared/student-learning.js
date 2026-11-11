import {h} from '../../js/native.js';
import {api} from '../../js/api-client.js';
const modules=['reading','listening','writing','speaking','mocks'];
const note=uz=>uz?'Har bir materialning 30 kun ichidagi faqat birinchi baholangan natijasi o‘rtachaga qo‘shiladi.':'Only the first graded attempt per material within each 30-day period counts toward the average.';
const text=(value)=>typeof value==='string'?value:JSON.stringify(value,null,2);
export function learningExtras(ctx,{studentId=null,writing=false}={}){
 const uz=ctx.locale==='uz',host=h('section',{class:'space-y-4 min-w-0','data-learning-extras':''});let week='',generation=0;
 const study=h('div',{class:'card p-4 space-y-3','data-weekly-study-time':''}),scores=h('div',{class:'card p-4 space-y-3','data-fair-scores':''});host.append(study,scores);
 const request=async(kind,params={})=>{
  const q=new URLSearchParams(params);
  if(studentId){q.set('student',studentId);return (await api.request('/api/frontend/staff/'+kind+'?'+q,{signal:ctx.signal})).data;}
  const route='/app/progress'+(q.size?'?'+q:'');return (await api.request('/api/frontend/view?'+new URLSearchParams({route,region:'learningExtras'}),{signal:ctx.signal})).data;
 };
 function retry(node,load){node.replaceChildren(h('p',{role:'alert'},ctx.dict.errors.unknown),h('button',{type:'button',class:'btn-secondary',onClick:load},ctx.dict.errorPage.retry));}
 const duration=s=>`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`;
 async function load(){const seq=++generation;study.setAttribute('aria-busy','true');
  try{const data=await request('student-learning-extras',week?{week}:{});if(ctx.signal.aborted||seq!==generation)return;
   const w=data.studyTime;if(!w||!Array.isArray(w.days)||w.days.length!==7||w.days.some(d=>!Number.isFinite(d.seconds)||d.seconds<0))throw Error('invalid_study_time');week=w.week;
   const shift=n=>{const d=new Date(week+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n*7);week=d.toISOString().slice(0,10);void load();};
   study.replaceChildren(h('h2',{class:'font-display text-lg'},uz?'Haftalik dars vaqti':'Weekly Study Time'),h('p',{class:'text-xs text-ink-500'},`${w.week} · Sunday–Saturday · Asia/Tashkent`),
    h('div',{class:'flex flex-wrap gap-2'},h('button',{type:'button',class:'btn-secondary',onClick:()=>shift(-1)},uz?'Oldingi hafta':'Previous week'),h('button',{type:'button',class:'btn-secondary',disabled:w.week>=w.currentWeek,onClick:()=>shift(1)},uz?'Keyingi hafta':'Next week')),
    h('dl',{class:'grid grid-cols-2 gap-2 sm:grid-cols-4'},w.days.map((d,i)=>h('div',{},h('dt',{class:'text-sm'},(uz?['Yakshanba','Dushanba','Seshanba','Chorshanba','Payshanba','Juma','Shanba']:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[i]),h('dd',{'data-study-day':d.date},duration(d.seconds))))),
    h('p',{class:'font-semibold','data-study-total':w.totalSeconds},`${uz?'Jami':'Total'}: ${duration(w.totalSeconds)}`),h('p',{class:'text-xs text-ink-500'},uz?'Faqat qayd etilgan faol o‘quv vaqti; oldingi sayt tashriflari qo‘shilmaydi.':'Recorded active learning only; past website visits are not counted.'));
   scores.hidden=data.averages===null;
   if(data.averages){scores.replaceChildren(h('h2',{class:'font-display text-lg'},uz?'Taxminiy o‘rtacha natijalar':'Estimated averages'),h('p',{class:'text-xs text-ink-500'},note(uz)),h('dl',{class:'grid grid-cols-2 gap-3 sm:grid-cols-5'},modules.map(m=>{const v=data.averages[m];if(!v||v.band!==null&&!Number.isFinite(v.band))throw Error('invalid_score');return h('div',{},h('dt',{},m==='mocks'?'Mock Tests':m[0].toUpperCase()+m.slice(1)),h('dd',{'data-fair-score':m},v.band==null?'—':v.band.toFixed(1)),h('p',{class:'text-xs text-ink-500'},`${v.eligible} / ${v.scored} ${uz?'hisobga olingan':'counted'}`),v.accuracy!=null?h('p',{class:'text-xs'},`${v.accuracy}%`):null);})),h('p',{class:'text-xs text-ink-500'},uz?'Band faqat saqlangan haqiqiy bahodan olinadi. Passage foizi to‘liq IELTS testi bandiga aylantirilmaydi.':'Bands use recorded grades only. Passage accuracy is not converted into a full IELTS test band.'));}
  }catch{if(!ctx.signal.aborted&&seq===generation)retry(study,load);}finally{if(seq===generation)study.removeAttribute('aria-busy');}
 }
 void load();
 if(writing&&studentId)host.append(writingLibrary(ctx,studentId));
 return host;
}

export function writingLibrary(ctx,studentId){
 const uz=ctx.locale==='uz',host=h('section',{class:'card p-4 space-y-3','data-student-writing-library':''});let type='',page=1,seq=0;
 async function load(work=null,kind=type){const version=++seq;host.setAttribute('aria-busy','true');
  const query=new URLSearchParams({student:studentId,page:String(page),...(kind?{type:kind}:{}),...(work?{work}: {})});
  try{const {data}=await api.request('/api/frontend/staff/student-writing?'+query,{signal:ctx.signal});if(ctx.signal.aborted||version!==seq)return;
   if(!Array.isArray(data.items))throw Error('invalid_writing');
   const select=h('select',{class:'input','aria-label':uz?'Writing turi':'Writing type',onChange:e=>{type=e.target.value;page=1;void load();}},h('option',{value:''},uz?'Barcha Writing ishlari':'All Writing work'),['submission','grade','translation','stealing','activation','study','lesson-note','lesson','typing'].map(k=>h('option',{value:k},({submission:'Real Exam / Writing',grade:'Grade My Work',translation:'Translation',stealing:'Language Stealing',activation:'Activation Lab',study:'Writing notes','lesson-note':'Writing lesson notes',lesson:'Writing Lessons',typing:'Typing'})[k])));select.value=type;
   host.replaceChildren(h('h2',{class:'font-display text-lg'},'Writing'),h('p',{class:'text-xs text-ink-500'},uz?'Serverda saqlangan ishlar · faqat ko‘rish':'Server-saved work · read only'),select);
   if(work)host.append(h('button',{type:'button',class:'btn-secondary',onClick:()=>load()},ctx.dict.common.back));
   if(!data.items.length)host.append(h('p',{},uz?'Saqlangan ish topilmadi.':'No saved work found.'));
   for(const item of data.items){const card=h('article',{class:'border border-ink-100 rounded-sm p-3 space-y-2','data-writing-work':item.id},h('h3',{class:'font-semibold break-words'},item.title),h('p',{class:'text-xs'},`${item.kind} · ${item.status}`),h('p',{class:'text-xs text-ink-500'},`${item.createdAt??'—'} · ${item.updatedAt??'—'}${item.completedAt?' · '+item.completedAt:''}`),item.prompt?h('p',{class:'whitespace-pre-wrap'},item.prompt):null,h('p',{class:'whitespace-pre-wrap break-words'},item.body||'—'));
    if(work){for(const [label,value] of [[uz?'Saqlangan tafsilotlar / tarix':'Saved details / revisions',item.detail],[uz?'Baholash':'Evaluation',item.evaluations],[uz?'Fikr-mulohaza':'Feedback',item.feedback],[uz?'Exam bahosi':'Exam grading',item.examGrading]])if(value&&(Array.isArray(value)?value.length:Object.keys(value).length))card.append(h('details',{},h('summary',{},label),h('pre',{class:'whitespace-pre-wrap break-words text-xs max-w-full'},text(value))));}
    else card.append(h('button',{type:'button',class:'btn-secondary',onClick:()=>load(item.id,item.kind)},uz?'To‘liq ko‘rish':'Read full work'));
    host.append(card);
   }
   if(!work)host.append(h('div',{class:'flex flex-wrap items-center gap-2'},h('button',{type:'button',class:'btn-secondary',disabled:data.page<=1,onClick:()=>{page--;void load();}},uz?'Oldingi':'Previous'),h('span',{},`${data.page} / ${data.pages} · ${data.total}`),h('button',{type:'button',class:'btn-secondary',disabled:data.page>=data.pages,onClick:()=>{page++;void load();}},uz?'Keyingi':'Next')));
  }catch{if(!ctx.signal.aborted&&version===seq)host.replaceChildren(h('p',{role:'alert'},ctx.dict.errors.unknown),h('button',{type:'button',class:'btn-secondary',onClick:()=>load(work,kind)},ctx.dict.errorPage.retry));}finally{if(version===seq)host.removeAttribute('aria-busy');}
 }
 void load();return host;
}
