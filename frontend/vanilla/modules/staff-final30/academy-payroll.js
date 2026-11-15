import {api} from '../../js/api-client.js';
import {el, listen} from '../../js/dom.js';
import {anySignal} from '../../js/signals.js';

const API='/api/staff/finance/payroll';

const en={
 title:'Teacher payroll',search:'Search teachers',teacher:'Teacher',period:'Salary month',open:'View payroll',
 fixed:'Monthly rate',session:'Rate per session',hourly:'Hourly rate',revenue:'Revenue share (basis points)',
 starts:'Effective from',ends:'Effective through',rule:'Add compensation terms',rules:'Compensation terms',endRule:'End terms',
 estimate:'Estimate',accrued:'Accrued',paid:'Paid',adjusted:'Adjustments',balance:'Payable balance',
 variable:'Class compensation',share:'Recognized revenue share',pending:'Classes awaiting a held status and complete attendance',
 finalize:'Finalize accrual',confirm:'I have reviewed this accounting action',
 assign:'Assign recognized revenue',sources:'Load eligible revenue',source:'Student and held class',
 noSources:'No eligible unassigned revenue for this month.',moreSources:'More entries become visible as you assign these.',
 payout:'Record confirmed bank payout',adjust:'Post adjustment',amount:'Whole UZS',receipt:'Bank transaction reference',reason:'Reason',
 openEnded:'Open-ended',saved:'Saved',sensitive:'Payroll changed. Reload it and review the latest amounts.',
 unsafe:'Enter a whole number within the supported range.',
 blocked:'Finalize an ended month with an open accounting period and completed class records.',
 period_closed:'The accounting period is closed.',payroll_rule_overlap:'The dates overlap existing terms.',
 payroll_revenue_ineligible:'The journal entry and student attendance do not match this held class.',
 payroll_revenue_already_assigned:'This recognition entry was already assigned.',
 payroll_attendance_incomplete:'Complete the class attendance and review payroll again.',
 payout_exceeds_payable:'The payout exceeds the remaining salary liability.',
 adjustment_below_paid:'The adjustment would reduce salary below the amount already paid.',
 payroll_reference_exists:'This bank reference has already been recorded.',
};
const uz={
 title:'O‘qituvchilar ish haqi',search:'O‘qituvchini qidirish',teacher:'O‘qituvchi',period:'Ish haqi oyi',open:'Hisobni ko‘rish',
 fixed:'Oylik stavka',session:'Har bir dars uchun',hourly:'Soatbay stavka',revenue:'Daromad ulushi (100 = 1%)',
 starts:'Boshlanish sanasi',ends:'Oxirgi amal kuni',rule:'To‘lov shartlarini qo‘shish',rules:'To‘lov shartlari',endRule:'Shart muddatini belgilash',
 estimate:'Hisob-kitob',accrued:'Hisoblangan majburiyat',paid:'To‘langan',adjusted:'Tuzatishlar',balance:'To‘lanadigan qoldiq',
 variable:'Darslar uchun',share:'Tan olingan daromad ulushi',pending:'Holati yoki davomati yakunlanmagan darslar',
 finalize:'Ish haqini tasdiqlash',confirm:'Hisob yozuvini ko‘rib chiqdim',
 assign:'Tan olingan daromadni biriktirish',sources:'Mos daromad yozuvlarini yuklash',source:'O‘quvchi va o‘tilgan dars',
 noSources:'Bu oyda biriktirilishi mumkin bo‘lgan daromad topilmadi.',moreSources:'Biriktirgandan keyin qolgan yozuvlar ko‘rinadi.',
 payout:'Tasdiqlangan bank to‘lovini yozish',adjust:'Tuzatish kiritish',amount:'Butun so‘m',receipt:'Bank tranzaksiyasi raqami',reason:'Sabab',
 openEnded:'Muddatsiz',saved:'Saqlandi',sensitive:'Hisob o‘zgardi. Yangilab, yangi summani tekshiring.',
 unsafe:'Ruxsat etilgan oraliqda butun son kiriting.',
 blocked:'Yakunlash uchun oy tugagan, moliya davri ochiq va dars yozuvlari to‘liq bo‘lishi kerak.',
 period_closed:'Moliya davri yopilgan.',payroll_rule_overlap:'Sanalar mavjud shartga to‘g‘ri kelib qoldi.',
 payroll_revenue_ineligible:'Jurnal yozuvi va o‘quvchi davomati ushbu darsga mos kelmadi.',
 payroll_revenue_already_assigned:'Bu daromad yozuvi avval biriktirilgan.',
 payroll_attendance_incomplete:'Davomatni yakunlang va ish haqini qayta ko‘rib chiqing.',
 payout_exceeds_payable:'To‘lov qolgan ish haqidan katta.',
 adjustment_below_paid:'Tuzatish ish haqini avval to‘langan summadan kamaytiradi.',
 payroll_reference_exists:'Bu bank raqami avval yozilgan.',
};

