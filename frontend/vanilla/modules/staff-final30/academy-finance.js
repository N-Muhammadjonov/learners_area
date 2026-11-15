import {api} from '../../js/api-client.js';
import {el, listen} from '../../js/dom.js';
import {anySignal} from '../../js/signals.js';
import {BackLink} from './kit.js';
import {financeDocuments} from './finance-documents.js';

const STAFF_API='/api/staff/finance';
const UUID=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
const MANAGERS=['owner','admin'];

function translations(ctx){
 return ctx.locale==='uz'?{
  title:'Akademiya moliyasi',journal:'Jurnal CSV',period:'Jurnal oyi',start:'Boshlanish',end:'Tugash',report:'Hisobot',statement:'O‘quvchi hisoboti',
  find:'O‘quvchi qidirish',select:'O‘quvchini tanlang',open:'Ochish',submit:'To‘lovni yozish',
  cash:'Naqd',bank:'Bank',purpose:'To‘lov maqsadi',amount:'Miqdor (so‘m)',confirm:'To‘lov miqdori va usulini tekshirdim',
  total:'Jami tushum',recognized:'Tan olingan daromad',debt:'Qarz',overdue:'Muddati o‘tgan qarz',
  advance:'Avans',refunds:'Qaytarilgan mablag‘',charges:'Hisoblangan to‘lovlar',payments:'To‘lovlar',
  receipt:'Ichki to‘lov tasdiqnomasi',print:'Chop etish',noRows:'Yozuv yo‘q.',retry:'Qayta urinish',
  clear:'Ochiq qarz yo‘q',outstanding:'Ochiq qarz bor',pastDue:'Muddati o‘tgan qarz bor',
  recorded:'To‘lov yozildi',receiptNo:'Raqam',received:'To‘lov sanasi',method:'Usul',status:'Holat',
  pending_provider:'Provider tasdig‘i kutilmoqda',confirmed:'Tasdiqlangan',partially_refunded:'Qisman qaytarilgan',
  refunded:'Qaytarilgan',provider:'To‘lov provayderi',reconcile:'Hisoblarni solishtirish',match:'Hisoblar mos',
  mismatch:'Hisoblar o‘rtasida farq bor',invalid_amount:'Butun so‘m miqdorini kiriting.',
  aging:'Qarzning muddati',current:'Muddati kelmagan',agingDay:'Hisob sanasi',
  day_closed:'Kassa kuni yopilgan.',finance_period_locked:'Moliya davri yopilgan.',
  closeDay:'Kassa kunini yopish', day:'Kassa sanasi', opening:'Boshlang‘ich qoldiq', counted:'Sanalgan mablag‘',
  expected:'Hisob bo‘yicha qoldiq', variance:'Farq', closeConfirm:'Sanalgan mablag‘ni tekshirdim va kassani yopishga tayyorman',
  notes:'Izoh', closedDay:'Kassa kuni yopildi', day_already_closed:'Bu kassa kuni avval yopilgan.',
 }:{
  title:'Academy finance',journal:'Journal CSV',period:'Journal month',start:'Start',end:'End',report:'Report',statement:'Student statement',
  find:'Search students',select:'Select a student',open:'Open',submit:'Record payment',
  cash:'Cash',bank:'Bank',purpose:'Payment purpose',amount:'Amount (UZS)',confirm:'I checked the payment method and amount',
  total:'Total collected',recognized:'Recognized revenue',debt:'Outstanding balance',overdue:'Overdue balance',
  advance:'Advance',refunds:'Settled refunds',charges:'Charges',payments:'Payments',
  receipt:'Internal payment acknowledgment',print:'Print',noRows:'No records.',retry:'Retry',
  clear:'No outstanding balance',outstanding:'Outstanding balance',pastDue:'Past-due balance',
  recorded:'Payment recorded',receiptNo:'Number',received:'Payment date',method:'Method',status:'Status',
  pending_provider:'Awaiting provider confirmation',confirmed:'Confirmed',partially_refunded:'Partially refunded',
  refunded:'Refunded',provider:'Payment provider',reconcile:'Reconcile accounts',match:'Accounts agree',
  mismatch:'Accounts differ',invalid_amount:'Enter a whole UZS amount.',
  aging:'Receivables aging',current:'Current',agingDay:'As of',
  day_closed:'The cash day is closed.',finance_period_locked:'The financial period is locked.',
  closeDay:'Close cash day', day:'Business date', opening:'Opening cash', counted:'Counted cash',
  expected:'Expected cash', variance:'Variance', closeConfirm:'I checked the cash count and am ready to close the day',
  notes:'Note', closedDay:'Cash day closed', day_already_closed:'This cash day was already closed.',
 };
}

