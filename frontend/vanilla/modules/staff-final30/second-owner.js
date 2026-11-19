import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';

const OWNER_PATH='/api/owner/second-owner';
const sections={
 people:['Foydalanuvchilar','People'],
 courses:['Kurslar','Courses'],
 groups:['Guruhlar','Groups'],
 materials:['Materiallar','Materials'],
 assignments:['Topshiriqlar','Assignments'],
 classes:['Jonli darslar','Live classes'],
 listening:['Listening','Listening'],
 reading:['Reading','Reading'],
 writing:['Writing','Writing'],
 speaking:['Speaking','Speaking'],
 grammar:['Grammatika','Grammar'],
 video:['Video darslar','Video lessons'],
 mocks:['Sinov imtihonlari','Mock tests'],
};

function management(context,t){
 const {root,signal,locale}=context;
 const link=el('input',{class:'input w-full',type:'text',readonly:true,'aria-label':t('Maxsus kirish havolasi','Special sign-in link')});
 const copy=el('button',{type:'button',class:'btn-secondary'},t('Nusxalash','Copy link'));
 const share=el('div',{class:'space-y-2'},link,copy);
 share.hidden=true;
 const status=el('div',{role:'status',class:'space-y-1 text-sm text-ink-700'});
 const notice=el('p',{role:'status',class:'text-sm'});
 const create=el('button',{type:'button',class:'btn-primary'},t('Maxsus havola yaratish','Create sign-in link'));
 const revoke=el('button',{type:'button',class:'btn-secondary'},t('Kirishni bekor qilish','Revoke access'));
 const retry=el('button',{type:'button',class:'btn-secondary'},t('Qayta urinish','Retry'));
 retry.hidden=true;
 function render(result){
  const date=new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en',{dateStyle:'medium',timeStyle:'short'});
  status.replaceChildren(
   el('p',{},result.inviteExpiresAt
    ?t('Havola amal qiladi: ','Link expires: ')+date.format(new Date(result.inviteExpiresAt))
    :t('Faol havola yo‘q.','No active link.')),
   el('p',{},result.sessionExpiresAt
    ?t('Sessiya amal qiladi: ','Session expires: ')+date.format(new Date(result.sessionExpiresAt))
    :t('Faol sessiya yo‘q.','No active session.')));
  revoke.disabled=!(result.inviteExpiresAt||result.sessionExpiresAt);
  if(!result.inviteExpiresAt||result.invitePath){
   link.value=result.invitePath?new URL(result.invitePath,location.origin).href:'';
   share.hidden=!link.value;
  }
 }
 async function update(method){
  create.disabled=true;
  revoke.disabled=true;
  retry.hidden=true;
  notice.textContent='';
  try{
   const result=await api.request(OWNER_PATH,{method,signal,fresh:true});
   if(signal.aborted)return;
   render(result);
   if(method==='DELETE')notice.textContent=t('Havola va sessiya bekor qilindi.','Link and session revoked.');
  }catch(error){
   if(signal.aborted)return;
   notice.textContent=t('Kirish holatini yangilab bo‘lmadi.','Could not update access.');
   retry.hidden=false;
   return;
  }
  create.disabled=false;
 }
 listen(create,'click',()=>void update('POST'),signal);
 listen(revoke,'click',()=>void update('DELETE'),signal);
 listen(retry,'click',()=>void update('GET'),signal);
 listen(copy,'click',async()=>{
  try{
   await navigator.clipboard.writeText(link.value);
   if(!signal.aborted)notice.textContent=t('Havola nusxalandi.','Link copied.');
  }catch{
   link.focus();
   link.select();
  }
 },signal);
 root.append(el('section',{class:'card mx-auto max-w-3xl space-y-4 p-5'},
  el('h1',{class:'font-display text-2xl text-ink-900'},'Second Owner'),
  el('p',{class:'text-sm text-ink-700'},t(
   'Bir martalik havola 20 daqiqa, kirish sessiyasi 24 soat amal qiladi.',
   'The one-time link expires in 20 minutes. The session lasts 24 hours.')),
  status,el('div',{class:'flex flex-wrap gap-2'},create,revoke,retry),share,notice));
 void update('GET');
}

function inspection(context,t){
 const {root,signal,url,navigate,locale}=context;
 const section=Object.hasOwn(sections,url.searchParams.get('section'))?url.searchParams.get('section'):'people';
 const q=(url.searchParams.get('q')??'').slice(0,120);
 const page=Math.max(1,Math.min(1000,Math.floor(Number(url.searchParams.get('page')))||1));
 const href=(key,query='',n=1)=>{
  const params=new URLSearchParams({section:key});
  if(query)params.set('q',query);
  if(n>1)params.set('page',String(n));
  return '/app/owner-observer?'+params;
 };
 const search=el('input',{class:'input min-w-0 flex-1',type:'search',maxlength:120,
  'aria-label':t('Qidirish','Search'),value:q});
 const form=el('form',{class:'flex flex-wrap gap-2'},search,
  el('button',{type:'submit',class:'btn-secondary'},t('Qidirish','Search')));
 listen(form,'submit',event=>{event.preventDefault();void navigate(href(section,search.value.trim()));},signal);
 const results=el('div',{'aria-live':'polite'});
 const navigation=el('nav',{class:'flex flex-wrap gap-2','aria-label':t('Bo‘limlar','Sections')},
  Object.entries(sections).map(([key,labels])=>el('a',{
   href:href(key),class:key===section?'btn-primary':'btn-secondary',
   'aria-current':key===section?'page':null,
  },labels[locale==='uz'?0:1])));
 root.append(el('section',{class:'card mx-auto max-w-4xl space-y-4 p-5'},
  el('h1',{class:'font-display text-2xl text-ink-900'},t('Boshqaruv ko‘rinishi','Management overview')),
  navigation,form,results));

 async function load(){
  results.replaceChildren(el('p',{role:'status'},t('Yuklanmoqda…','Loading…')));
  const params=new URLSearchParams({section,page:String(page),q});
  try{
   const result=await api.request('/api/second-owner/inspection?'+params,{signal,fresh:true});
   if(signal.aborted)return;
   results.replaceChildren(result.rows.length
    ?el('ul',{class:'divide-y divide-ink-100'},result.rows.map(row=>el('li',{class:'break-words py-3'},
     el('p',{class:'font-medium text-ink-900'},row.title),
     row.detail?el('p',{class:'text-sm text-ink-500'},row.detail):null)))
    :el('p',{class:'text-sm text-ink-500'},t('Hech narsa topilmadi.','No results.')));
   if(page>1||result.hasMore&&page<1000)results.append(el('div',{class:'mt-3 flex flex-wrap gap-2'},
    page>1?el('a',{href:href(section,q,page-1),class:'btn-secondary'},t('Oldingi','Previous')):null,
    result.hasMore&&page<1000?el('a',{href:href(section,q,page+1),class:'btn-secondary'},t('Keyingi','Next')):null));
  }catch(error){
   if(signal.aborted)return;
   const retry=el('button',{type:'button',class:'btn-secondary'},t('Qayta urinish','Retry'));
   listen(retry,'click',()=>void load(),signal);
   results.replaceChildren(el('p',{role:'alert'},t('Ma’lumotlarni yuklab bo‘lmadi.','Could not load data.')),retry);
  }
 }
 void load();
}

export function mount(context){
 const t=(uz,en)=>context.locale==='uz'?uz:en;
 if(context.url.pathname.replace(/\/$/,'')==='/app/owner/second-owner')return management(context,t);
 return inspection(context,t);
}
