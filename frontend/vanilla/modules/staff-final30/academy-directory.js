import {api} from '../../js/api-client.js';
import {academyHelp} from '../shared/academy-help.js';
import {el,listen} from '../../js/dom.js';
import {BackLink} from './kit.js';

const API='/api/staff/academy/directory';
const MAX_FILE=3000000;
const fields=['external_id','name','role','email','user_id'];
const en={
 title:'Student and staff directory files',file:'CSV or XLSX file',read:'Read columns',sheet:'Worksheet',
 source:'Source key',sourceHint:'Use the same lowercase key for later uploads from this source.',
 external_id:'External ID',name:'Name',role:'Role',email:'Email',user_id:'Existing account ID',ignore:'Unmapped',
 preview:'Preview import',apply:'Apply valid rows',confirm:'I reviewed this preview and authorize the import',
 download:'Download',export:'Export directory',exportSource:'Imported source (optional)',filter:'Account role',
 all:'All supported roles',student:'Students',teacher:'Teachers',errors:'Download row issues',total:'Rows',
 linked:'Linked to accounts',staged:'Awaiting account match',status:'Result',page:'Page',next:'Next',prev:'Previous',
 lookup:'Search registered accounts',link:'Link to account',pending:'Pending directory records',loadPending:'Find pending records',
 noPending:'No pending rows for this source.',linkConfirm:'I verified that these records belong to the same person',
 help:'Use Email or Existing account ID to match a registered account. Unmatched rows stay in the directory until the account exists. A new preview can link them later.',
 invalid_file:'Open the file in a spreadsheet editor and save it as UTF-8 CSV or XLSX.',
 empty_file:'The file is empty.',file_too_large:'The file exceeds the import size limit.',
 invalid_mapping:'Map external ID, name, role and either email or existing account ID to separate columns.',
 preview_changed:'Records changed since the preview. Generate a fresh preview before applying.',
 row_limit:'Upload at most 10,000 rows per file.',cell_limit:'The file contains too many columns or a cell exceeds the supported size.',
 column_mismatch:'At least one row contains columns missing from the header.',
 invalid_headers:'Enter text headings in the first row.',invalid_sheet:'Select a visible worksheet.',
 unsupported_workbook:'Save a workbook with ordinary values and no external links or macros.',
 ready_link:'Will link to an account',ready_stage:'Will store pending account match',already_staged:'Already pending',
 already_linked:'Already linked',duplicate_external_id:'Duplicate external ID',duplicate_email:'Duplicate email',
 duplicate_account:'Repeated account',source_email_conflict:'Email already belongs to another row in this source',
 source_account_conflict:'Account already belongs to another row in this source',
 source_record_conflict:'The source ID has different saved details',account_role_mismatch:'Account or role does not match',
 account_email_mismatch:'Email does not match the account',ambiguous_email:'Multiple accounts match the email',
 formula_cell:'Formula or spreadsheet error',invalid_text:'Unsupported text characters',invalid_name:'Invalid name',
 invalid_external_id:'Invalid external ID',invalid_email:'Invalid email',invalid_account_id:'Invalid account ID',
 contact_required:'Email or account ID required',unsupported_role:'Use student or teacher',invalid_input:'Check the file and source key.',
};
const uz={
 title:'O‘quvchi va xodimlar fayllari',file:'CSV yoki XLSX fayl',read:'Ustunlarni o‘qish',sheet:'Varaq',
 source:'Manba kaliti',sourceHint:'Shu manbadan keyingi yuklashda ham bir xil kichik harfli kalitdan foydalaning.',
 external_id:'Tashqi ID',name:'Ism',role:'Rol',email:'Email',user_id:'Mavjud hisob IDsi',ignore:'Tanlanmagan',
 preview:'Importni oldindan ko‘rish',apply:'Yaroqli qatorlarni saqlash',confirm:'Natijani ko‘rib chiqdim va importni tasdiqlayman',
 download:'Yuklab olish',export:'Katalogni eksport qilish',exportSource:'Import manbasi (ixtiyoriy)',filter:'Hisob roli',
 all:'Barcha ruxsat etilgan rollar',student:'O‘quvchilar',teacher:'O‘qituvchilar',errors:'Qator xatolarini yuklab olish',total:'Qatorlar',
 linked:'Hisobga bog‘langan',staged:'Hisob bilan bog‘lash kutilmoqda',status:'Natija',page:'Sahifa',next:'Keyingi',prev:'Oldingi',
 lookup:'Ro‘yxatdan o‘tgan hisoblarni qidirish',link:'Hisobga bog‘lash',pending:'Bog‘lash kutilayotgan yozuvlar',
 loadPending:'Kutilayotgan yozuvlarni topish',noPending:'Bu manbada bog‘lash kutilayotgan qator yo‘q.',
 linkConfirm:'Ikkala yozuv bir kishiga tegishli ekanini tekshirdim',
 help:'Ro‘yxatdan o‘tgan hisobni email yoki ID orqali toping. Hisobi topilmagan qator katalogda saqlanadi. Hisob ochilgach, yangi tekshiruv uni bog‘lashi mumkin.',
 invalid_file:'Faylni jadval dasturida ochib, UTF-8 CSV yoki XLSX formatida saqlang.',
 empty_file:'Fayl bo‘sh.',file_too_large:'Fayl import hajmi chegarasidan katta.',
 invalid_mapping:'Tashqi ID, ism, rol va email yoki hisob IDsi uchun turli ustunlarni tanlang.',
 preview_changed:'Tekshiruvdan keyin yozuvlar o‘zgardi. Saqlashdan avval qayta tekshiring.',
 row_limit:'Har faylda 10 000 tagacha qator yuklang.',cell_limit:'Ustunlar soni yoki katak uzunligi chegaradan oshdi.',
 column_mismatch:'Ayrim qatorlardagi ustun sarlavhada yo‘q.',invalid_headers:'Birinchi qatorga matnli sarlavhalar kiriting.',
 invalid_sheet:'Ko‘rinadigan varaqni tanlang.',unsupported_workbook:'Oddiy qiymatli, tashqi havola va makrossiz fayl saqlang.',
 ready_link:'Hisobga bog‘lanadi',ready_stage:'Hisob topilguncha saqlanadi',already_staged:'Avval saqlangan',
 already_linked:'Avval bog‘langan',duplicate_external_id:'Tashqi ID takrorlangan',duplicate_email:'Email takrorlangan',
 duplicate_account:'Hisob takrorlangan',source_email_conflict:'Email shu manbaning boshqa qatorida bor',
 source_account_conflict:'Hisob shu manbaning boshqa qatorida bor',source_record_conflict:'Manba IDsi avval boshqa qiymatlar bilan saqlangan',
 account_role_mismatch:'Hisob yoki rol mos kelmadi',account_email_mismatch:'Email hisobga mos kelmadi',
 ambiguous_email:'Email bir nechta hisobga mos keldi',formula_cell:'Formula yoki katak xatosi',
 invalid_text:'Matnda yaroqsiz belgilar bor',invalid_name:'Ism yaroqsiz',invalid_external_id:'Tashqi ID yaroqsiz',
 invalid_email:'Email yaroqsiz',invalid_account_id:'Hisob IDsi yaroqsiz',contact_required:'Email yoki hisob IDsi kerak',
 unsupported_role:'O‘quvchi yoki o‘qituvchi rolini kiriting',invalid_input:'Fayl va manba kalitini tekshiring.',
};