function button(label, props={}){
 return el('button',{type:'button',class:'btn-secondary',...props},label);
}

function label(text,field){
 return el('label',{class:'flex flex-col gap-1 text-sm'},text,field);
}

function amounts(ctx){
 const formatter=new Intl.NumberFormat(ctx.locale==='uz'?'uz-UZ':'en-GB',{maximumFractionDigits:0});
 return value=>Number.isSafeInteger(value)?formatter.format(value)+' UZS':'—';
}

function businessDate(){
 const fields=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',
 }).formatToParts().map(part=>[part.type,part.value]));
 return fields.year+'-'+fields.month+'-'+fields.day;
}

function totals(entries){
 return el('dl',{class:'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'},entries.map(([title,value])=>
  el('div',{class:'card p-3'},el('dt',{class:'text-sm'},title),el('dd',{class:'font-semibold'},value))));
}

function printReceipt(ctx,payment,studentLabel){
 const t=translations(ctx),amount=amounts(ctx);
 const stamp=new Intl.DateTimeFormat(ctx.locale==='uz'?'uz-UZ':'en-GB',{
  dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tashkent',
 }).format(new Date(payment.occurred_at));
 const content=el('article',{},el('h1',{},t.receipt),
  el('dl',{},[[t.receiptNo,payment.receipt_no],[t.statement,studentLabel],
   [t.amount,amount(payment.amount_minor)],[t.method,t[payment.method]??payment.method],
   [t.received,stamp],[t.status,t[payment.status]??payment.status]].map(([name,value])=>
    el('div',{},el('dt',{},name),el('dd',{},value)))));
 const frame=el('iframe',{title:t.receipt,'aria-hidden':'true',style:{
  position:'fixed',width:'1px',height:'1px',border:0,opacity:'0',pointerEvents:'none',
 }});
 document.body.append(frame);
 try {
  const win=frame.contentWindow;
  const doc=frame.contentDocument;
  if(!win||!doc?.body){frame.remove();return;}
  doc.title=t.receipt;
  doc.body.append(content);
  const cleanup=()=>{frame.remove();ctx.signal.removeEventListener('abort',cleanup);};
  ctx.signal.addEventListener('abort',cleanup,{once:true});
  win.addEventListener('afterprint',cleanup,{once:true});
  win.focus();
  win.print();
 } catch(error) {frame.remove();throw error;}
}

function statementView(ctx,data,studentLabel){
 const t=translations(ctx), fmt=amounts(ctx), p=data.position;
 function entries(title,rows,render){
  return el('section',{class:'card space-y-2 p-3'},el('h3',{class:'font-semibold'},title),
   rows.length?el('ul',{class:'divide-y divide-ink-100'},rows.map(render)):el('p',{},t.noRows));
 }
 const view=el('div',{class:'space-y-3'},
  totals([[t.debt,fmt(p.balanceDueMinor)],[t.overdue,fmt(p.overdueMinor)],
   [t.advance,fmt(p.advanceMinor)],[t.refunds,fmt(p.refundedMinor)]]),
  entries(t.charges,data.charges,row=>el('li',{class:'py-2'},[row.period_key,fmt(row.net_amount_minor),row.status].join(' · '))),
  entries(t.payments,data.payments,row=>{
   const print=button(t.print);
   const printable=Boolean(row.receipt_no&&row.occurred_at&&['confirmed','partially_refunded','refunded'].includes(row.status));
   listen(print,'click',()=>printReceipt(ctx,row,studentLabel),ctx.signal);
   return el('li',{class:'flex items-center justify-between gap-2 py-2'},
    el('span',{},[row.receipt_no,fmt(row.amount_minor),t[row.method]??row.method,t[row.status]??row.status].filter(Boolean).join(' · ')),
    printable?print:null);
  }),
  entries(t.refunds,data.refunds,row=>el('li',{class:'py-2'},
   [row.effective_on,fmt(row.amount_minor),t[row.status]??row.status].filter(Boolean).join(' · '))));
 return view;
}

