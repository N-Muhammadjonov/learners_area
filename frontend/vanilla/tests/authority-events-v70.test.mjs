import test from 'node:test';import assert from 'node:assert/strict';
import {setup,tick} from './staff-final30/harness.mjs';
import {watchAuthority} from '../js/authority.js';
import {createPrivateScope} from '../js/private-scope.js';
function fixture(){const h=setup({role:'student'}),scope=createPrivateScope();scope.setScope('student-a');const streams=[],calls=[],nav=[];let state={role:'student',accountStatus:'active'},refresh=0;
 class Events extends window.EventTarget{constructor(){super();streams.push(this);}close(){this.closed=true;}}
 const watch=watchAuthority({user:{role:'student',accountStatus:'active'},expiresAt:Math.floor(Date.now()/1000)+3600,accessEventsEnabled:true},{window,document,scope,signal:h.ctx.signal,EventSource:Events,navigate:path=>nav.push(path),refresh:()=>refresh++,request:async path=>{calls.push(path);if(state instanceof Error)throw state;return state;}});
 return Object.assign(h,{scope,streams,calls,nav,watch,setState:value=>state=value,refreshes:()=>refresh,emit:type=>streams[0].dispatchEvent(new window.Event(type))});}
test('a healthy event channel causes zero auth-state calls for clicks, ordinary pageshow and repeated visibility changes',async()=>{
 const h=fixture();try{h.emit('open');h.emit('ready');for(let i=0;i<20;i++){document.dispatchEvent(new window.Event('visibilitychange'));window.dispatchEvent(new window.Event('pageshow'));document.body.click();}await tick();assert.deepEqual(h.calls,[]);assert.equal(h.scope.scope,'student-a');}finally{h.dispose();}
});
test('a targeted role change checks once, refreshes its workspace and then stops checking',async()=>{
 const h=fixture();try{h.emit('open');h.emit('ready');h.setState({role:'teacher',accountStatus:'active'});h.emit('access-changed');await tick();assert.deepEqual(h.calls,['/api/auth/state']);assert.equal(h.refreshes(),1);for(let i=0;i<8;i++)document.dispatchEvent(new window.Event('visibilitychange'));await tick();assert.equal(h.calls.length,1);}finally{h.dispose();}
});
test('an offline account waits until connectivity returns, then applies its revocation without polling other accounts',async()=>{
 const h=fixture();try{h.emit('open');h.emit('ready');Object.defineProperty(window.navigator,'onLine',{value:false,configurable:true});window.dispatchEvent(new window.Event('offline'));h.emit('error');document.dispatchEvent(new window.Event('visibilitychange'));await tick();assert.equal(h.calls.length,0);h.setState(Object.assign(new Error('revoked'),{status:401}));Object.defineProperty(window.navigator,'onLine',{value:true,configurable:true});window.dispatchEvent(new window.Event('online'));await tick();assert.equal(h.calls.length,1);assert.deepEqual(h.nav,['/login']);assert.equal(h.scope.scope,null);assert(h.streams[0].closed);}finally{h.dispose();}
});
test('the handshake can revoke a previously valid token directly without a separate state round trip',()=>{
 const h=fixture();try{h.emit('open');h.emit('session-revoked');assert.equal(h.calls.length,0);assert.deepEqual(h.nav,['/login']);assert.equal(h.scope.scope,null);}finally{h.dispose();}
});
