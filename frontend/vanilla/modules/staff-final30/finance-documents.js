import {api} from '../../js/api-client.js';
import {el, listen} from '../../js/dom.js';

const API = '/api/staff/finance';
const en = {
 contracts:'Contracts', contract:'Draft contract', fee:'Monthly fee (UZS)', term:'Months', from:'Starts on',
 until:'Ends on', period:'Billing month', due:'Due date', discount:'Record discount', installment:'Draft installment',
 charge:'Draft standalone charge', credit:'Draft credit note', credits:'Credit notes', refund:'Request refund',
 approve:'Approve', activate:'Activate', post:'Post to ledger', reverse:'Reverse charge', settle:'Record refund payout',
 reject:'Reject refund', fail:'Record failed payout', sandbox:'Sandbox provider intent',
 sandboxHint:'Test intent. It remains pending until the signed sandbox callback arrives.',
 refundHint:'Requested and approved refunds have no cash effect until payout is recorded.',
 reason:'Reason', amount:'Amount (UZS)', provider:'Sandbox provider', reference:'Provider reference',
 recognize:'Recognize earned tuition', recognitionMemo:'Note',
 insufficient_deferred_revenue:'The amount exceeds deferred tuition for this student.',
 period_closed:'The accounting period is closed.',
 saved:'Saved', confirm:'I confirm this action', none:'No documents.',
 draft:'Draft', approved:'Approved', active:'Active', posted:'Posted', requested:'Requested',
 settled:'Paid out', rejected:'Rejected', failed:'Failed', reversed:'Reversed', completed:'Completed', cancelled:'Cancelled',
 approver_must_differ_from_drafter:'A different owner must approve this draft.',
 approver_must_differ_from_requester:'An owner other than the requester must approve this refund.',
 invalid_state:'This document has changed. Refresh the statement.',
 refund_exceeds_available_funds:'The payment has insufficient refundable funds.',
 credit_exceeds_unallocated_charge:'The credit exceeds the unallocated charge balance.',
 charge_already_posted:'This charge is posted. Use a credit note for relief.',
 discount_already_approved_for_period:'This contract already has a discount for the month.',
 charge_already_exists_for_period:'This contract already has a charge for the month.',
 credit_note_already_exists:'A credit note already exists for this charge.',
 idempotency_conflict:'This request key was used with different data.',
 invalid_contract_dates:'The end date must be on or after the start date.',
 day_closed:'This cash day has been closed.', refund_already_settled:'The refund payout is already recorded.',
};
const uz = {
 contracts:'Kontraktlar', contract:'Kontrakt loyihasi', fee:'Oylik narx (so‘m)', term:'Oylar', from:'Boshlanish sanasi',
 until:'Tugash sanasi', period:'Hisob-kitob oyi', due:'To‘lov muddati', discount:'Chegirma yozish',
 installment:'Oylik to‘lov loyihasi', charge:'Alohida to‘lov loyihasi', credit:'Kredit nota loyihasi',
 credits:'Kredit notalar', refund:'Pul qaytarishni so‘rash', approve:'Tasdiqlash', activate:'Faollashtirish',
 post:'Jurnalga yozish', reverse:'Hisoblangan to‘lovni bekor qilish', settle:'Qaytarilgan pulni qayd etish',
 reject:'So‘rovni rad etish', fail:'Qaytarish bajarilmaganini qayd etish', sandbox:'Provider sinov buyurtmasi',
 sandboxHint:'Imzolangan sinov callbacki kelguncha buyurtma kutilmoqda holatida qoladi.',
 refundHint:'So‘rov va tasdiq balansni o‘zgartirmaydi. Pul chiqishi alohida qayd etiladi.',
 reason:'Sabab', amount:'Miqdor (so‘m)', provider:'Sinov provayderi', reference:'Provayder tranzaksiya raqami',
 recognize:'Ishlab topilgan daromadni tan olish', recognitionMemo:'Izoh',
 insufficient_deferred_revenue:'Miqdor o‘quvchi bo‘yicha kechiktirilgan daromaddan katta.',
 period_closed:'Moliya davri yopilgan.',
 saved:'Saqlandi', confirm:'Amalni tasdiqlayman', none:'Hujjatlar yo‘q.',
 draft:'Loyiha', approved:'Tasdiqlangan', active:'Faol', posted:'Jurnalga yozilgan', requested:'So‘ralgan',
 settled:'Pul qaytarilgan', rejected:'Rad etilgan', failed:'Bajarilmadi', reversed:'Bekor qilingan',
 completed:'Yakunlangan', cancelled:'Bekor qilingan',
 approver_must_differ_from_drafter:'Loyihani boshqa egasi tasdiqlashi kerak.',
 approver_must_differ_from_requester:'So‘rovni yuborgan xodimdan boshqa egasi tasdiqlashi kerak.',
 invalid_state:'Hujjat holati o‘zgargan. Hisobotni yangilang.',
 refund_exceeds_available_funds:'To‘lovdagi qaytarilishi mumkin bo‘lgan mablag‘ yetarli emas.',
 credit_exceeds_unallocated_charge:'Kredit nota miqdori qolgan qarzdan katta.',
 charge_already_posted:'To‘lov jurnalga yozilgan. Kamaytirish uchun kredit nota ishlating.',
 discount_already_approved_for_period:'Bu oy uchun chegirma mavjud.',
 charge_already_exists_for_period:'Bu oy uchun hisoblangan to‘lov mavjud.',
 credit_note_already_exists:'Bu to‘lov uchun kredit nota bor.',
 idempotency_conflict:'So‘rov kaliti boshqa ma’lumot bilan ishlatilgan.',
 invalid_contract_dates:'Tugash sanasi boshlanish sanasidan oldin bo‘lishi mumkin emas.',
 day_closed:'Kassa kuni yopilgan.', refund_already_settled:'Qaytarilgan pul avval qayd etilgan.',
};