function staffPaymentForm(ctx,id,onSaved){
 const t=translations(ctx), amount=el('input',{class:'input',type:'number',min:1,step:1,max:Number.MAX_SAFE_INTEGER,required:true});
 const method=el('select',{class:'input'},['cash','bank'].map(value=>el('option',{value},t[value])));
 const purpose=el('input',{class:'input',maxlength:120});
 const confirm=el('input',{type:'checkbox',required:true});
 const save=button(t.submit,{type:'submit',class:'btn-primary'});
 const status=el('p',{role:'status'}), error=el('p',{role:'alert'});
 let pending=null;
 const form=el('form',{class:'card space-y-3 p-3','data-academy-payment-form':''},
  el('h3',{class:'font-semibold'},t.submit),label(t.amount,amount),label(t.method,method),
  label(t.purpose,purpose),el('label',{class:'flex gap-2'},confirm,t.confirm),save,status,error);
 listen(form,'submit',async event=>{
  event.preventDefault();
  if(save.disabled||ctx.signal.aborted||!form.reportValidity())return;
  const value=amount.valueAsNumber;
  if(!Number.isSafeInteger(value)||value<1){error.textContent=t.invalid_amount;return;}
  const data={studentUserId:id,amountMinor:value,method:method.value,receiptPurpose:purpose.value.trim()||null};
  const fingerprint=JSON.stringify(data);
  if(pending?.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};
  save.disabled=true;error.textContent='';status.textContent=ctx.dict.common.saving;
  try {
   await api.request(STAFF_API+'/payments',{method:'POST',signal:ctx.signal,
    body:{...data,idempotencyKey:pending.key}});
   if(ctx.signal.aborted)return;
   pending=null;
   form.reset();
   status.textContent=t.recorded;
   await onSaved();
  } catch(cause){
   if(!ctx.signal.aborted){status.textContent='';error.textContent=Object.hasOwn(t,cause.code)?t[cause.code]:ctx.dict.common.error;}
  }finally{save.disabled=false;}
 },ctx.signal);
 return form;
}

function studentStatement(ctx,id,studentLabel,allowPayment){
 const t=translations(ctx),v=el('div',{class:'space-y-3'});
 const feedback=el('p',{role:'status'});
 const shell=el('section',{class:'space-y-3'},el('h2',{class:'font-display text-xl'},t.statement+' · '+studentLabel),feedback,v);
 let reading=false;
 async function load(){
  if(reading||ctx.signal.aborted)return;
  reading=true;
  v.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try{
   const data=await api.request(STAFF_API+'/students/'+id+'/statement',{signal:ctx.signal,fresh:true});
   if(ctx.signal.aborted)return;
   v.replaceChildren(statementView(ctx,data,studentLabel));
   if(allowPayment)v.append(financeDocuments(ctx,id,data,amounts(ctx),businessDate(),async message=>{
    feedback.textContent=message;
    await load();
   }));
  }catch{
   if(ctx.signal.aborted)return;
   const retry=button(t.retry);listen(retry,'click',load,ctx.signal);
   v.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error),retry);
  }finally{reading=false;}
 }
 if(allowPayment)shell.append(staffPaymentForm(ctx,id,load));
 void load();
 return shell;
}

export function financeInProfile(ctx,id,studentLabel=''){
 const role=ctx.session?.user?.role;
 if(!MANAGERS.includes(role)&&role!=='teacher'&&role!=='student')return null;
 const t=translations(ctx),body=el('div',{class:'space-y-3'});
 const panel=el('details',{class:'card space-y-3 p-4','data-academy-finance-profile':''},
  el('summary',{class:'cursor-pointer font-semibold'},t.title),body);
 async function load(){
  if(MANAGERS.includes(role)){body.replaceChildren(studentStatement(ctx,id,studentLabel||id,false));return;}
  body.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try{
   const route=role==='student'?'/api/finance/me':STAFF_API+'/students/'+id+'/tuition-status';
   const result=await api.request(route,{signal:ctx.signal});
   if(ctx.signal.aborted)return;
   if(role==='teacher'){
    const copy={clear:t.clear,outstanding:t.outstanding,overdue:t.pastDue};
    body.replaceChildren(el('p',{},copy[result.balanceStatus]??ctx.dict.common.error));
   } else {
    const fmt=amounts(ctx),p=result.position;
    body.replaceChildren(totals([[t.debt,fmt(p.balanceDueMinor)],[t.overdue,fmt(p.overdueMinor)],[t.advance,fmt(p.advanceMinor)]]));
   }
  }catch{
   if(ctx.signal.aborted)return;
   const retry=button(t.retry);listen(retry,'click',load,ctx.signal);
   body.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error),retry);
  }
 }
 listen(panel,'toggle',()=>{if(panel.open&&!body.childNodes.length)void load();},ctx.signal);
 return panel;
}