function field(text,control){
 return el('label',{class:'flex flex-col gap-1 text-sm'},text,control);
}

function input(type,props={}){
 return el('input',{type,class:'input',...props});
}

function button(text,props={}){
 return el('button',{type:'submit',class:'btn-secondary',...props},text);
}

function lastMonth(){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit'}).formatToParts();
 const year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value);
 return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);
}

export function academyPayroll(ctx){
 const t=ctx.locale==='uz'?uz:en;
 const owner=ctx.session?.user?.role==='owner';
 const search=input('search',{maxlength:120}),teacher=el('select',{class:'input',required:true});
 const lookup=el('form',{class:'flex flex-wrap items-end gap-3','data-payroll-lookup':''},
  field(t.search,search),button(t.search));
 const period=input('month',{required:true,value:lastMonth()});
 const query=el('form',{class:'flex flex-wrap items-end gap-3','data-payroll-query':''},
  field(t.teacher,teacher),field(t.period,period),button(t.open));
 const status=el('p',{role:'status'}),body=el('div',{class:'space-y-4'});
 const panel=el('details',{class:'card space-y-3 p-4','data-academy-payroll':''},
  el('summary',{class:'cursor-pointer font-semibold'},t.title),lookup,query,status,body);
 let selection, revision=0;
 const fmt=new Intl.NumberFormat(ctx.locale==='uz'?'uz-UZ':'en-GB');
 const money=value=>/^[-]?\d+$/.test(String(value))?fmt.format(BigInt(value))+' UZS':'—';
 const showError=error=>{
  status.setAttribute('role','alert');
  status.textContent=error instanceof RangeError?t.unsafe:
   t[error?.code]??(error?.code==='payroll_estimate_changed'?t.sensitive:ctx.dict.common.error);
 };
 const message=text=>{status.setAttribute('role','status');status.textContent=text;};
 const invalidate=()=>{
  selection?.abort();
  revision++;
  body.replaceChildren();
  message('');
 };
 async function searchTeachers(){
  const trigger=lookup.querySelector('button');
  if(trigger.disabled)return;
  trigger.disabled=true;
  invalidate();
  teacher.replaceChildren();
  try{
   const params=new URLSearchParams({q:search.value.trim()});
   const data=await api.request(API+'/teachers?'+params,{signal:ctx.signal});
   if(!ctx.signal.aborted)teacher.replaceChildren(...data.options.map(row=>el('option',{value:row.id},row.label)));
  }catch(error){if(!ctx.signal.aborted)showError(error);}
  finally{trigger.disabled=false;}
 }
 listen(lookup,'submit',event=>{event.preventDefault();void searchTeachers();},ctx.signal);
 listen(teacher,'change',invalidate,ctx.signal);
 listen(period,'change',invalidate,ctx.signal);
 listen(query,'submit',event=>{event.preventDefault();if(query.reportValidity())void load();},ctx.signal);
 async function load(notice){
  selection?.abort();
  selection=new AbortController();
  const signal=anySignal([ctx.signal,selection.signal]);
  const scope=++revision;
  const request={teacherUserId:teacher.value,periodKey:period.value};
  body.replaceChildren();
  message(ctx.dict.common.loading);
  try{
   const data=await api.request(API+'?'+new URLSearchParams(request),{signal,fresh:true});
   if(signal.aborted||scope!==revision)return;
   render(data,request,signal);
   message(notice??'');
  }catch(error){if(!signal.aborted&&scope===revision)showError(error);}
 }
 function command(title,controls,path,build,signal,{confirm=false}={}){
  const submit=button(title),check=input('checkbox',{required:confirm});
  const form=el('form',{class:'flex flex-wrap items-end gap-3'},controls,
   confirm?field(t.confirm,check):null,submit);
  let identity, commandId;
  listen(form,'submit',async event=>{
   event.preventDefault();
   if(submit.disabled||signal.aborted||!form.reportValidity())return;
   submit.disabled=true;
   try{
    const content=build(),key=JSON.stringify(content);
    if(content.commandId===null&&key!==identity){
     identity=key;
     commandId=crypto.randomUUID();
    }
    const sent=content.commandId===null?{...content,commandId}:content;
    await api.request(API+path,{signal,method:'POST',body:sent});
    if(!signal.aborted)await load(t.saved);
   }catch(error){if(!signal.aborted)showError(error);}
   finally{submit.disabled=false; }
  },signal);
  return form;
 }
 function render(data,request,signal){
  const summary=data.position??data.estimate;
  const rows=data.position?[
   [t.accrued,summary.accruedMinor],[t.adjusted,summary.adjustmentMinor],
   [t.paid,summary.paidMinor],[t.balance,summary.balanceMinor],
  ]:[[t.estimate,summary.amountMinor],[t.fixed,summary.fixedMinor],
   [t.variable,summary.sessionMinor],[t.share,summary.revenueMinor]];
  body.append(el('dl',{class:'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'},
   rows.map(([label,value])=>el('div',{class:'rounded border border-ink-100 p-3'},el('dt',{},label),el('dd',{},money(value))))));
  if(summary.pendingSessionIds?.length)body.append(el('p',{},t.pending+' · '+summary.pendingSessionIds.length));
  if(summary.events?.length)body.append(el('ul',{class:'space-y-1'},summary.events.map(event=>
   el('li',{},[event.periodKey,event.kind==='payout'?t.paid:t.adjusted,money(event.amountMinor),event.reference].join(' · ')))));
  if(data.rules.length)body.append(el('h3',{class:'font-semibold'},t.rules),el('ul',{class:'space-y-2'},data.rules.map(rule=>{
   const end=input('date',{required:true,min:rule.starts_on,max:rule.ends_on??undefined});
   const terms=[rule.starts_on+' – '+(rule.ends_on??t.openEnded),t.fixed+' '+money(rule.monthly_minor),
    t.session+' '+money(rule.session_minor),t.hourly+' '+money(rule.hourly_minor),rule.revenue_bps/100+'%'].join(' · ');
   return el('li',{},el('p',{},terms),owner?command(t.endRule,[field(t.ends,end)],
    '/rules/'+rule.id+'/end',()=>({endsOn:end.value}),signal,{confirm:true}):null);
  })));
  if(!owner)return;
  if(data.position){
   for(const kind of ['payout','adjustment']){
    const amount=input('number',{step:1,required:true,min:kind==='payout'?1:undefined});
    const reference=input('text',{required:true,maxlength:160});
    body.append(command(kind==='payout'?t.payout:t.adjust,[field(t.amount,amount),
     field(kind==='payout'?t.receipt:t.reason,reference)],'/'+summary.id+'/events',
     ()=>({commandId:null,kind,amountMinor:whole(amount),reference:reference.value.trim()}),signal,{confirm:true}));
   }
  }else{
   if(data.canFinalize&&Number(summary.amountMinor)>0&&!summary.pendingSessionIds.length){
    body.append(command(t.finalize,[],'/finalize',()=>({...request,expectedAmountMinor:whole({value:summary.amountMinor}),
     expectedCalculation:data.calculationHash}),signal,{confirm:true}));
   }else if(!data.canFinalize||summary.pendingSessionIds.length)body.append(el('p',{},t.blocked));
   if(data.rules.some(rule=>rule.revenue_bps))body.append(revenuePicker(request,signal));
  }
  const start=input('date',{required:true}),end=input('date');
  const rates=[t.fixed,t.session,t.hourly,t.revenue].map(label=>[label,input('number',{value:0,min:0,step:1})]);
  body.append(command(t.rule,[field(t.starts,start),field(t.ends,end),...rates.map(args=>field(...args))],'/rules',
   ()=>({commandId:null,teacherUserId:request.teacherUserId,startsOn:start.value,endsOn:end.value||null,
    monthlyMinor:whole(rates[0][1]),sessionMinor:whole(rates[1][1]),hourlyMinor:whole(rates[2][1]),
    revenueBps:Number(whole(rates[3][1]))}),signal,{confirm:true}));
 }
 function revenuePicker(request,signal){
  const loadButton=button(t.sources,{type:'button'}),options=el('div',{class:'space-y-2'});
  listen(loadButton,'click',async()=>{
   if(loadButton.disabled)return;
   loadButton.disabled=true;
   options.replaceChildren(el('p',{role:'status'},ctx.dict.common.loading));
   try{
    const data=await api.request(API+'/revenue?'+new URLSearchParams(request),{signal,fresh:true});
    if(signal.aborted)return;
    const date=new Intl.DateTimeFormat(ctx.locale==='uz'?'uz-UZ':'en-GB',
     {timeZone:'Asia/Tashkent',dateStyle:'short',timeStyle:'short'});
    const select=el('select',{class:'input',required:true},data.options.map((row,index)=>
     el('option',{value:index},[row.group_name,date.format(new Date(row.starts_at)),
      row.student_name,money(row.amount_minor)].join(' · '))));
    if(!data.options.length){options.replaceChildren(el('p',{},t.noSources));return;}
    options.replaceChildren(command(t.assign,[field(t.source,select)],'/revenue',()=>{
     const row=data.options[Number(select.value)];
     return {teacherUserId:request.teacherUserId,sessionId:row.session_id,journalTransactionId:row.transaction_id};
    },signal,{confirm:true}));
    if(data.hasMore)options.append(el('p',{},t.moreSources));
   }catch(error){if(!signal.aborted){options.replaceChildren();showError(error);}}
   finally{loadButton.disabled=false;}
  },signal);
  return el('div',{class:'space-y-2'},loadButton,options);
 }
 return panel;
}

function whole(input){
 const digits=String(input.value||'0');
 if(!/^-?\d{1,19}$/.test(digits))throw new RangeError('Invalid whole-money amount');
 const money=BigInt(digits);
 if(money<-(1n<<63n)||money>=1n<<63n)throw new RangeError('Unsupported whole-money amount');
 return Number.isSafeInteger(Number(money))?Number(money):money.toString();
}