const btn = (text, attrs={}) => el('button',{type:'submit',class:'btn-primary',...attrs},text);
const field = (name,label,type,attrs={},options=[]) => ({name,label,type,attrs,options});
const money = (name,label,min=1) => field(name,label,'number',{min,max:Number.MAX_SAFE_INTEGER,step:1});
const reason = t => field('reason',t.reason,'text',{maxlength:200});
const summary = text => el('summary',{class:'cursor-pointer font-semibold'},text);
const sameActor = (ctx,id) => id && id===ctx.session.user.id;

function command(ctx, t, action, path, fields, constants, onSaved, {retryKey=false,hint}={}) {
 const controls = fields.map(spec=>{
  const attrs = {class:'input',required:true,...spec.attrs};
  const input = spec.type==='select' ? el('select',attrs,
   spec.options.map(value=>el('option',{value},value))) : el('input',{...attrs,type:spec.type});
  return {...spec,input};
 });
 const check=el('input',{type:'checkbox',required:true});
 const save=btn(action);
 const feedback=el('p',{role:'alert',hidden:true});
 const form=el('form',{class:'space-y-2 py-2','data-finance-command':path},
  hint?el('p',{class:'text-sm'},hint):null,
  controls.map(spec=>el('label',{class:'flex flex-col gap-1 text-sm'},spec.label,spec.input)),
  el('label',{class:'flex items-center gap-2'},check,t.confirm),save,feedback);
 let previous='', key;
 listen(form,'submit',async event=>{
  event.preventDefault();
  if(save.disabled||ctx.signal.aborted||!form.reportValidity())return;
  const data={...constants};
  for(const {name,input,type} of controls){
   if(!input.value&&!input.required)continue;
   data[name]=type==='number'?input.valueAsNumber:input.value.trim();
  }
  const fingerprint=JSON.stringify(data);
  if(retryKey){
   if(previous!==fingerprint){previous=fingerprint;key=crypto.randomUUID();}
   data.commandId=key;
  }
  if(data.method==='provider'){
   if(previous!==fingerprint){previous=fingerprint;key=crypto.randomUUID();}
   data.idempotencyKey=key;
  }
  save.disabled=true;
  feedback.hidden=true;
  try{
   await api.request(API+path,{method:'POST',body:data,signal:ctx.signal});
   if(ctx.signal.aborted)return;
   previous='';
   form.reset();
   await onSaved(t.saved);
  }catch(error){
   if(!ctx.signal.aborted){
    feedback.hidden=false;
    feedback.textContent=Object.hasOwn(t,error.code)?t[error.code]:ctx.dict.common.error;
   }
  }finally{save.disabled=false;}
 },ctx.signal);
 return el('details',{class:'space-y-1'},summary(action),form);
}

