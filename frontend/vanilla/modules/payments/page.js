import {api} from '../../js/api-client.js';
import {el,listen} from '../../js/dom.js';
import {paymentText} from './text.js';
import {pageGuide} from '../shared/page-guide.js';

export async function mount(ctx){
 const {root,signal,locale,session}=ctx,t=paymentText(locale),guardian=session.user.role==='guardian';
 if(!document.querySelector('[data-payments-css]'))document.head.append(el('link',{rel:'stylesheet',href:'/modules/payments/style.css','data-payments-css':''}));
 const money=value=>new Intl.NumberFormat(locale==='uz'?'uz-UZ':'en-GB').format(value)+' UZS';
 const date=value=>value?new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',{timeZone:'Asia/Tashkent',dateStyle:'medium',timeStyle:value.includes('T')?'short':undefined}).format(new Date(value.includes('T')?value:value+'T00:00:00+05:00')):t.none;
 const button=(text,attrs={})=>el('button',{type:'button',class:'btn-secondary',...attrs},text);
 const status=el('p',{role:'status','aria-live':'polite'}),account=el('section',{class:'pay-card pay-account','aria-label':t.account});
 const amount=el('input',{id:'payment-amount',inputmode:'numeric',type:'text',pattern:'[0-9]+',maxlength:14,autocomplete:'off',class:'input','aria-describedby':'payment-amount-help',required:true});
 const preview=el('p',{id:'payment-amount-help',class:'pay-muted','aria-live':'polite'});
 const choices=el('fieldset',{class:'pay-providers'},el('legend',{},t.method));
 const presets=el('div',{class:'pay-presets','aria-label':t.suggestions});
 const submit=button(t.review,{type:'submit',class:'btn-primary',disabled:true});
 const form=el('form',{'data-payment-form':'',class:'pay-card'},el('h2',{},t.pay),
  el('label',{for:'payment-amount'},t.amount),amount,presets,preview,choices,submit);
 const review=el('section',{class:'pay-card',hidden:true,tabindex:'-1','aria-label':t.review});
 const paymentStatus=el('section',{class:'pay-card',hidden:true,'data-payment-status':'','aria-live':'polite'});
 const history=el('section',{class:'pay-card','aria-label':t.history});
 const child=el('select',{id:'payment-child',class:'input','aria-label':t.child});
 const childLabel=el('label',{for:'payment-child',hidden:!guardian},t.child,child);
 const header=el('header',{class:'pay-header'},el('div',{},el('p',{class:'pay-eyebrow'},'Learners Area'),
  el('h1',{},guardian?t.parentTitle:t.title),el('p',{class:'pay-muted'},t.purpose)),
  el('a',{href:'/app/progress',class:'btn-secondary'},t.progress));
 const page=el('div',{class:'pay-page','data-route-usable':'payments'},header,childLabel,status,
  el('div',{class:'pay-columns'},account,form),review,paymentStatus,history,
  pageGuide(ctx,{key:'payments',title:t.help,steps:t.steps,example:t.example}),faq());
 root.append(page);
 let studentId=session.user.id,data,provider='',offset=0,filter='',requestNumber=0,key=crypto.randomUUID(),busy=false,pollTimer=0,pollRound=0;
 let activeIntent=null;
 const summaryPath=()=>guardian?`/api/guardian/children/${studentId}/payments`:'/api/finance/me/payments';
 const intentPath=()=>guardian?summaryPath()+'/intents':'/api/finance/me/intents';
 signal.addEventListener('abort',()=>clearTimeout(pollTimer),{once:true});
 function errorText(error){
  return ({forbidden:t.revoked,channel_required:t.channel,membership_unavailable:t.channelRetry,
   provider_unavailable:t.unavailable,provider_temporarily_unavailable:t.delayed,
   provider_minimum:t.limits,provider_maximum:t.limits,idempotency_conflict:t.retryHistory,
   rate_limited:t.rateLimit,intent_not_found:t.intentMissing})[error.code??error.message]??t.error;
 }
 function validAmount(){return /^[1-9][0-9]*$/.test(amount.value)&&Number.isSafeInteger(Number(amount.value))&&Number(amount.value)<=90071992547409;}
 function updatePreview(){
  const selected=data?.providers.find(p=>p.id===provider),value=Number(amount.value);
  const allowed=validAmount()&&selected?.available&&value>=selected.minimumMinor&&value<=selected.maximumMinor;
  submit.disabled=busy||!allowed;
  preview.textContent=!validAmount()?t.amountHelp:!selected?.available?t.chooseMethod:
   !allowed?t.limits+' '+money(selected.minimumMinor)+' – '+money(selected.maximumMinor):
   t.afterDebt+' '+money(Math.max(0,data.position.balanceDueMinor-value))+' · '+t.afterAdvance+' '+money(data.position.advanceMinor+Math.max(0,value-data.position.balanceDueMinor));
 }
 listen(amount,'input',()=>{key=crypto.randomUUID();review.hidden=true;updatePreview();},signal);
 function accountView(){
  const p=data.position;
  account.replaceChildren(el('p',{class:'pay-eyebrow'},t.account),el('h2',{},p.balanceDueMinor?t.due:t.clear),
   el('p',{class:'pay-balance'},money(p.balanceDueMinor)),el('p',{},t.advance+': '+money(p.advanceMinor)),
   el('p',{class:'pay-muted'},t.nextDue+': '+date(data.nextDueDate)),
   el('span',{class:'pay-badge'},t.monthly),el('p',{class:'pay-muted'},t.policy),
   el('details',{},el('summary',{},t.explain),el('dl',{class:'pay-facts'},
    ...[[t.charged,p.chargedMinor],[t.credits,p.creditedMinor],[t.allocated,p.allocatedMinor],[t.refunds,p.refundedMinor]].flatMap(([label,value])=>[el('dt',{},label),el('dd',{},money(value))])),el('p',{},t.advanceExplanation)));
  choices.replaceChildren(el('legend',{},t.method),...data.providers.map(p=>{
   const input=el('input',{type:'radio',name:'provider',value:p.id,disabled:!p.available,checked:provider===p.id});
   listen(input,'change',()=>{provider=p.id;key=crypto.randomUUID();review.hidden=true;updatePreview();},signal);
   return el('label',{class:'pay-provider','data-available':String(p.available)},input,
    el('span',{},el('strong',{},p.label),el('small',{},p.available?(p.environment==='sandbox'?t.sandbox:t.available):t.unavailable)));
  }));
  const values=[100000,200000,300000,500000];
  if(p.balanceDueMinor>0&&!values.includes(p.balanceDueMinor))values.unshift(p.balanceDueMinor);
  presets.replaceChildren(...values.slice(0,5).map(value=>{
   const b=button(money(value));listen(b,'click',()=>{amount.value=String(value);key=crypto.randomUUID();review.hidden=true;updatePreview();amount.focus();},signal);return b;
  }));
  updatePreview();
 }
 function historyView(){
  const select=el('select',{'aria-label':t.filter,class:'input'},...['','created','pending','paid','failed','cancelled','expired'].map(value=>el('option',{value,selected:filter===value},value?t.status[value]:t.all)));
  listen(select,'change',()=>{filter=select.value;offset=0;void load();},signal);
  const rows=el('div',{class:'pay-history'});
  for(const row of data.history){
   const details=el('details',{class:'pay-transaction'},el('summary',{},
    el('span',{},el('strong',{},money(row.amountMinor)),el('small',{},date(row.createdAt)+' · '+(row.providerLabel??row.provider))),
    el('span',{class:'pay-badge','data-status':row.status},t.status[row.status]??t.status.pending)),
    el('dl',{class:'pay-facts'},...[[t.student,row.beneficiaryName],[t.payer,row.payerName??t.none],
      [t.allocated,money(row.allocatedMinor)],[t.advance,money(row.advanceMinor)],[t.refunds,money(row.refundedMinor)]].flatMap(([k,v])=>[el('dt',{},k),el('dd',{},v)])),
    el('p',{class:'pay-muted'},row.acknowledgement?t.internalReceipt+': '+(row.acknowledgement.number??t.recorded):t.noReceipt),
    el('p',{class:'pay-muted'},t.fiscalPending));
   if(row.fiscalReceiptUrl)details.append(el('a',{href:row.fiscalReceiptUrl,rel:'noopener noreferrer',target:'_blank',class:'btn-secondary'},t.fiscalReceipt));
   if(['created','pending'].includes(row.status)&&row.intentId){
    const view=button(t.checkStatus);listen(view,'click',()=>{pollRound=0;void check(row.intentId);},signal);details.append(view);
   }
   rows.append(details);
  }
  if(!data.history.length)rows.append(el('p',{class:'pay-muted'},t.emptyHistory));
  const prev=button(t.previous,{disabled:offset===0}),next=button(t.next,{disabled:!data.pagination.hasMore});
  listen(prev,'click',()=>{offset=Math.max(0,offset-20);void load();},signal);
  listen(next,'click',()=>{offset+=20;void load();},signal);
  history.replaceChildren(el('div',{class:'pay-section-head'},el('h2',{},t.history),select),rows,el('div',{class:'pay-actions'},prev,next));
 }
 async function load(){
  const ticket=++requestNumber;status.textContent=t.loading;
  try{
   const result=await api.request(summaryPath()+'?'+new URLSearchParams({offset,limit:20,...filter?{status:filter}:{}}),{signal,fresh:true});
   if(signal.aborted||ticket!==requestNumber)return;
   data=result;account.hidden=false;form.hidden=false;history.hidden=false;
   if(!provider)provider=data.providers.find(p=>p.available)?.id??'';
   accountView();historyView();status.textContent=t.updated+' '+date(data.asOf);
  }catch(error){
   if(signal.aborted||ticket!==requestNumber)return;
   status.replaceChildren(el('span',{role:'alert'},errorText(error)));
   const retry=button(t.retry);listen(retry,'click',()=>void load(),signal);status.append(retry);
   // Revocation must remove stale child financial data as well as block new requests.
   if([401,403,404].includes(error.status)){account.replaceChildren();history.replaceChildren();form.hidden=true;review.hidden=true;paymentStatus.hidden=true;}
  }
 }
 function showIntent(row){
  activeIntent=row;paymentStatus.hidden=false;
  paymentStatus.replaceChildren(el('h2',{},t.status[row.status]??t.status.pending),
   el('p',{},row.beneficiaryName+' · '+money(row.amountMinor)),
   el('p',{class:'pay-muted'},row.status==='paid'?t.confirmed:['failed','cancelled','expired'].includes(row.status)?t.failed:row.checkoutState==='unknown'?t.registrationUnknown:t.pending));
  if(row.merchantCheckoutUrl){
   const go=el('a',{href:row.merchantCheckoutUrl,class:'btn-primary','data-checkout-link':''},t.continue);
   paymentStatus.append(go);
  }
  const refresh=button(t.checkStatus);listen(refresh,'click',()=>{pollRound=0;void check(row.intentId);},signal);paymentStatus.append(refresh);
 }
 async function check(id){
  clearTimeout(pollTimer);const selectedStudent=studentId;
  try{
   const row=await api.request(intentPath()+'/'+encodeURIComponent(id),{signal,fresh:true});
   if(signal.aborted||selectedStudent!==studentId)return;
   if(row.provider==='uzum'&&['created','pending'].includes(row.status)){
    const verified=await api.request(intentPath()+'/'+encodeURIComponent(id)+'/refresh',{method:'POST',signal});
    if(signal.aborted||selectedStudent!==studentId)return;Object.assign(row,verified);
   }
   showIntent(row);
   if(['created','pending'].includes(row.status)&&pollRound<5&&!document.hidden){
    const delay=[2000,4000,8000,15000,30000][pollRound++];pollTimer=setTimeout(()=>void check(id),delay);
   }else if(row.status==='paid')await load();
  }catch(error){if(!signal.aborted&&selectedStudent===studentId){paymentStatus.hidden=false;paymentStatus.replaceChildren(el('p',{role:'alert'},errorText(error)));}}
 }
 listen(form,'submit',event=>{
  event.preventDefault();if(submit.disabled||!form.reportValidity())return;
  review.hidden=false;
  const confirm=button(t.continue,{class:'btn-primary'}),cancel=button(t.change);
  review.replaceChildren(el('h2',{},t.review),el('p',{},data.beneficiaryName+' · '+money(Number(amount.value))+' · '+data.providers.find(p=>p.id===provider).label),
   el('p',{},t.reviewHelp),el('p',{class:'pay-muted'},preview.textContent),el('div',{class:'pay-actions'},confirm,cancel));
  listen(cancel,'click',()=>{review.hidden=true;amount.focus();},signal);
  listen(confirm,'click',async()=>{
   if(busy)return;busy=true;confirm.disabled=true;submit.disabled=true;
   const selectedStudent=studentId;
   try{
    const row=await api.request(intentPath(),{method:'POST',body:{amountMinor:Number(amount.value),provider,idempotencyKey:key},signal});
    if(signal.aborted||selectedStudent!==studentId)return;
    review.hidden=true;showIntent(row);paymentStatus.tabIndex=-1;paymentStatus.focus();await load();
    pollRound=0;void check(row.intentId);
   }catch(error){if(!signal.aborted){status.textContent=errorText(error);confirm.disabled=false;}}
   finally{busy=false;updatePreview();}
  },signal);
  review.focus();
 },signal);
 function faq(){return el('section',{class:'pay-card'},el('h2',{},t.questions),...t.faq.map(([q,a])=>el('details',{},el('summary',{},q),el('p',{class:'pay-muted'},a))));}
 if(guardian){
  try{
   const result=await api.request('/api/guardian/children',{signal});if(signal.aborted)return;
   if(!result.children.length){account.hidden=form.hidden=history.hidden=true;status.textContent=t.noChildren;return;}
   const requested=ctx.url.searchParams.get('child');studentId=result.children.find(c=>c.studentId===requested)?.studentId??result.children[0].studentId;
   child.replaceChildren(...result.children.map(c=>el('option',{value:c.studentId,selected:c.studentId===studentId},c.name)));
   listen(child,'change',()=>{if(busy){child.value=studentId;return;}studentId=child.value;offset=0;provider='';key=crypto.randomUUID();clearTimeout(pollTimer);activeIntent=null;review.hidden=paymentStatus.hidden=true;account.replaceChildren();history.replaceChildren();void load();},signal);
  }catch(error){if(!signal.aborted){account.hidden=form.hidden=history.hidden=true;status.textContent=errorText(error);}return;}
 }
 await load();
 const returned=ctx.url.searchParams.get('intent');if(returned&&/^[a-f\d-]{36}$/i.test(returned))void check(returned);
}