export async function mount(ctx){
 if(!MANAGERS.includes(ctx.session?.user?.role)||ctx.signal.aborted)return;
 const t=translations(ctx),fmt=amounts(ctx),today=businessDate();
 const start=el('input',{type:'date',class:'input',value:today.slice(0,8)+'01',required:true});
 const end=el('input',{type:'date',class:'input',value:today,required:true});
 const submit=button(t.report,{type:'submit'});
 const reconcile=button(t.reconcile);
 const summary=el('div',{class:'space-y-3'});
 const recon=el('div',{class:'space-y-3'});
 const form=el('form',{class:'flex flex-wrap items-end gap-3'},label(t.start,start),label(t.end,end),submit,reconcile);
 const search=el('input',{type:'search',maxlength:120,class:'input'});
 const matches=el('select',{class:'input','aria-label':t.select});
 const open=button(t.open,{disabled:true});
 const lookup=button(t.find,{type:'submit'});
 const lookupForm=el('form',{class:'flex flex-wrap items-end gap-3','data-academy-student-search':''},
  label(t.find,search),lookup,label(t.select,matches),open);
 const findStatus=el('p',{role:'status'});
 const studentHost=el('div',{class:'space-y-3'});
 const host=el('div',{class:'mx-auto max-w-6xl space-y-4','data-academy-finance':''},
  BackLink({fallbackHref:'/app/management',label:ctx.dict.common.back}),el('h1',{class:'font-display text-3xl'},t.title),
  form,summary,recon,agingReport(ctx),journalExport(ctx,today),cashClose(ctx,today),lookupForm,findStatus,studentHost);
 ctx.root.append(host);
 let selectedController;
 async function report(){
  if(submit.disabled||!form.reportValidity()||ctx.signal.aborted)return;
  submit.disabled=true;
  summary.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try{
   const data=await api.request(STAFF_API+'/summary?'+new URLSearchParams({start:start.value,end:end.value}),{signal:ctx.signal});
   if(!ctx.signal.aborted)summary.replaceChildren(totals([[t.total,fmt(data.collectedTotalMinor)],
    [t.cash,fmt(data.collectedCashMinor)],[t.bank,fmt(data.collectedBankMinor)],[t.recognized,fmt(data.recognizedRevenueMinor)],
    [t.debt,fmt(data.outstandingReceivableMinor)],[t.overdue,fmt(data.overdueReceivableMinor)],
    [t.advance,fmt(data.customerAdvanceMinor)],[t.refunds,fmt(data.refundsMinor)]]));
  }catch{if(!ctx.signal.aborted)summary.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error));}
  finally{submit.disabled=false;}
 }
 listen(form,'submit',event=>{event.preventDefault();void report();},ctx.signal);
 listen(reconcile,'click',async()=>{
  if(reconcile.disabled||!form.reportValidity()||ctx.signal.aborted)return;
  reconcile.disabled=true;
  recon.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try{
   const result=await api.request(STAFF_API+'/reconciliation?'+new URLSearchParams({start:start.value,end:end.value}),{signal:ctx.signal});
   if(!ctx.signal.aborted)recon.replaceChildren(el('p',{role:'status'},result.journal?.balanced===true&&result.summary?.ok===true?t.match:t.mismatch));
  }catch{if(!ctx.signal.aborted)recon.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error));}
  finally{reconcile.disabled=false;}
 },ctx.signal);
 listen(lookupForm,'submit',async event=>{
  event.preventDefault();if(lookup.disabled||ctx.signal.aborted)return;
  open.disabled=true;lookup.disabled=true;findStatus.textContent=ctx.dict.common.loading;matches.replaceChildren();
  try{
   const result=await api.request('/api/staff/academy/lookups/student?'+new URLSearchParams({q:search.value.trim()}),{signal:ctx.signal});
   if(ctx.signal.aborted)return;
   matches.replaceChildren(...result.options.map(row=>el('option',{value:row.id},row.label)));
   open.disabled=result.options.length===0;
   findStatus.textContent=result.options.length?'':t.noRows;
  }catch{if(!ctx.signal.aborted)findStatus.textContent=ctx.dict.common.error;}
  finally{lookup.disabled=false;}
 },ctx.signal);
 listen(open,'click',()=>{
  const id=matches.value;if(!UUID.test(id))return;
  selectedController?.abort();selectedController=new AbortController();
  const selected={...ctx,signal:anySignal([ctx.signal,selectedController.signal])};
  studentHost.replaceChildren(studentStatement(selected,id,matches.selectedOptions[0].textContent,true));
 },ctx.signal);
 await report();
}

