import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

const origin=process.env.ACADEMY_UX_ORIGIN;
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const input=JSON.parse(readFileSync(0,'utf8'));
const directory=resolve('docs/verification/academy-ux/journey');mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const contexts=[],results=[],errors=[];
async function open(role,locale='uz',width=390){
 const context=await browser.newContext({baseURL:origin,viewport:{width,height:width===390?844:900},serviceWorkers:'block'});contexts.push(context);
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addCookies([{name:'la_session',value:input.tokens[role],url:origin,httpOnly:true,sameSite:'Lax'},
  {name:'la_locale',value:locale,url:origin},{name:'la_theme',value:width===390?'night':'day',url:origin}]);
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 return {context,page,locale};
}
const childPath=id=>`/api/guardian/children/${id}/payments`;
async function summary(context,id){const response=await context.request.get(childPath(id));assert.equal(response.status(),200);return response.json();}
async function rpc(method,params){
 const response=await contexts[0].request.post(origin+'/api/payments/callbacks/payme',{
  headers:{authorization:input.providerAuthorization},data:{id:1,method,params}});
 assert.equal(response.status(),200);return response.json();
}
async function settle(intent,reference){
 const created=await rpc('CreateTransaction',{id:reference,time:Date.now(),amount:intent.amountMinor*100,account:{order_id:intent.intentId}});
 assert.equal(created.result.state,1);
 const first=await rpc('PerformTransaction',{id:reference}),duplicate=await rpc('PerformTransaction',{id:reference});
 assert.deepEqual(duplicate,first);assert.equal(first.result.state,2);
}
async function enter(view,amount,studentId,label){
 const {page,locale}=view;
 await page.locator('[data-payment-form]').waitFor();
 if(studentId)await page.locator('#payment-child').selectOption(studentId);
 await page.locator('.pay-account > button').click();
 await page.locator('#payment-amount').fill(String(amount));
 await page.locator('input[name=provider][value=payme]').check();
 await page.locator('[data-payment-form] button[type=submit]').click();
 const review=page.locator('section[aria-label="'+(locale==='uz'?'To‘lovni tekshirish':'Review payment')+'"]');
 await review.waitFor();assert.match(await review.textContent(),new RegExp(label));
 const endpoint=studentId?childPath(studentId)+'/intents':'/api/finance/me/intents';
 const [response]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===endpoint&&r.request().method()==='POST'),
  review.getByRole('button',{name:locale==='uz'?'Provayderga o‘tish':'Continue to provider',exact:true}).click()]);
 assert.equal(response.status(),200);const intent=await response.json();
 assert.equal(intent.amountMinor,amount);assert.equal(intent.environment,'sandbox');assert.equal(intent.status,'created');
 assert.match(intent.merchantCheckoutUrl,/^https:\/\/test\.paycom\.uz\//);
 assert(!intent.fiscalReceiptUrl);assert.equal(intent.acknowledgement,null);
 await page.locator('[data-checkout-link]').waitFor();
 await page.screenshot({path:resolve(directory,`${locale}-${amount}-created.png`)});
 results.push({role:studentId?'guardian':'student',beneficiary:intent.beneficiaryStudentId,amountMinor:amount,
  intentId:intent.intentId,activations:studentId?5:4,activationDefinition:'account action, optional child selection, provider, review, confirm; text entry excluded',created:true});
 return intent;
}
try{
 const guardian=await open('guardian');
 await guardian.page.goto(origin+'/app/payments?child='+input.studentId);
 const first=await enter(guardian,150000,input.studentId,'QA Student');
 assert.equal(first.beneficiaryStudentId,input.studentId);
 await guardian.page.reload();
 assert.equal((await summary(guardian.context,input.studentId)).history.find(r=>r.intentId===first.intentId).status,'created');
 await guardian.page.goto(origin+'/app/payments?child='+input.studentId+'&intent='+first.intentId);
 await guardian.page.locator('[data-payment-status]').waitFor();
 assert.doesNotMatch(await guardian.page.locator('[data-payment-status]').textContent(),/To‘lov tasdiqlandi/);
 await settle(first,'browser-guardian-first');
 await guardian.page.reload();await guardian.page.locator('[data-payment-status] h2').filter({hasText:'To‘lov tasdiqlandi'}).waitFor();
 assert.equal((await summary(guardian.context,input.studentId)).position.balanceDueMinor,650000);
 await guardian.page.screenshot({path:resolve(directory,'guardian-first-paid.png')});
 const second=await enter(guardian,500000,input.secondStudentId,'QA Younger');
 assert.equal(second.beneficiaryStudentId,input.secondStudentId);
 assert.equal((await guardian.context.request.get(childPath(input.secondStudentId)+'/intents/'+first.intentId)).status(),404);
 await settle(second,'browser-guardian-second');
 await guardian.page.goto(origin+'/app/payments?child='+input.secondStudentId+'&intent='+second.intentId);
 await guardian.page.locator('[data-payment-status] h2').filter({hasText:'To‘lov tasdiqlandi'}).waitFor();
 const position=(await summary(guardian.context,input.secondStudentId)).position;
 assert.equal(position.balanceDueMinor,0);assert.equal(position.advanceMinor,200000);
 assert.equal((await summary(guardian.context,input.studentId)).position.balanceDueMinor,650000);
 const guide=guardian.page.locator('[data-page-guide=payments]');await guide.locator(':scope > summary').press('Enter');
 await guide.getByRole('button',{name:'Keyingi',exact:true}).press('Enter');assert.match(await guide.textContent(),/2 \/ 3/);
 await guardian.page.screenshot({path:resolve(directory,'guardian-help-keyboard.png')});
 const student=await open('student','en',1440);await student.page.goto(origin+'/app/payments');
 const third=await enter(student,137531,null,'QA Student');await settle(third,'browser-student-custom');
 await student.page.goto(origin+'/app/payments?intent='+third.intentId);
 await student.page.locator('[data-payment-status] h2').filter({hasText:'Payment confirmed'}).waitFor();
 const own=await (await student.context.request.get('/api/finance/me/payments')).json();
 assert.equal(own.position.balanceDueMinor,512469);assert.equal(own.history.find(r=>r.intentId===third.intentId).fiscalReceiptUrl,null);
 await student.page.screenshot({path:resolve(directory,'student-custom-paid.png')});
 const revoked=await student.context.request.post('/api/guardians/links/'+input.guardianLinkId+'/revoke',{headers:{origin}});
 assert.equal(revoked.status(),200,await revoked.text());
 assert.equal((await guardian.context.request.get(childPath(input.studentId))).status(),403);
 const forbidden=await guardian.context.request.post(childPath(input.studentId)+'/intents',{
  headers:{origin},data:{amountMinor:1,provider:'payme',idempotencyKey:crypto.randomUUID()}});assert.equal(forbidden.status(),403);
 await guardian.page.goto(origin+'/app/payments');await guardian.page.locator('#payment-child').waitFor();
 assert.equal(await guardian.page.locator(`#payment-child option[value="${input.studentId}"]`).count(),0);
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(directory,'receipt.json'),JSON.stringify({sourceCommit:process.env.ACADEMY_UX_SOURCE_SHA??null,
  verificationLevel:'LOCALLY_TESTED',environment:'real Chromium + isolated PostgreSQL + actual FastAPI; synthetic sandbox credentials',
  externalProviderVerified:false,results,duplicateCallbacks:true,multiChildIsolation:true,revocationDenied:true,keyboardGuide:true,errors},null,2)+'\n');
 console.log(JSON.stringify({journeys:results.length,verificationLevel:'LOCALLY_TESTED',externalProviderVerified:false,errors}));
}finally{for(const context of contexts)await context.close();await browser.close();}