export function financeDocuments(ctx, studentId, data, format, day, onSaved) {
 const t=ctx.locale==='uz'?uz:en;
 const owner=ctx.session.user.role==='owner';
 const draw=(label,path,fields=[],body={},options)=>command(ctx,t,label,path,fields,body,onSaved,options);
 const state=row=>Object.hasOwn(t,row.status)?t[row.status]:row.status;
 const month=()=>field('periodKey',t.period,'month',{value:day.slice(0,7)});
 const due=()=>field('dueDate',t.due,'date',{value:day});
 const line=(text,actions)=>el('li',{class:'space-y-2 border-b border-ink-100 py-2'},el('p',{},text),actions);
 const rows=(label,items)=>el('section',{class:'space-y-2'},el('h3',{class:'font-semibold'},label),
  items.length?el('ul',{},items):el('p',{class:'text-sm'},t.none));
 const contracts=(data.contracts??[]).map(row=>{
  const base='/contracts/'+row.id;
  const discounts=(data.discounts??[]).filter(d=>d.contract_id===row.id);
  return line([state(row),format(row.monthly_amount_minor),row.starts_on,row.ends_on].filter(Boolean).join(' · '),[
   row.status==='draft'&&owner?draw(t.approve,base+'/approve'):null,
   row.status==='approved'?draw(t.activate,base+'/activate'):null,
   ['approved','active'].includes(row.status)?[
    draw(t.discount,base+'/discounts',[month(),money('amountMinor',t.amount),reason(t)]),
    draw(t.installment,base+'/installment',[month(),due()]),
   ]:null,
   discounts.map(d=>el('p',{class:'text-sm'},[t.discount,d.period_key,format(d.amount_minor),d.reason].join(' · '))),
  ]);
 });
 const charges=(data.charges??[]).map(row=>{
  const base='/charges/'+row.id;
  const postable=!row.is_reversal;
  return line([row.period_key,state(row),format(row.net_amount_minor)].filter(Boolean).join(' · '),[
   postable&&row.status==='draft'&&owner&&!sameActor(ctx,row.created_by)?draw(t.approve,base+'/approve'):null,
   postable&&row.status==='approved'?draw(t.post,base+'/post'):null,
   postable&&row.status==='posted'?[
    draw(t.reverse,base+'/reverse',[reason(t)]),
    draw(t.credit,'/credit-notes',[money('amountMinor',t.amount),reason(t)],{chargeId:row.id}),
   ]:null,
  ]);
 });
 const notes=(data.creditNotes??[]).map(row=>line([row.period_key,state(row),format(row.amount_minor),row.reason].filter(Boolean).join(' · '),[
  row.status==='draft'&&owner&&!sameActor(ctx,row.requested_by)?draw(t.approve,'/credit-notes/'+row.id+'/approve'):null,
  row.status==='approved'?draw(t.post,'/credit-notes/'+row.id+'/post'):null,
 ]));
 const requests=(data.payments??[]).filter(row=>row.id&&['cash','bank'].includes(row.method)&&
  ['confirmed','partially_refunded'].includes(row.status)).map(row=>line(
  [row.receipt_no,format(row.amount_minor)].filter(Boolean).join(' · '),
  draw(t.refund,'/payments/'+row.id+'/refund',[money('amountMinor',t.amount),reason(t)],{}, {retryKey:true,hint:t.refundHint})));
 const refunds=(data.refunds??[]).map(row=>{
  const base='/refunds/'+row.id;
  return line([row.effective_on,state(row),format(row.amount_minor),row.reason].filter(Boolean).join(' · '),[
   row.status==='requested'&&owner&&!sameActor(ctx,row.authorized_by)?draw(t.approve,base+'/approve'):null,
   row.status==='requested'&&owner?draw(t.reject,base+'/reject',[reason(t)]):null,
   row.status==='approved'&&['cash','bank'].includes(row.method)?draw(t.settle,base+'/settle'):null,
   row.status==='approved'?draw(t.fail,base+'/fail',[reason(t)]):null,
  ]);
 });
 return el('section',{class:'card space-y-4 p-4','data-finance-documents':''},
  rows(t.contracts,contracts), draw(t.contract,'/contracts',[
   money('monthlyAmountMinor',t.fee),field('termMonths',t.term,'number',{min:1,max:120,value:1}),
   field('startsOn',t.from,'date',{value:day}),field('endsOn',t.until,'date',{required:false}),
  ],{studentUserId:studentId},{retryKey:true}),
  rows(t.charge,charges),draw(t.charge,'/charges',[month(),due(),money('grossAmountMinor',t.amount,0)],
   {studentUserId:studentId},{retryKey:true}),
  rows(t.credits,notes), rows(t.refund,[...requests,...refunds]),
  draw(t.recognize,'/revenue/recognize',[month(),money('amountMinor',t.amount),
   field('memo',t.recognitionMemo,'text',{required:false,maxlength:200})],
  {studentUserId:studentId},{retryKey:true}),
  data.sandboxProviderEnabled===true?draw(t.sandbox,'/payments',[
   field('provider',t.provider,'select',{},['click','payme']),
   field('providerTransactionId',t.reference,'text',{maxlength:80}),money('amountMinor',t.amount),
  ],
  {studentUserId:studentId,method:'provider',confirm:false},{hint:t.sandboxHint}):null);
}