const label=(name,control)=>el('label',{class:'flex flex-col gap-1 text-sm'},name,control);
const input=(type,props={})=>el('input',{type,class:'input',...props});
const button=(name,props={})=>el('button',{type:'button',class:'btn-secondary',...props},name);
const sourceProps={maxlength:80,pattern:'[a-z0-9][a-z0-9._\\-]{0,79}'};
const option=(value,caption)=>el('option',{value},caption);

function encode(file){
 return file.arrayBuffer().then(buffer=>{
  const data=new Uint8Array(buffer);
  const chunks=[];
  for(let offset=0;offset<data.length;offset+=16384){
   chunks.push(String.fromCharCode(...data.subarray(offset,offset+16384)));
  }
  return btoa(chunks.join(''));
 });
}

export async function mount(ctx){
 if(ctx.session?.user?.role!=='owner'||ctx.signal.aborted)return;
 const t=ctx.locale==='uz'?uz:en;
 const file=input('file',{accept:'.csv,.xlsx',required:true});
 const source=input('text',{...sourceProps,required:true});
 const loadButton=button(t.read,{type:'submit'});
 const fileForm=el('form',{class:'flex flex-wrap items-end gap-3','data-directory-file':''},label(t.file,file),loadButton);
 const mapping=el('div',{class:'space-y-3'}),review=el('div',{class:'space-y-3','data-directory-review':''});
 const status=el('p',{role:'status'});
 const head=el('h1',{class:'font-display text-3xl'},t.title);
 const screen=el('section',{class:'mx-auto max-w-5xl space-y-4','data-academy-directory':''},
  BackLink({fallbackHref:'/app/management',label:ctx.dict.common.back}),head,
  exportPanel(ctx,t),el('p',{},t.help),fileForm,status,mapping,review,pendingPanel(ctx,t));
 ctx.root.append(screen);
 screen.append(academyHelp(ctx,'directory'));
 let payload, inspected, working=false, revision=0;
 function feedback(message,failed=false){
  status.setAttribute('role',failed?'alert':'status');
  status.textContent=message;
 }
 function clear(){
  revision++;
  review.replaceChildren();
  feedback('');
 }
 function showError(error){feedback(t[error?.code]??ctx.dict.common.error,true);}
 function post(operation,body,page=1){
  return api.request(API+'/import/'+operation+(page>1?'?page='+page:''),{
   method:'POST',body,signal:ctx.signal,timeoutMs:45000,
  });
 }
 listen(file,'change',()=>{payload=null;inspected=null;clear();mapping.replaceChildren();},ctx.signal);
 listen(fileForm,'submit',async event=>{
  event.preventDefault();
  if(working||!fileForm.reportValidity())return;
  const chosen=file.files[0];
  if(!chosen)return;
  if(chosen.size>MAX_FILE){showError({code:'file_too_large'});return;}
  const format=chosen.name.split('.').at(-1)?.toLowerCase();
  if(!['csv','xlsx'].includes(format)){showError({code:'invalid_file'});return;}
  working=true;loadButton.disabled=true;
  clear();mapping.replaceChildren();
  const current=revision;
  feedback(ctx.dict.common.loading);
  try{
   const body={format,data:await encode(chosen)};
   const result=await post('inspect',body);
   if(ctx.signal.aborted||current!==revision)return;
   payload={...body,sheet:result.sheet};
   inspected=result;
   showMapping();
   feedback(t.total+' · '+result.rowCount);
  }catch(error){if(!ctx.signal.aborted&&current===revision)showError(error);}
  finally{working=false;loadButton.disabled=false;}
 },ctx.signal);
 function showMapping(){
  const sheets=el('select',{class:'input'},inspected.sheets.map(name=>option(name,name)));
  sheets.value=inspected.sheet??'';
  listen(sheets,'change',async()=>{
   clear();const current=revision;
   try{
    const updated={...payload,sheet:sheets.value};
    const result=await post('inspect',updated);
    if(ctx.signal.aborted||current!==revision)return;
    payload=updated;inspected=result;showMapping();
    feedback(t.total+' · '+result.rowCount);
   }catch(error){if(!ctx.signal.aborted&&current===revision){sheets.value=payload.sheet;showError(error);}}
  },ctx.signal);
  const controls=fields.map(key=>{
   const select=el('select',{class:'input','data-directory-field':key},
    option('',t.ignore),inspected.headers.map((heading,index)=>option(index,heading||String(index+1))));
   select.value=String(inspected.suggested[key]??'');
   return [key,select];
  });
  const go=button(t.preview,{type:'submit'});
  const form=el('form',{class:'card space-y-3 p-4','data-directory-map':''},
   label(t.source,source),el('p',{class:'text-sm'},t.sourceHint),
   inspected.sheets.length>1?label(t.sheet,sheets):null,
   el('div',{class:'grid gap-3 sm:grid-cols-2'},controls.map(([key,value])=>label(t[key],value))),go);
  listen(form,'input',clear,ctx.signal);
  listen(form,'submit',event=>{
   event.preventDefault();
   if(working||!form.reportValidity())return;
   const columns=Object.fromEntries(controls.filter(([,value])=>value.value!=='').map(([key,value])=>[key,Number(value.value)]));
   void doPreview({...payload,source:source.value.trim(),columns},1,go);
  },ctx.signal);
  mapping.replaceChildren(form);
 }
 async function doPreview(body,page,trigger,reviewId){
  if(working)return;
  working=true;trigger.disabled=true;
  const current=revision;
  feedback(ctx.dict.common.loading);
  try{
   const result=await post('preview',body,page);
   if(ctx.signal.aborted||current!==revision)return;
   if(reviewId&&result.reviewHash!==reviewId){clear();throw {code:'preview_changed'};}
   showPreview(body,result);
   feedback('');
  }catch(error){if(!ctx.signal.aborted)showError(error);}
  finally{working=false;trigger.disabled=false;}
 }
 function showPreview(body,result){
  const prev=button(t.prev,{disabled:result.page<=1}),next=button(t.next,{disabled:result.page*result.pageSize>=result.total});
  listen(prev,'click',()=>void doPreview(body,result.page-1,prev,result.reviewHash),ctx.signal);
  listen(next,'click',()=>void doPreview(body,result.page+1,next,result.reviewHash),ctx.signal);
  const confirm=input('checkbox',{required:true});
  const save=button(t.apply,{type:'submit'});
  const form=el('form',{'data-directory-apply':'',class:'flex flex-wrap items-center gap-3'},label(t.confirm,confirm),save);
  let commandId;
  listen(form,'submit',async event=>{
   event.preventDefault();
   if(working||!form.reportValidity())return;
   working=true;save.disabled=true;commandId??=crypto.randomUUID();
   for(const control of screen.querySelectorAll('input,select,button'))control.dataset.directoryPrevious=control.disabled?'1':'0';
   for(const control of screen.querySelectorAll('input,select,button'))control.disabled=true;
   try{
    const reply=await post('apply',{...body,commandId,reviewHash:result.reviewHash});
    if(ctx.signal.aborted)return;
    feedback(t.linked+' '+reply.linked+' · '+t.staged+' '+reply.staged);
    const issueCount=reply.total-reply.linked-reply.staged-(reply.counts.already_linked??0)-(reply.counts.already_staged??0);
    review.replaceChildren(issueCount>0?el('a',{class:'btn-secondary',download:true,
     href:API+'/imports/'+reply.batchId+'/issues.csv'},t.errors):null);
   }catch(error){if(!ctx.signal.aborted)showError(error);}
   finally{
    working=false;
    for(const control of screen.querySelectorAll('[data-directory-previous]')){
     control.disabled=control.dataset.directoryPrevious==='1';delete control.dataset.directoryPrevious;
    }
    save.disabled=false;
   }
  },ctx.signal);
  const headers=[t.total,t.external_id,t.name,t.email,t.role,t.status];
  const rows=result.rows.map(row=>el('tr',{},[row.row,row.externalId,row.name,row.email??'—',
   t[row.role]??'—',t[row.status]??row.status].map(value=>el('td',{class:'px-2 py-1'},String(value)))));
  const counts=Object.entries(result.counts).map(([state,count])=>
   el('li',{},(t[state]??state)+' · '+count));
  review.replaceChildren(el('p',{class:'font-semibold'},t.total+' · '+result.total),
   el('ul',{class:'flex flex-wrap gap-3 text-sm'},counts),
   el('div',{class:'overflow-x-auto'},el('table',{class:'w-full text-left text-sm'},
    el('thead',{},el('tr',{},headers.map(title=>el('th',{scope:'col',class:'px-2 py-1'},title)))),
    el('tbody',{},rows))),
   el('div',{class:'flex items-center gap-3'},prev,el('span',{},t.page+' '+result.page),next),
   ...(result.ready>0?[form]:[]));
 }
}

