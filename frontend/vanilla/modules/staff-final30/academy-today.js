import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';
import {IconChevronRight} from '../../js/generated/icons.js';
import {paymentDate} from '../payments/format.js';
import {pageGuide} from '../shared/page-guide.js';
import {academyAiPanel} from '../shared/academy-ai.js';

/** Each operational queue links directly to the workspace that handles it. */
export function academyToday(ctx){
 const uz=ctx.locale==='uz',t=(a,b)=>uz?a:b,teacher=ctx.session.user.role==='teacher';
 const body=el('div',{class:'space-y-4'}),status=el('p',{role:'status'}),refresh=el('button',{type:'button',class:'btn-secondary'},t('Yangilash','Refresh'));
 const host=el('section',{class:'space-y-4','data-academy-today':''},el('h1',{class:'font-display text-3xl'},t('Bugun','Today')),
  el('p',{},teacher?t('Sizga biriktirilgan darslar va ota-onalar bilan ishlash.','Your assigned classes and parent communication.'):
    t('Dars, qabul va to‘lov bo‘yicha navbatdagi amallar.','Priorities for classes, admissions and payments.')),refresh,status,body);
 let classesOffset=0,followupsOffset=0,attendanceOffset=0;
 function queue(id,title,href,data,changePage){
  const {items=[],count,pagination}=data;
  const link=el('a',{href,class:'flex min-h-11 min-w-0 items-center justify-between gap-3 font-semibold','data-today-destination':''},
   el('span',{},title),el('span',{class:'flex shrink-0 items-center gap-2'},count>0?String(count):null,IconChevronRight({})));
  const previous=pagination?.offset>0?el('button',{type:'button',class:'btn-secondary'},t('Oldingi','Previous')):null;
  const next=pagination?.hasMore?el('button',{type:'button',class:'btn-secondary'},t('Keyingi','Next')):null;
  if(previous)previous.addEventListener('click',()=>changePage(Math.max(0,pagination.offset-pagination.limit)));
  if(next)next.addEventListener('click',()=>changePage(pagination.offset+pagination.limit));
  return el('section',{id,class:'card space-y-3 px-4 py-2'},link,
   items.length?el('ul',{class:'space-y-3 pb-2'},items.map(row=>el('li',{},el('a',{href:row.href,class:'underline font-semibold'},row.name),
    el('p',{class:'text-sm'},row.startsAt?paymentDate(row.startsAt,ctx.locale,'—')+' · '+row.branch:paymentDate(row.dueAt,ctx.locale,'—')),
    row.unmarked===undefined?null:el('p',{class:'text-sm'},t('Belgilanmagan: ','Unmarked: ')+row.unmarked+
     (row.canMark===false?t(' · Xodim tuzatishi kerak',' · Staff correction required'):''))))):null,
   previous||next?el('div',{class:'flex gap-2 pb-2'},previous,next):null);
 }
 async function load(focusIndex){
  if(refresh.disabled)return;refresh.disabled=true;status.textContent=ctx.dict.common.loading;
  try{
   const query=new URLSearchParams({classesOffset,followupsOffset,attendanceOffset});
   const data=await api.request('/api/staff/academy/today?'+query,{signal:ctx.signal,fresh:true});if(ctx.signal.aborted)return;
   const lists=[queue('today-classes',t('Bugungi darslar','Today’s classes'),'/app/management/groups',data.classes,
    offset=>{if(refresh.disabled)return;classesOffset=offset;void load(0);})];
   if(data.attendance)lists.push(queue('today-attendance',t('Tugallanmagan davomat · oxirgi 7 kun','Incomplete attendance · last 7 days'),
    '/app/management/groups?view=attendance',data.attendance,
    offset=>{if(refresh.disabled)return;attendanceOffset=offset;void load(1);}));
   if(data.followUps)lists.push(queue('today-followups',t('Bog‘lanish vaqti kelgan nomzodlar','Admissions follow-ups due'),
    '/app/management/leads',data.followUps,
    offset=>{if(refresh.disabled)return;followupsOffset=offset;void load(2);}));
   if(data.balances)lists.push(queue('today-balances',t('To‘lanmagan hisoblar','Outstanding accounts'),data.balances.href,data.balances));
   if(data.parents)lists.push(queue('today-parents',t('Ota-ona bog‘lanishlari','Parent links'),data.parents.href,data.parents));
   const guide=pageGuide(ctx,{key:'today-'+ctx.session.user.role,title:t('Qayerdan boshlayman?','Where do I start?'),
    steps:teacher?[t('Bugungi darslar ro‘yxatidan tegishli guruhga o‘ting.','Open today’s class list and choose the group.'),
      t('O‘tilgan dars uchun davomatni to‘liq belgilang.','Complete attendance for the held class.'),
      t('Ota-onaga xabar yozishda oluvchilarni tekshiring va yuborishni alohida tasdiqlang.','Review parent recipients and explicitly confirm sending.')]:
      [t('Dars yoki qabul navbatini ochib, navbatdagi amalni tanlang.','Open the class or admission queue and select the next action.'),
       t('To‘lanmagan hisoblar ro‘yxatida o‘quvchini tanlab, qarzi va to‘lovlarini ko‘ring.','Choose a student in outstanding accounts to review debt and payments.'),
       t('Faqat olingan pulni yozing. Chegirma va qaytarishlar alohida tasdiqlanadi.','Record only received funds. Credits and refunds require separate approval.')],
    example:t('Miqdorlar oxirgi yangilanish vaqtidagi holatni ko‘rsatadi.',
      'Counts reflect the displayed refresh time.')});
   const ai=academyAiPanel(ctx,{endpoint:'/api/staff/academy/assistant/proposals'});
   body.replaceChildren(...lists,guide,...(ai?[ai]:[]));
   if(focusIndex!==undefined)lists[focusIndex]?.querySelector('a')?.focus();
   status.textContent=t('Yangilandi: ','Updated: ')+paymentDate(data.observedAt,ctx.locale,'—');
  }catch{if(!ctx.signal.aborted)status.textContent=t('Ma’lumot yuklanmadi. Yangilashni bosing.','Could not load priorities. Select Refresh.');}
  finally{refresh.disabled=false;}
 }
 listen(refresh,'click',()=>void load(),ctx.signal);void load();return host;
}
