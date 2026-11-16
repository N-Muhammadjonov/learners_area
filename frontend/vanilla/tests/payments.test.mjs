import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mount} from '../modules/payments/page.js';
import {ApiError} from '../js/api-client.js';
import {setup,tick,ID} from './staff-final30/harness.mjs';
const account={beneficiaryName:'QA Student',position:{balanceDueMinor:900000,advanceMinor:0,chargedMinor:900000,creditedMinor:0,allocatedMinor:0,refundedMinor:0},nextDueDate:'2026-12-05',asOf:'2026-11-15T08:00:00Z',history:[],pagination:{hasMore:false},providers:['click','payme','uzum'].map(id=>({id,label:id,available:id==='payme',minimumMinor:1,maximumMinor:90071992547409}))};
const intent={intentId:ID(20),beneficiaryName:'QA Student',amountMinor:137531,provider:'payme',status:'created',checkoutState:'ready',merchantCheckoutUrl:'https://checkout.paycom.uz/isolated-fixture'};

const service={id:ID(70),label:'Chosen package',course:'IELTS',mode:'PREPAID_CALENDAR_DAYS',priceAmountMinor:350000,
 priceUnits:12,maxUnits:366,eligibleCapacity:366,consumedUnits:0,unspentMinor:0,remainingUnits:0,unappliedCreditMinor:0,
 balanceDueMinor:0,startsOn:'2026-11-01',endsOn:null,coveredUntil:null,active:true,approved:true,purchasesEnabled:true};

test('configured package amount and units drive review and immutable intent binding',async()=>{
 const h=setup({path:'/app/payments',role:'student'});h.stub({'/api/finance/me/payments':{...account,serviceAccounts:[service]},
  '/api/finance/me/intents':intent,['/api/finance/me/intents/'+intent.intentId]:intent});
 try{
  await mount(h.ctx);h.change(h.q('#payment-service'),service.id);h.input(h.q('#payment-amount'),'350000');
  assert.match(h.q('.pay-account').textContent,/350,000 UZS \/ 12 days/);
  assert.match(h.q('#payment-amount-help').textContent,/12 days/);
  h.submit(h.q('[data-payment-form]'));h.click([...h.ctx.root.querySelectorAll('button')].find(b=>b.textContent==='Continue to provider'));await tick();
  const saved=h.calls.find(c=>c.path==='/api/finance/me/intents'&&c.method==='POST');
  assert.equal(saved.body.amountMinor,350000);assert.equal(saved.body.servicePolicyId,service.id);
 }finally{h.dispose();}
});

test('exact rational projections preserve arbitrary bundle totals and residual cash',async()=>{
 const {projectServicePayment}=await import('../modules/payments/format.js');
 for(const [price,units] of [[200000,7],[350000,12],[137531,19],[31,29]]){
  const p={...service,priceAmountMinor:price,priceUnits:units};
  assert.deepEqual(projectServicePayment(p,price),{units,residual:0,cash:price});
 }
 assert.deepEqual(projectServicePayment({...service,priceAmountMinor:26500,priceUnits:1},200000),{units:7,residual:14500,cash:200000});
 assert.deepEqual(projectServicePayment({...service,priceAmountMinor:200000,priceUnits:7,consumedUnits:1,unspentMinor:171428},0),{units:6,residual:0,cash:171428});
});

