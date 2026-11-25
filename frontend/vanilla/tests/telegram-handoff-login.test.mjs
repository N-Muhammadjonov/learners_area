import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ApiError} from '../js/api-client.js';
import {mount} from '../modules/auth/public.js';
import {setup,ID} from './staff-final30/harness.mjs';

const intentId=ID(1),browserNonce='a'.repeat(64);
const fragment='#tg-handoff='+intentId+'.'+browserNonce;
const exchange='/api/auth/telegram/intent/exchange';

for(const route of ['/login','/register'])test(route+' exchanges the proof without asking for profile fields',async()=>{
 const h=setup({path:route+fragment});
 h.stub({[exchange]:{success:true,accountStatus:'active',role:'student',onboarded:true}});
 try{
  await mount(h.ctx);
  assert.equal(window.location.hash,'');
  assert.equal(h.q('[name=name], [name=gender]'),null);
  assert.deepEqual(h.calls,[{path:exchange,method:'POST',body:{intentId,browserNonce}}]);
  assert.deepEqual(h.nav,[{path:'/app',replace:true}]);
 }finally{h.dispose();}
});

test('a legacy registration handoff without an account returns to the bot',async()=>{
 const h=setup({path:'/register'+fragment});
 h.stub({[exchange]:new ApiError(400,'full_name_required'),'/api/frontend/public':{version:1,public:{
  auth:{passwordEnabled:false,telegramOnly:true,telegramIntentEnabled:true,telegramConfigured:true,
   googleConfigured:false,botUsername:'LearnersAreaBot'}}}});
 try{
  await mount(h.ctx);
  assert.equal(h.q('form'),null);
  assert.equal(h.q('[data-public-auth] a').getAttribute('href'),'https://t.me/LearnersAreaBot');
  assert.deepEqual(h.nav,[]);
 }finally{h.dispose();}
});