function cashClose(ctx,today){
 const t=translations(ctx),fmt=amounts(ctx);
 const date=el('input',{type:'date',class:'input',required:true,value:today,max:today});
 const cash=attrs=>el('input',{type:'number',class:'input',min:0,max:Number.MAX_SAFE_INTEGER,step:1,required:true,...attrs});
 const counted=cash({}),opening=cash({value:0});
 const note=el('input',{class:'input',maxlength:300});
 const confirm=el('input',{type:'checkbox',required:true});
 const save=button(t.closeDay,{type:'submit',class:'btn-primary'}),feedback=el('div',{'aria-live':'polite'});
 const form=el('form',{class:'space-y-3','data-academy-cash-close':''},
  el('div',{class:'grid gap-3 sm:grid-cols-2'},label(t.day,date),label(t.opening,opening),
   label(t.counted,counted),label(t.notes,note)),el('label',{class:'flex gap-2'},confirm,t.closeConfirm),save,feedback);
 listen(form,'submit',async event=>{
  event.preventDefault();
  if(save.disabled||ctx.signal.aborted||!form.reportValidity())return;
  if(![opening.valueAsNumber,counted.valueAsNumber].every(Number.isSafeInteger)){
   feedback.replaceChildren(el('p',{role:'alert'},t.invalid_amount));return;
  }
  save.disabled=true;
  feedback.replaceChildren(el('p',{role:'status'},ctx.dict.common.saving));
  try{
   const result=await api.request(STAFF_API+'/days/close',{method:'POST',signal:ctx.signal,
    body:{businessDate:date.value,countedMinor:counted.valueAsNumber,openingMinor:opening.valueAsNumber,
     reason:note.value.trim()||null}});
   if(ctx.signal.aborted)return;
   confirm.checked=false;
   const x=result.close;
   feedback.replaceChildren(el('p',{role:'status'},t.closedDay),
    totals([[t.expected,fmt(x.expected_minor)],[t.counted,fmt(x.counted_minor)],[t.variance,fmt(x.variance_minor)]]));
  }catch(error){
   if(!ctx.signal.aborted)feedback.replaceChildren(el('p',{role:'alert'},
    Object.hasOwn(t,error.code)?t[error.code]:ctx.dict.common.error));
  }finally{save.disabled=false;}
 },ctx.signal);
 return el('details',{class:'card space-y-3 p-4'},el('summary',{class:'cursor-pointer font-semibold'},t.closeDay),form);
}

function journalExport(ctx,today){
 const t=translations(ctx);
 const period=el('input',{type:'month',class:'input',value:today.slice(0,7),required:true});
 const address=()=>STAFF_API+'/journal.csv?'+new URLSearchParams({period:period.value});
 const link=el('a',{class:'btn-secondary',href:address(),download:true},t.journal);
 listen(period,'input',()=>{
  if(period.reportValidity())link.href=address();
  else link.removeAttribute('href');
 },ctx.signal);
 return el('div',{class:'flex flex-wrap items-end gap-3'},label(t.period,period),link);
}

function agingReport(ctx){
 const t=translations(ctx),fmt=amounts(ctx),body=el('div',{class:'space-y-3'});
 const panel=el('details',{class:'card space-y-3 p-4','data-finance-aging':''},
  el('summary',{class:'cursor-pointer font-semibold'},t.aging),body);
 async function load(){
  body.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
  try{
   const data=await api.request(STAFF_API+'/aging',{signal:ctx.signal,fresh:true});
   if(ctx.signal.aborted)return;
   const keys={current:t.current,days1To30:'1–30',days31To60:'31–60',days61To90:'61–90',over90:'90+'};
   body.replaceChildren(el('p',{class:'text-sm'},t.agingDay+' · '+data.asOf),
    totals(Object.entries(keys).map(([key,label])=>[label,fmt(data.bucketsMinor[key])])));
  }catch{
   if(ctx.signal.aborted)return;
   const retry=button(t.retry);
   listen(retry,'click',load,ctx.signal);
   body.replaceChildren(el('p',{role:'alert'},ctx.dict.common.error),retry);
  }
 }
 listen(panel,'toggle',()=>{if(panel.open)void load();},ctx.signal);
 return panel;
}
