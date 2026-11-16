import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';
import {paymentDate} from '../payments/format.js';
import {pageGuide} from '../shared/page-guide.js';
import {academyAiPanel} from '../shared/academy-ai.js';

/** Counts always have their source list, rather than a decorative dashboard number. */
export function academyToday(ctx){
 const uz=ctx.locale==='uz',t=(a,b)=>uz?a:b,teacher=ctx.session.user.role==='teacher';
 const body=el('div',{class:'space-y-4'}),status=el('p',{role:'status'}),refresh=el('button',{type:'button',class:'btn-secondary'},t('Yangilash','Refresh'));
 const host=el('section',{class:'space-y-4','data-academy-today':''},el('h1',{class:'font-display text-3xl'},t('Bugun','Today')),
  el('p',{},teacher?t('Sizga biriktirilgan darslar va ota-onalar bilan ishlash.','Your assigned classes and parent communication.'):
    t('Dars, qabul va to‘lov bo‘yicha navbatdagi amallar. Sonni bosib uning manbasini ko‘ring.','Priorities for classes, admissions and payments. Open each count to see its source.')),refresh,status,body);
 let classesOffset=0,followupsOffset=0;
 function queue(id,title,data,empty,changePage){
  const {items,count,pagination}=data;
  const previous=el('button',{type:'button',class:'btn-secondary',disabled:!pagination?.offset},t('Oldingi','Previous'));
  const next=el('button',{type:'button',class:'btn-secondary',disabled:!pagination?.hasMore},t('Keyingi','Next'));
  listen(previous,'click',()=>changePage(Math.max(0,pagination.offset-10)),ctx.signal);
  listen(next,'click',()=>changePage(pagination.offset+10),ctx.signal);
  return el('details',{id,class:'card space-y-3 p-4'},el('summary',{class:'cursor-pointer font-semibold'},title),
   el('p',{class:'text-sm'},t('Ko‘rsatilgan: ','Showing: ')+items.length+' / '+count),
   items.length?el('ul',{class:'space-y-3'},items.map(row=>el('li',{},el('a',{href:row.href,class:'underline font-semibold'},row.name),
    el('p',{class:'text-sm'},row.startsAt?paymentDate(row.startsAt,ctx.locale,'—')+' · '+row.branch:paymentDate(row.dueAt,ctx.locale,'—'))))):el('p',{},empty),
   el('div',{class:'flex gap-2'},previous,next));
 }
 function card(title,count,href,detail){
  const link=el('a',{href,class:'card space-y-2 p-4'},el('h2',{class:'font-semibold'},title),
   el('p',{class:'text-3xl font-semibold'},count),el('p',{class:'text-sm'},t('Ro‘yxatni ochish','Open list')));
  if(detail)listen(link,'click',event=>{event.preventDefault();detail.open=true;detail.scrollIntoView({block:'start'});detail.querySelector('summary').focus();},ctx.signal);
  return link;
 }
 async function load(openId){
  if(refresh.disabled)return;refresh.disabled=true;status.textContent=ctx.dict.common.loading;
  try{
   const query=new URLSearchParams({classesOffset,followupsOffset});
   const data=await api.request('/api/staff/academy/today?'+query,{signal:ctx.signal,fresh:true});if(ctx.signal.aborted)return;
   const classes=queue('today-classes',t('Bugungi darslar','Today’s classes'),data.classes,t('Bu sahifada dars yo‘q.','No classes on this page.'),
    offset=>{if(refresh.disabled)return;classesOffset=offset;void load('today-classes');});
   const cards=[card(t('Bugungi darslar','Today’s classes'),data.classes.count,'#today-classes',classes)],lists=[classes];
   if(data.balances)cards.push(card(t('To‘lanmagan hisoblar','Outstanding accounts'),data.balances.count,data.balances.href));
   if(data.followUps){
    const leads=queue('today-followups',t('Bog‘lanish vaqti kelgan nomzodlar','Admissions follow-ups due'),data.followUps,t('Bu sahifada nomzod yo‘q.','No follow-ups on this page.'),
     offset=>{if(refresh.disabled)return;followupsOffset=offset;void load('today-followups');});
    cards.push(card(t('Qabul bo‘yicha bog‘lanishlar','Admissions follow-ups'),data.followUps.count,'#today-followups',leads));lists.push(leads);
   }
   if(data.parents)cards.push(card(t('Ota-ona bog‘lanishlari','Parent links'),data.parents.count,data.parents.href));
   const guide=pageGuide(ctx,{key:'today-'+ctx.session.user.role,title:t('Qayerdan boshlayman?','Where do I start?'),
    steps:teacher?[t('Bugungi darslar sonini oching va tegishli guruhga o‘ting.','Open today’s class list and choose the group.'),
      t('O‘tilgan dars uchun davomatni to‘liq belgilang.','Complete attendance for the held class.'),
      t('Ota-onaga xabar yozishda oluvchilarni tekshiring va yuborishni alohida tasdiqlang.','Review parent recipients and explicitly confirm sending.')]:
      [t('Dars yoki qabul navbatini ochib, navbatdagi amalni tanlang.','Open the class or admission queue and select the next action.'),
       t('To‘lanmagan hisoblar ro‘yxatida o‘quvchini tanlab, qarzi va to‘lovlarini ko‘ring.','Choose a student in outstanding accounts to review debt and payments.'),
       t('Faqat olingan pulni yozing. Chegirma va qaytarishlar alohida tasdiqlanadi.','Record only received funds. Credits and refunds require separate approval.')],
    example:t('Kartadagi son shu so‘rov vaqtida bazadan olingan. Xatoda u nol deb ko‘rsatilmaydi, qayta yuklash taklif qilinadi.',
      'Counts come from the database at the displayed refresh time. An error is not displayed as a zero.')});
   const ai=academyAiPanel(ctx,{endpoint:'/api/staff/academy/assistant/proposals'});
   body.replaceChildren(el('div',{class:'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'},cards),...lists,guide,...(ai?[ai]:[]));
   if(openId){const detail=body.querySelector('#'+openId);detail.open=true;detail.querySelector('summary').focus();}
   status.textContent=t('Yangilandi: ','Updated: ')+paymentDate(data.observedAt,ctx.locale,'—');
  }catch{if(!ctx.signal.aborted)status.textContent=t('Ma’lumot yuklanmadi. Yangilashni bosing.','Could not load priorities. Select Refresh.');}
  finally{refresh.disabled=false;}
 }
 listen(refresh,'click',()=>void load(),ctx.signal);void load();return host;
}
