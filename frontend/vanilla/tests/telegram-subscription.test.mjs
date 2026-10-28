import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {telegram} from '../modules/auth/telegram.js';
import {api} from '../js/api-client.js';
import dict from '../js/i18n/uz.js';

const original=api.request,auth={telegramConfigured:true,telegramIntentEnabled:true,botUsername:'fixture_bot'};
let dom,controller;
const tick=()=>new Promise(r=>setTimeout(r,0));
function setup(purpose='login',search=''){
 dom=new JSDOM('<main></main>',{url:'https://fixture.invalid/'+purpose+search});
 for(const key of ['window','document','Node'])globalThis[key]=dom.window[key];
 controller=new dom.window.AbortController();window.open=()=>null;
 return {dict,signal:controller.signal,url:new URL(window.location.href),navigate(){}};
}
afterEach(()=>{controller?.abort();api.request=original;dom?.window.close();});

for(const purpose of ['login','register'])test(`${purpose} stays blocked with bot link until membership passes`,async()=>{
 const context=setup(purpose),wake=[],calls=[];let destination;
 context.sleep=()=>new Promise(resolve=>wake.push(resolve));context.navigate=path=>destination=path;
 let subscribed=false;
 api.request=async(path,options)=>{
  calls.push([path,options?.body]);
  if(path==='/api/auth/telegram/intent')return {intentId:'intent',browserNonce:'nonce',token:'token',botUsername:'fixture_bot',purpose};
  if(path.includes('/status?'))return subscribed?{status:'confirmed',expired:false}:{status:'pending',expired:false,gateError:'not_subscribed'};
  return {success:true,onboarded:true,accountStatus:purpose==='register'?'pending':'active',outcome:purpose==='register'?'pending':'session'};
 };
 const view=telegram(context,auth,purpose);document.body.append(view);
 if(purpose==='register'){view.querySelector('input[name=telegramFullName]').value='Test User';view.querySelector('input[value=male]').click();}
 view.querySelector('button').click();await tick();
 assert.equal(view.querySelector('a').href,'https://t.me/fixture_bot?start=token');
 wake.shift()();await tick();
 assert.equal(view.querySelector('[role=alert]').textContent,dict.auth.telegramNotSubscribed);
 assert.equal(destination,undefined);assert.equal(calls.filter(([p])=>p.endsWith('/exchange')).length,0);
 assert.equal(view.querySelector('a').textContent,dict.auth.telegramOpen);
 subscribed=true;wake.shift()();await tick();wake.shift()();await tick();
 assert.equal(destination,purpose==='register'?'/pending':'/app');
 const exchange=calls.find(([p])=>p.endsWith('/exchange'))[1];
 assert.deepEqual(exchange,{intentId:'intent',browserNonce:'nonce',...(purpose==='register'?{name:'Test User',gender:'male'}:{})});
});

test('registration requires first and last name before opening Telegram',async()=>{
 const context=setup('register');let calls=0;api.request=async()=>{calls++;return new Promise(()=>{});};
 const view=telegram(context,auth,'register');document.body.append(view);
 view.querySelector('input').value='Test';view.querySelector('button').click();await tick();
 assert.equal(calls,0);assert.equal(view.querySelector('[role=alert]').textContent,dict.auth.telegramFullNameRequired);
 view.querySelector('input[name=telegramFullName]').value=' Test User ';view.querySelector('input[value=male]').click();view.querySelector('button').click();await tick();
 assert.equal(calls,1);assert.equal(view.querySelector('input').value,'Test User');
 controller.abort();assert.equal(view.childNodes.length,0);
});

test('Telegram-only callback shows the channel instruction',()=>{
 const view=telegram(setup('login','?error=telegram_not_subscribed'),auth,'login');
 assert.equal(view.querySelector('[role=alert]').textContent,dict.auth.telegramNotSubscribed);
});

test('password mode reuses the existing name field without adding another required input',async()=>{
 const context=setup('register');context.state={authDraft:{name:'Test User',gender:'female'}};
 let calls=0;api.request=async()=>{calls++;return new Promise(()=>{});};
 const view=telegram(context,{...auth,passwordEnabled:true},'register');document.body.append(view);
 assert.equal(view.querySelector('input'),null);
 view.querySelector('button').click();await tick();assert.equal(calls,1);
});

test('registration requires a deliberate gender selection',async()=>{
 const context=setup('register');let calls=0;
 api.request=async()=>{calls++;return new Promise(()=>{});};
 const view=telegram(context,auth,'register');document.body.append(view);
 view.querySelector('input[name=telegramFullName]').value='Test User';
 assert.equal(view.querySelector('input[name=telegramGender]:checked'),null);
 assert.deepEqual([...view.querySelectorAll('.gender-segments span')].map(n=>n.textContent),['Erkak','Ayol']);
 view.querySelector('button').click();await tick();
 assert.equal(calls,0);assert.equal(view.querySelector('[role=alert]').textContent,dict.auth.errorGenderRequired);
 assert.equal(view.querySelector('[role=radiogroup]').getAttribute('aria-invalid'),'true');
 view.querySelector('input[value=female]').click();
 assert.equal(view.querySelector('[role=alert]'),null);
 view.querySelector('button').click();await tick();assert.equal(calls,1);
 assert([...view.querySelectorAll('input[name=telegramGender]')].every(n=>n.disabled));
});

for(const gender of ['male','female'])test(`registration sends ${gender} with the confirmed intent`,async()=>{
 const context=setup('register'),bodies=[];context.sleep=async()=>{};
 api.request=async(path,options)=>{
  bodies.push([path,options?.body]);
  if(path==='/api/auth/telegram/intent')return {intentId:'intent',browserNonce:'nonce',token:'token',botUsername:'fixture_bot',purpose:'register'};
  if(path.includes('/status?'))return {status:'confirmed',expired:false};
  return {success:true,onboarded:false,accountStatus:'pending',outcome:'pending'};
 };
 const view=telegram(context,auth,'register');document.body.append(view);
 view.querySelector('input[name=telegramFullName]').value='Test User';
 view.querySelector(`input[value=${gender}]`).click();
 view.querySelector('button').click();await tick();
 assert.deepEqual(bodies.find(([path])=>path.endsWith('/exchange'))[1],{intentId:'intent',browserNonce:'nonce',name:'Test User',gender});
});
