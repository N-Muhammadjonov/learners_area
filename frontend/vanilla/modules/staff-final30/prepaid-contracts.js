import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';
import {academyLookup} from './academy-groups.js';
import {paymentMoney,paymentDate} from '../payments/format.js';

const API='/api/staff/finance';
const button=(text,props={})=>el('button',{type:'button',class:'btn-secondary',...props},text);
const label=(text,input)=>el('label',{class:'flex flex-col gap-1'},text,input);

export function prepaidContracts(ctx,studentId,day,onSaved){
 const tr=(uz,en)=>ctx.locale==='uz'?uz:en, money=n=>paymentMoney(n,ctx.locale);
 const status=el('p',{role:'status'}),body=el('div',{class:'space-y-3'});
 const root=el('section',{class:'card space-y-3 p-4','data-prepaid-contracts':''},
  el('h3',{class:'font-semibold'},tr('Kun yoki dars uchun paket','Service day or lesson packages')),
  el('p',{},tr('Summani va nechta kun yoki darsga tegishli ekanini o‘zingiz belgilang. Yangi shartni boshqa owner tasdiqlaydi.',
   'Choose the amount and number of days or lessons. A different owner approves the new terms.')),status,body);
 let saving=false;
 function message(error){return ({prepaid_purchases_disabled:tr('Yangi paketlar hozir yopiq.','New packages are disabled.'),
  approver_must_differ_from_drafter:tr('Loyihani boshqa owner tasdiqlashi kerak.','A different owner must approve this draft.'),
  invalid_input:tr('Maydonlarni tekshiring. Har bir kun yoki dars kamida bir so‘m bo‘lishi kerak.','Check the fields. Each unit must cost at least one whole UZS.'),
  service_contract_dates_overlap:tr('Bu kursning faol shartnoma sanalari kesishadi.','Active contract dates overlap for this course.'),
  pause_dates_invalid:tr('Tanaffus kelajakdagi shartnoma sanalarida bo‘lishi kerak.','Pause dates must be future dates within the contract.'),
  service_pause_dates_overlap:tr('Tasdiqlangan tanaffuslar kesishadi.','Approved pauses overlap.')})[error.code]??ctx.dict.common.error;}
 async function run(path,fields){
  if(saving)return;saving=true;status.textContent=ctx.dict.common.saving;
  try{await api.request(API+path,{method:'POST',body:fields,signal:ctx.signal});
   if(!ctx.signal.aborted){status.textContent=ctx.dict.common.saved;await load();await onSaved();}}
  catch(error){if(!ctx.signal.aborted)status.textContent=message(error);}finally{saving=false;}
 }
 function createForm(){
  const course=academyLookup(ctx,tr('Kurs','Course'),async q=>(await api.request('/api/staff/academy/lookups/courses?'+new URLSearchParams({q}),{signal:ctx.signal})).options,false,[]);
  const name=el('input',{class:'input',required:true,maxlength:120});
  const mode=el('select',{class:'input'},el('option',{value:'PREPAID_CALENDAR_DAYS'},tr('Xizmat kunlari','Eligible service days')),el('option',{value:'PREPAID_LESSONS'},tr('Darslar','Lessons')));
  const amount=el('input',{class:'input',name:'priceAmountMinor',type:'number',min:1,max:90071992547409,step:1,required:true});
  const units=el('input',{class:'input',name:'priceUnits',type:'number',min:1,max:3660,step:1,required:true});
  const cap=el('input',{class:'input',type:'number',min:1,max:3660,step:1,value:366,required:true});
  const start=el('input',{class:'input',type:'date',value:day,required:true});
  const end=el('input',{class:'input',type:'date'});
  const excluded=el('textarea',{class:'input',rows:2,placeholder:'YYYY-MM-DD, YYYY-MM-DD'});
  const weekdays=[0,1,2,3,4,5,6].map(n=>el('input',{type:'checkbox',checked:n<5,value:n}));
  const names=ctx.locale==='uz'?['Du','Se','Ch','Pa','Ju','Sh','Ya']:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const form=el('form',{class:'space-y-3','data-service-policy-form':''},
   label(tr('Paket nomi','Package name'),name),course.node,label(tr('Hisoblash turi','Service type'),mode),
   label(tr('Tarif summasi (so‘m)','Tariff amount (UZS)'),amount),label(tr('Shu summaga kun yoki dars soni','Units included in that amount'),units),
   el('p',{class:'text-sm'},tr('Istalgan musbat butun summa. Bo‘linmagan pul qoldiq bo‘lib saqlanadi.','Any positive whole UZS amount. Indivisible cash remains on account.')),
   label(tr('Bir hisobdagi eng ko‘p birlik','Maximum units held at once'),cap),label(tr('Boshlanishi','Starts on'),start),label(tr('Tugashi (ixtiyoriy)','Ends on (optional)'),end),
   el('fieldset',{},el('legend',{},tr('Hisoblanadigan hafta kunlari','Eligible weekdays')),
    ...weekdays.map((input,n)=>el('label',{class:'inline-flex gap-2 mr-3'},input,names[n]))),
   label(tr('Bayram sanalari, vergul bilan ajrating','Excluded dates, separated by commas'),excluded),
   el('p',{class:'text-sm'},tr('Qoldiq pul muddatsiz saqlanadi. Dars faqat jadvalda o‘tilganida bir marta yechiladi. Tasdiqlangan tarif o‘zgarmaydi. Boshqa narx uchun yangi shart yarating.',
    'Residual cash is retained without expiry. A held class consumes one lesson once. Approved terms are immutable. Create new terms for a different price.')),
   button(tr('Paket loyihasini saqlash','Save package draft'),{type:'submit',class:'btn-primary'}));
  let key=crypto.randomUUID(),last='';
  listen(form,'submit',event=>{
   event.preventDefault();if(saving||!form.reportValidity())return;
   if(!course.ids()[0]){status.textContent=tr('Kursni tanlang.','Select a course.');return;}
   const fields={studentUserId:studentId,courseId:course.ids()[0],label:name.value.trim(),mode:mode.value,
    priceAmountMinor:amount.valueAsNumber,priceUnits:units.valueAsNumber,maxUnits:cap.valueAsNumber,
    startsOn:start.value,endsOn:end.value||null,eligibleWeekdays:weekdays.filter(i=>i.checked).map(i=>Number(i.value)),
    excludedDates:excluded.value.split(',').map(v=>v.trim()).filter(Boolean),residualRule:'carry_money_without_expiry',lessonBasis:'held_session_roster'};
   if(JSON.stringify(fields)!==last){last=JSON.stringify(fields);key=crypto.randomUUID();}
   void run('/service-policies',{...fields,id:key});
  },ctx.signal);
  return el('details',{},el('summary',{},tr('Yangi kunlik yoki darslik tarif','New day or lesson tariff')),form);
 }
 function pauseForm(policy,pauses){
  const start=el('input',{class:'input',type:'date',min:day,required:true}),end=el('input',{class:'input',type:'date',min:day,required:true});
  const reason=el('input',{class:'input',minlength:3,maxlength:300,required:true});
  const form=el('form',{class:'space-y-2'},label(tr('Tanaffus boshlanishi','Pause starts'),start),label(tr('Tanaffus tugashi','Pause ends'),end),
   label(tr('Sabab','Reason'),reason),button(tr('Tanaffus loyihasi','Draft pause'),{type:'submit'}));
  let key=crypto.randomUUID();
  listen(form,'input',()=>{key=crypto.randomUUID();},ctx.signal);
  listen(form,'submit',event=>{event.preventDefault();if(form.reportValidity())void run(`/service-policies/${policy.id}/pauses`,{id:key,startsOn:start.value,endsOn:end.value,reason:reason.value});},ctx.signal);
  return el('details',{},el('summary',{},tr('Tanaffuslar','Pauses')),...pauses.map(p=>{
   const approve=button(tr('Tasdiqlash','Approve'));listen(approve,'click',()=>void run(`/service-policies/${policy.id}/pauses/${p.id}/approve`),ctx.signal);
   return el('p',{},`${p.starts_on} – ${p.ends_on} · ${p.reason} · `,p.approved_at?tr('Tasdiqlangan','Approved'):tr('Loyiha','Draft'),
    !p.approved_at&&ctx.session.user.role==='owner'&&p.created_by!==ctx.session.user.id?approve:null);
  }),policy.active?form:null);
 }
 async function load(){
  try{const data=await api.request(`${API}/students/${studentId}/service-policies`,{signal:ctx.signal,fresh:true});if(ctx.signal.aborted)return;
   body.replaceChildren(...data.policies.map(p=>el('article',{class:'card p-3 space-y-2'},el('h4',{},p.label+' · '+p.course),
    el('p',{},`${money(p.priceAmountMinor)} / ${p.priceUnits} ${p.mode==='PREPAID_LESSONS'?tr('dars','lessons'):tr('kun','days')}`),
    el('p',{},`${tr('Qolgan birlik','Remaining units')}: ${p.remainingUnits} · ${tr('Qoldiq','Residual')}: ${money(p.unappliedCreditMinor)}`),
    el('p',{},tr('Holat: ','State: ')+(p.active?tr('Faol','Active'):p.approved?tr('Tasdiqlangan','Approved'):tr('Loyiha','Draft'))),
    p.coveredUntil?el('p',{},tr('Qoplangan sana: ','Covered through: ')+paymentDate(p.coveredUntil,ctx.locale,'—')):null,
    pauseForm(p,(data.pauses??[]).filter(row=>row.policy_id===p.id)))),
    data.purchasesEnabled?createForm():el('p',{},tr('Yangi paketlar hozir yopiq.','New packages are disabled.')));
  }catch(error){if(!ctx.signal.aborted)status.textContent=message(error);}
 }
 void load();return root;
}
