import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {api} from '../js/api-client.js';
import {notificationBell} from '../modules/shell/notifications.js';

let dom,controller,oldRequest,oldInterval,oldClear,scheduled,cleared;
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

beforeEach(()=>{
 dom=new JSDOM('<!doctype html><html><body></body></html>',{
  url:'https://example.invalid/app',pretendToBeVisual:true,
 });
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 globalThis.Node=dom.window.Node;
 controller=new dom.window.AbortController();
 oldRequest=api.request;
 oldInterval=globalThis.setInterval;
 oldClear=globalThis.clearInterval;
 scheduled=null;cleared=false;
 globalThis.setInterval=(fn,delay)=>{scheduled={fn,delay};return 42;};
 globalThis.clearInterval=id=>{if(id===42)cleared=true;};
});
afterEach(()=>{
 controller.abort();
 api.request=oldRequest;
 globalThis.setInterval=oldInterval;
 globalThis.clearInterval=oldClear;
 dom.window.close();
 delete globalThis.window;delete globalThis.document;delete globalThis.Node;
});

test('notification bell polls while visible and refreshes unread counts',async()=>{
 const counts=[1,4,0],calls=[];
 api.request=async(path,options)=>{
  calls.push({path,options});
  return {ok:true,unread:counts.shift()};
 };
 const bell=notificationBell({
  dict:{notifications:{title:'Notifications'},common:{loading:'Loading'}},
  signal:controller.signal,
 });
 document.body.append(bell);
 await tick();
 assert.equal(scheduled.delay,30000);
 assert.equal(calls.length,1);
 assert.equal(bell.querySelector('[data-unread-count]').textContent,'1');
 scheduled.fn();await tick();
 assert.equal(calls.length,2);
 assert.equal(bell.querySelector('[data-unread-count]').textContent,'4');
 scheduled.fn();await tick();
 assert.equal(calls.length,3);
 assert.equal(bell.querySelector('[data-unread-count]'),null);
 assert.match(bell.getAttribute('aria-label'),/\(0\)/);
 controller.abort();
 assert.equal(cleared,true);
});

test('notification requests are only count reads, never a private inbox fetch',async()=>{
 const seen=[];
 api.request=async(path)=>{seen.push(path);return {ok:true,unread:0};};
 const bell=notificationBell({
  dict:{notifications:{title:'Notifications'},common:{loading:'Loading'}},
  signal:controller.signal,
 });
 document.body.append(bell);
 await tick();
 scheduled.fn();
 await tick();
 assert(seen.length>=2);
 assert(seen.every(path=>path==='/api/notifications?count=1'));
});
