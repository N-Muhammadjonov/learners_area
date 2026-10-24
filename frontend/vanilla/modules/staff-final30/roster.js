import {el,listen,mountStaff,BackLink,heading,put} from './kit.js';
import {roster} from '../../js/adapters/staff-final30/people.js';
import {UUID} from '../../js/adapters/staff-final30/core.js';
/**
 * Source: admin/roster/page.tsx. The original assignment forms are native `POST /api/admin/roster`
 * (multipart/urlencoded, 303 redirect back with ?status=saved|unchanged|failed). They are kept as real
 * native forms (data-native => full navigation) so no new JSON endpoint is invented. Role: admin, owner.
 */
export const mount=mountStaff({name:'management-roster',roles:['admin','owner'],
 load:ctx=>{const sp=ctx.url.searchParams,teacher=sp.get('teacher')??'';return roster({teacher:UUID.test(teacher)?teacher:'',q:(sp.get('q')??'').trim().slice(0,60)},ctx.signal);},
 render(ctx,data,view){
  const {dict,url,navigate,signal}=ctx,t=dict.reporter.roster,status=url.searchParams.get('status'),sel=data.selected;
  const statusText=status==='saved'?t.saved:status==='unchanged'?t.unchanged:status==='failed'?t.failed:null;
  const hidden=(n,v)=>el('input',{type:'hidden',name:n,value:v});
  const nativePost=(children,attrs={})=>el('form',{method:'post',action:'/api/admin/roster','data-native':'',...attrs},children);
  const pick=el('select',{name:'teacher',class:'input'},el('option',{value:''},t.chooseTeacher),data.teachers.map(x=>el('option',{value:x.id},x.name)));pick.value=sel?.id??'';
  const chooser=el('form',{class:'flex flex-wrap items-end gap-3','data-roster-chooser':''},el('label',{class:'flex flex-col gap-1 text-sm'},el('span',{class:'font-semibold text-ink-700'},t.teacher),pick),el('button',{type:'submit',class:'btn-secondary min-h-11'},t.chooseTeacher));
  listen(chooser,'submit',e=>{e.preventDefault();void navigate(pick.value&&UUID.test(pick.value)?`/app/admin/roster?teacher=${pick.value}`:'/app/admin/roster');},signal);
  const out=el('div',{class:'flex flex-col gap-4','data-teacher-roster':''},BackLink({fallbackHref:'/app/management',label:dict.nav.management}),heading(t.title,t.body),
   statusText?el('p',{role:'status',class:'rounded-md border border-ink-200 p-3 text-sm','data-roster-status':status},statusText):null,
   el('div',{class:'card p-4'},data.teachers.length===0?el('p',{class:'text-sm text-ink-500'},t.noTeachers):chooser));
  if(sel){
   const q=el('input',{type:'search',name:'q',maxlength:'60',class:'input'});q.value=data.query;
   const search=el('form',{class:'flex flex-wrap items-end gap-3','data-roster-search':''},el('label',{class:'flex flex-col gap-1 text-sm'},el('span',{class:'font-semibold text-ink-700'},dict.reporter.studentSearch),q),el('button',{type:'submit',class:'btn-secondary min-h-11'},dict.reporter.studentSearchButton));
   listen(search,'submit',e=>{e.preventDefault();const v=q.value.trim().slice(0,60);void navigate(`/app/admin/roster?teacher=${sel.id}${v?'&q='+encodeURIComponent(v):''}`);},signal);
   const card=el('div',{class:'card flex flex-col gap-3 p-4'},el('h2',{class:'text-lg font-semibold text-ink-900'},`${t.assigned}: ${sel.name}`),
    data.roster.length===0?el('p',{class:'text-sm text-ink-500'},t.none):el('ul',{class:'flex flex-col gap-2','data-roster-list':''},data.roster.map(s=>el('li',{class:'flex items-center justify-between gap-3 text-sm'},el('span',{},s.name),nativePost([hidden('teacherId',sel.id),hidden('studentId',s.id),hidden('action','unassign'),el('button',{type:'submit',class:'btn-secondary min-h-11'},t.remove)])))),
    search,
    data.candidates.length>=data.listCap?el('p',{class:'text-xs text-ink-500',role:'status'},fill1(dict.reporter.listCapped,data.listCap)):null,
    data.roster.length>=data.rosterCap?null:data.candidates.length>0?nativePost([hidden('teacherId',sel.id),hidden('action','assign'),el('label',{class:'flex flex-col gap-1 text-sm'},el('span',{class:'font-semibold text-ink-700'},t.add),el('select',{name:'studentId',class:'input',required:''},el('option',{value:'',disabled:'',selected:''},'—'),data.candidates.map(s=>el('option',{value:s.id},s.name)))),el('button',{type:'submit',class:'btn-primary min-h-11'},t.addButton)],{class:'flex flex-wrap items-end gap-3'}):null);
   put(out,card);
  }
  return out;
 }});
const fill1=(s,n)=>s.replace('{n}',String(n));
