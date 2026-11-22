import {dismissDailyReward} from './browser-daily-reward.mjs';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';

const origin=process.env.ACADEMY_UX_ORIGIN;
assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
const input=JSON.parse(readFileSync(0,'utf8'));
const directory=resolve('docs/verification/academy-ux/prepaid');mkdirSync(directory,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE||'/usr/bin/chromium',args:['--no-sandbox']});
const contexts=[],errors=[];
async function open(role,width){
 const context=await browser.newContext({baseURL:origin,viewport:{width,height:width===390?844:900},serviceWorkers:'block'});contexts.push(context);
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addCookies([{name:'la_session',value:input.tokens[role],url:origin,httpOnly:true,sameSite:'Lax'},
  {name:'la_locale',value:'en',url:origin},{name:'la_theme',value:width===390?'night':'day',url:origin}]);
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 return {context,page};
}
async function post(view,path,data){const response=await view.context.request.post(path,{headers:{origin},data});assert.equal(response.status(),200,await response.text());return response.json();}
try{
 const admin=await open('admin',1440);
 await admin.page.goto(origin+'/app/management/finance?view=debts');await dismissDailyReward(admin.page);
 await admin.page.locator('[data-finance-debtors] article').filter({hasText:'QA Student'}).getByRole('button',{name:'Open account',exact:true}).click();
 const panel=admin.page.locator('[data-prepaid-contracts]');
 await panel.getByText('New day or lesson tariff',{exact:true}).click();
 const form=panel.locator('[data-service-policy-form]');
 await form.getByLabel('Package name',{exact:true}).fill('Owner configurable tariff');
 const course=form.locator('fieldset').first();
 await course.locator('input[type=search]').fill('QA Prepaid');await course.getByRole('button',{name:'Search',exact:true}).click();
 await course.locator('select option[value="'+input.courseId+'"]').waitFor({state:'attached'});
 await course.locator('select').selectOption(input.courseId);await course.getByRole('button',{name:'Select',exact:true}).click();
 await form.locator('[name=priceAmountMinor]').fill('137531');await form.locator('[name=priceUnits]').fill('19');
 const [created]=await Promise.all([admin.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/staff/finance/service-policies'&&r.request().method()==='POST'),
  form.getByRole('button',{name:'Save package draft',exact:true}).click()]);
 assert.equal(created.status(),200,await created.text());const policy=await created.json();
 assert.equal(policy.price_amount_minor,137531);assert.equal(policy.price_units,19);
 const owner=await open('owner',1440);
 await post(owner,`/api/staff/finance/contracts/${policy.contract_id}/approve`);
 await post(admin,`/api/staff/finance/contracts/${policy.contract_id}/activate`);
 const student=await open('student',390);await student.page.goto(origin+'/app/payments');await dismissDailyReward(student.page);
 await student.page.locator('#payment-service option[value="'+policy.id+'"]').waitFor({state:'attached'});
 await student.page.locator('#payment-service').selectOption(policy.id);
 assert.match(await student.page.locator('.pay-account').textContent(),/137,531 UZS \/ 19 days/);
 await student.page.locator('#payment-amount').fill('137531');
 await student.page.locator('input[name=provider][value=payme]').check();
 assert.match(await student.page.locator('#payment-amount-help').textContent(),/19 days/);
 await student.page.locator('[data-payment-form] button[type=submit]').click();
 const review=student.page.locator('section[aria-label="Review payment"]');
 const [ordered]=await Promise.all([student.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/finance/me/intents'&&r.request().method()==='POST'),
  review.getByRole('button',{name:'Continue to provider',exact:true}).click()]);
 assert.equal(ordered.status(),200);const intent=await ordered.json();assert.equal(intent.servicePolicyId,policy.id);
 const rpc=async(method,params)=>{const response=await student.context.request.post('/api/payments/callbacks/payme',{
  headers:{authorization:input.providerAuthorization},data:{id:1,method,params}});assert.equal(response.status(),200);return response.json();};
 assert.equal((await rpc('CreateTransaction',{id:'prepaid-browser',time:Date.now(),amount:13753100,account:{order_id:intent.intentId}})).result.state,1);
 assert.equal((await rpc('PerformTransaction',{id:'prepaid-browser'})).result.state,2);
 assert.equal((await rpc('PerformTransaction',{id:'prepaid-browser'})).result.state,2);
 await student.page.reload();await dismissDailyReward(student.page);await student.page.locator('#payment-service option[value="'+policy.id+'"]').waitFor({state:'attached'});
 await student.page.locator('#payment-service').selectOption(policy.id);
 await student.page.locator('.pay-account .pay-balance').filter({hasText:'19 days'}).waitFor();
 await student.page.screenshot({path:resolve(directory,'student-configured-paid-mobile-night.png')});
 const summary=await (await student.context.request.get('/api/finance/me/payments')).json();
 const account=summary.serviceAccounts.find(p=>p.id===policy.id);
 assert.equal(account.remainingUnits,19);assert.equal(account.unappliedCreditMinor,0);assert.equal(account.unspentMinor,137531);
 assert.equal(summary.position.balanceDueMinor,462469);
 await admin.page.reload();await dismissDailyReward(admin.page);await admin.page.locator('[data-finance-debtors] article').filter({hasText:'QA Student'}).getByRole('button',{name:'Open account',exact:true}).click();
 await admin.page.locator('[data-prepaid-contracts]').getByText('Owner configurable tariff · QA Prepaid Course',{exact:true}).waitFor();
 await admin.page.locator('[data-prepaid-contracts]').scrollIntoViewIfNeeded();
 await admin.page.screenshot({path:resolve(directory,'admin-configured-tariff-desktop-day.png')});
 assert.deepEqual(errors,[]);
 writeFileSync(resolve(directory,'receipt.json'),JSON.stringify({sourceCommit:process.env.ACADEMY_UX_SOURCE_SHA??null,
  environment:'Chromium + isolated FastAPI/PostgreSQL; synthetic Payme only',externalProviderVerified:false,
  priceAmountMinor:137531,priceUnits:19,remainingUnits:19,residualMinor:0,monthlyDebtUnchanged:462469,
  duplicateCallback:true,adminConfiguredInBrowser:true,ownerApproved:true,errors},null,2)+'\n');
 console.log(JSON.stringify({configuredPrepaidBrowser:'passed',priceAmountMinor:137531,priceUnits:19,errors}));
}finally{for(const context of contexts)await context.close();await browser.close();}