function exportPanel(ctx,t){
 const source=input('text',sourceProps);
 const role=el('select',{class:'input'},option('',t.all),option('student',t.student),option('teacher',t.teacher));
 const format=el('select',{class:'input'},option('csv','CSV'),option('xlsx','XLSX'));
 const start=button(t.download,{type:'submit'}),next=button(t.next,{hidden:true});
 const status=el('p',{role:'status'});
 let nextUrl;
 const form=el('form',{class:'flex flex-wrap items-end gap-3'},label(t.exportSource,source),label(t.filter,role),
  label(t.file,format),start,next,status);
 listen(form,'change',()=>{nextUrl=null;next.hidden=true;},ctx.signal);
 listen(form,'submit',event=>{
  event.preventDefault();
  if(start.disabled||!form.reportValidity())return;
  const query=new URLSearchParams();
  if(source.value)query.set('source',source.value);
  if(role.value)query.set('role',role.value);
  void download(API+'/export/'+format.value+'?'+query);
 },ctx.signal);
 listen(next,'click',()=>{if(nextUrl)void download(nextUrl);},ctx.signal);
 async function download(path){
  if(start.disabled)return;
  start.disabled=true;next.disabled=true;
  status.textContent=ctx.dict.common.loading;
  try{
   const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error',signal:ctx.signal});
   if(!response.ok)throw new Error('Export unavailable');
   const blob=await response.blob();
   const url=URL.createObjectURL(blob);
   const a=el('a',{href:url,download:'academy-directory.'+format.value});
   document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   const link=response.headers.get('Link')?.match(/^<([^>]+)>; rel="next"$/)?.[1];
   nextUrl=link?.startsWith(API+'/export/')?link:null;
   next.hidden=!nextUrl;status.textContent='';
  }catch{if(!ctx.signal.aborted)status.textContent=ctx.dict.common.error;}
  finally{start.disabled=false;next.disabled=false;}
 }
 return el('details',{class:'card space-y-3 p-4'},el('summary',{class:'cursor-pointer font-semibold'},t.export),form);
}