test('student custom amount review is explicit and redirect never claims paid',async()=>{
 const h=setup({path:'/app/payments',role:'student'});h.stub({'/api/finance/me/payments':account,'/api/finance/me/intents':intent,['/api/finance/me/intents/'+intent.intentId]:intent});
 try{
  await mount(h.ctx);h.input(h.q('#payment-amount'),'137531');assert.equal(h.q('button[type=submit]').disabled,false);
  h.submit(h.q('[data-payment-form]'));await tick();assert.equal(h.calls.filter(c=>c.method==='POST').length,0);
  h.click(h.qa('button').find(b=>b.textContent==='Continue to provider'));await tick();await tick();
  const calls=h.calls.filter(c=>c.method==='POST');assert.equal(calls.length,1);assert.equal(calls[0].body.amountMinor,137531);
  assert.equal(h.q('[data-checkout-link]').href,intent.merchantCheckoutUrl);assert.match(h.q('[data-payment-status]').textContent,/Order created/);
  assert.doesNotMatch(h.q('[data-payment-status]').textContent,/Payment confirmed/);
 }finally{h.dispose();}
});
test('unavailable providers and invalid money cannot submit',async()=>{
 const h=setup({path:'/app/payments',role:'student'});h.stub({'/api/finance/me/payments':{...account,providers:account.providers.map(p=>({...p,available:false}))}});
 try{await mount(h.ctx);for(const value of ['0','-1','1.5','90071992547410']){h.input(h.q('#payment-amount'),value);assert(h.q('button[type=submit]').disabled);}
  assert.equal(h.qa('input[type=radio]:disabled').length,3);assert.equal(h.qa('[data-checkout-link]').length,0);
 }finally{h.dispose();}
});
test('guardian revocation removes stale financial data',async()=>{
 const h=setup({path:'/app/payments',role:'guardian'}),first=ID(2),second=ID(3);
 h.stub({'/api/guardian/children':{children:[{studentId:first,name:'Child A'},{studentId:second,name:'Child B'}]},['/api/guardian/children/'+first+'/payments']:account,['/api/guardian/children/'+second+'/payments']:new ApiError(403,'forbidden')});
 try{await mount(h.ctx);assert.match(h.ctx.root.textContent,/900/);h.change(h.q('#payment-child'),second);await tick();
  assert.match(h.ctx.root.textContent,/Access to this child is closed/);assert(h.q('[data-payment-form]').hidden);
  assert.equal(h.calls.some(c=>c.path.startsWith('/api/staff/')),false);
 }finally{h.dispose();}
});
test('finance_help_walkthrough_works_keyboard_mobile',async()=>{
 const h=setup({path:'/app/payments',role:'student',locale:'uz'});h.stub({'/api/finance/me/payments':account});
 try{await mount(h.ctx);const guide=h.q('[data-page-guide]');guide.open=true;assert.match(guide.textContent,/1 \/ 3/);
  const next=[...guide.querySelectorAll('button')].find(b=>b.textContent==='Keyingi');next.focus();h.click(next);assert.match(guide.textContent,/2 \/ 3/);
  h.click(next);assert.match(guide.textContent,/3 \/ 3/);assert(next.disabled);h.click([...guide.querySelectorAll('button')].find(b=>b.textContent==='Yopish'));
  assert.equal(guide.open,false);assert.equal(document.activeElement,guide.firstElementChild);assert(h.q('label[for=payment-amount]'));assert(h.q('fieldset legend'));
 }finally{h.dispose();}
});

test('guardian payment assistant rebinds to the selected child and revocation clears its old evidence',async()=>{
 const h=setup({path:'/app/payments',role:'guardian'}),first=ID(2),second=ID(3);h.ctx.session.assistantEnabled=true;
 let revoked=false;
 const proposal=id=>({brand:'RIWI',canExecute:false,observedAt:account.asOf,evidence:[{
  kind:'balance_due',value:id===first?900000:300000,unit:'UZS',sourceHref:'/app/payments?child='+id}]});
 h.stub({'/api/guardian/children':{children:[{studentId:first,name:'Child A'},{studentId:second,name:'Child B'}]},
  ['/api/guardian/children/'+first+'/payments']:()=>revoked?new ApiError(403,'forbidden'):account,
  ['/api/guardian/children/'+second+'/payments']:{...account,beneficiaryName:'Child B'},
  ['/api/guardian/children/'+first+'/assistant']:proposal(first),['/api/guardian/children/'+second+'/assistant']:proposal(second)});
 try{
  await mount(h.ctx);h.click(h.q('[data-academy-ai] button'));await tick();
  assert.equal(h.calls.at(-1).path,'/api/guardian/children/'+first+'/assistant');
  h.change(h.q('#payment-child'),second);await tick();
  assert(!h.q('[data-academy-ai] a'));h.click(h.q('[data-academy-ai] button'));await tick();
  assert.equal(h.calls.at(-1).path,'/api/guardian/children/'+second+'/assistant');
  assert.match(h.q('[data-academy-ai]').textContent,/300,000 UZS/);
  revoked=true;h.change(h.q('#payment-child'),first);await tick();
  assert(!h.q('[data-academy-ai]'));assert(h.q('[data-payment-form]').hidden);
 }finally{h.dispose();}
});

test('Uzbek money and Tashkent dates never use root-locale month names or rounding',async()=>{
 const {paymentMoney,paymentDate}=await import('../modules/payments/format.js');
 assert.equal(paymentMoney(800000,'uz'),'800 000 UZS');
 assert.equal(paymentDate('2026-11-15T19:00:00Z','uz','—'),'16.11.2026, 00:00');
 assert.equal(paymentDate('2026-12-05','uz','—'),'05.12.2026');
 assert.throws(()=>paymentMoney(9007199254740992,'uz'),/invalid_money_projection/);
});
