import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {mount} from '../modules/auth/public.js';

test('the sign-in link exchanges its fragment without email and clears browser history', async()=>{
 const token='a'.repeat(43);
 const dom=new JSDOM('<main></main>',{url:'https://learners.test/login#second-owner='+token});
 const {window}=dom;
 const names=['window','document','Node','localStorage'];
 const prior=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const request=api.request;
 const controller=new AbortController();
 try{
  for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,value:window[name]});
  let finish;
  const destination=new Promise(resolve=>{finish=resolve;});
  const requests=[];
  api.request=async(path,options)=>{
   requests.push({path,method:options.method,body:options.body,hash:window.location.hash});
   return {ok:true};
  };
  await mount({
   url:new URL(window.location.href),
   root:window.document.querySelector('main'),
   signal:controller.signal,
   navigate:(path,options)=>finish({path,options}),
  });
  assert.deepEqual(await destination,{path:'/app/owner-observer',options:{replace:true}});
  assert.deepEqual(requests,[{path:'/api/auth/second-owner/redeem',method:'POST',body:{token},hash:''}]);
  assert.equal(window.location.href,'https://learners.test/login');
  assert.equal(window.document.querySelector('input[type=email]'),null);
 }finally{
  controller.abort();
  api.request=request;
  for(const name of names){
   if(prior[name])Object.defineProperty(globalThis,name,prior[name]);
   else delete globalThis[name];
  }
  window.close();
 }
});