function pendingPanel(ctx,t){
 const source=input('text',{...sourceProps,required:true});
 const status=el('p',{role:'status'}),rows=el('div',{class:'space-y-3'});
 const selection=el('div',{class:'space-y-3'});
 const find=button(t.loadPending,{type:'submit'});
 const form=el('form',{class:'flex flex-wrap items-end gap-3'},label(t.source,source),find);
 const panel=el('details',{class:'card space-y-3 p-4'},el('summary',{class:'cursor-pointer font-semibold'},t.pending),form,status,rows,selection);
 let generation=0;
 listen(source,'input',()=>{generation++;rows.replaceChildren();selection.replaceChildren();status.textContent='';},ctx.signal);
 listen(form,'submit',event=>{event.preventDefault();if(form.reportValidity())void load();},ctx.signal);
 async function load(after){
  const token=++generation, namespace=source.value;
  find.disabled=true;status.textContent=ctx.dict.common.loading;
  selection.replaceChildren();
  try{
   const query=new URLSearchParams({source:namespace});
   if(after)query.set('after',after);
   const data=await api.request(API+'/pending?'+query,{signal:ctx.signal,fresh:true});
   if(ctx.signal.aborted||token!==generation)return;
   rows.replaceChildren(el('ul',{class:'space-y-2'},data.rows.map(row=>{
    const open=button(t.link);
    listen(open,'click',()=>choose(row,namespace,after),ctx.signal);
    return el('li',{class:'flex flex-wrap items-center gap-3'},[row.external_id,row.name,row.email,t[row.role]].filter(Boolean).join(' · '),open);
   })));
   if(data.next){
    const next=button(t.next);
    listen(next,'click',()=>void load(data.next),ctx.signal);
    rows.append(next);
   }
   status.textContent=data.rows.length?'':t.noPending;
  }catch{if(!ctx.signal.aborted&&token===generation)status.textContent=ctx.dict.common.error;}
  finally{find.disabled=false;}
 }
 function choose(row,namespace,after){
  const search=input('search',{maxlength:120,required:true});
  const select=el('select',{class:'input',required:true});
  const confirmed=input('checkbox',{required:true});
  const go=button(t.lookup,{type:'submit'}),link=button(t.link,{type:'submit',disabled:true});
  const searchForm=el('form',{class:'flex flex-wrap items-end gap-3'},label(t.lookup,search),go);
  const linkForm=el('form',{class:'flex flex-wrap items-end gap-3'},label(t.user_id,select),label(t.linkConfirm,confirmed),link);
  selection.replaceChildren(el('p',{class:'font-semibold'},row.external_id+' · '+row.name),searchForm,linkForm);
  listen(searchForm,'submit',async event=>{
   event.preventDefault();
   if(go.disabled||!searchForm.reportValidity())return;
   go.disabled=true;link.disabled=true;confirmed.checked=false;select.replaceChildren();
   try{
    const query=new URLSearchParams({q:search.value.trim()});
    const kind=row.role==='teacher'?'directory-teacher':'student';
    const data=await api.request('/api/staff/academy/lookups/'+kind+'?'+query,{signal:ctx.signal});
    if(!selection.contains(searchForm))return;
    select.replaceChildren(...data.options.map(item=>option(item.id,item.label)));
    link.disabled=data.options.length===0;
   }catch{if(!ctx.signal.aborted)status.textContent=ctx.dict.common.error;}
   finally{go.disabled=false;}
  },ctx.signal);
  listen(linkForm,'submit',async event=>{
   event.preventDefault();
   if(link.disabled||!linkForm.reportValidity())return;
   link.disabled=true;
   try{
    await api.request(API+'/pending/link',{method:'POST',signal:ctx.signal,
     body:{source:namespace,externalId:row.external_id,userId:select.value}});
    if(!ctx.signal.aborted&&selection.contains(linkForm))await load(after);
   }catch(error){if(!ctx.signal.aborted)status.textContent=t[error.code]??ctx.dict.common.error;}
   finally{link.disabled=false;}
  },ctx.signal);
 }
 return panel;
}
