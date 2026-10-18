import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.test/app',virtualConsole:new VirtualConsole()});
for(const key of ['window','document','navigator','HTMLElement','Element','Event','MessageEvent'] as const)Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react');
const {act}=React;
const {createRoot}=await import('react-dom/client');
const {AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
const {AccessChangeListener}=await import('../../src/components/interaction/AccessChangeListener');
const {privateResources}=await import('../../src/lib/client/private-resource');
class Events {
 static all:Events[]=[];
 handlers=new Map<string,Set<()=>void>>();
 closed=false;
 constructor(){Events.all.push(this);}
 addEventListener(name:string,fn:()=>void){const values=this.handlers.get(name)??new Set();values.add(fn);this.handlers.set(name,values);}
 removeEventListener(name:string,fn:()=>void){this.handlers.get(name)?.delete(fn);}
 close(){this.closed=true;}
 emit(name:string){for(const fn of this.handlers.get(name)??[])fn();}
}
const Subject=AccessChangeListener as React.ComponentType<{enabled:boolean;role?:'student';expiresAt?:number}>;
async function fixture(check:(context:{stream:Events;requests:()=>number;refreshes:()=>number})=>Promise<void>,expiresAt=Math.floor(Date.now()/1000)+60){
 const oldFetch=globalThis.fetch,oldEvents=globalThis.EventSource;
 let requests=0,refreshes=0;
 Events.all=[];Object.defineProperty(globalThis,'EventSource',{value:Events,configurable:true});
 globalThis.fetch=async()=>{requests++;return Response.json({role:'student',accountStatus:'active',expiresAt});};
 privateResources.setScope('student-fixture');privateResources.set('fixture-private',{private:true});
 const root=createRoot(document.getElementById('root')!);
 const router={push(){},refresh(){refreshes++;},replace(){},back(){},forward(){},prefetch:async()=>{}};
 try{
  await act(async()=>root.render(<AppRouterContext.Provider value={router}><Subject enabled role="student" expiresAt={expiresAt}/></AppRouterContext.Provider>));
  await check({stream:Events.all[0]!,requests:()=>requests,refreshes:()=>refreshes});
 }finally{await act(async()=>root.unmount());globalThis.fetch=oldFetch;Object.defineProperty(globalThis,'EventSource',{value:oldEvents,configurable:true});privateResources.setScope(null);}
}
test('unchanged access event checks authority without rerendering the entire shell',async()=>fixture(async({stream,refreshes})=>{
 await act(async()=>{stream.emit('access-changed');await Promise.resolve();});
 assert.equal(refreshes(),0);
}));
test('wake/online reconciles once without periodic or navigation polling',async()=>fixture(async({requests})=>{
 const before=requests();
 await act(async()=>{window.dispatchEvent(new Event('online'));await Promise.resolve();});
 assert.equal(requests(),before+1);
}));
test('verified session expiry clears private data while a healthy SSE remains open',async()=>fixture(async()=>{
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
 assert.equal(privateResources.scope,null);
},Math.floor(Date.now()/1000)-1));
test('revoked sessions clear private caches and close the active stream',async()=>fixture(async({stream})=>{
 globalThis.fetch=async()=>Response.json({error:'unauthenticated'},{status:401});
 await act(async()=>{stream.emit('access-changed');await Promise.resolve();});
 assert.equal(privateResources.scope,null);assert.equal(privateResources.size(),0);assert.equal(stream.closed,true);
}));
test('an authority change clears same-user cached privilege data before refreshing the shell',async()=>fixture(async({stream,refreshes})=>{
 globalThis.fetch=async()=>Response.json({role:'admin',accountStatus:'active'});
 await act(async()=>{stream.emit('access-changed');await Promise.resolve();});
 assert.equal(privateResources.size(),0);assert.equal(privateResources.scope,'student-fixture');assert.equal(refreshes(),1);
}));
test('a late response from a previous account cannot clear the new account',async()=>fixture(async({stream})=>{
 let finish:((response:Response)=>void)|undefined;
 globalThis.fetch=()=>new Promise<Response>(resolve=>{finish=resolve;});
 await act(async()=>{stream.emit('access-changed');await Promise.resolve();});
 privateResources.setScope('another-account');privateResources.set('other-data',{private:true});
 await act(async()=>{finish!(Response.json({error:'unauthenticated'},{status:401}));await Promise.resolve();});
 assert.equal(privateResources.scope,'another-account');assert.equal(privateResources.size(),1);
}));
test('an access event received during an authority read is reconciled after that read',async()=>fixture(async({stream})=>{
 let finish:((response:Response)=>void)|undefined,requests=0;
 globalThis.fetch=()=>{requests++;return requests===1?new Promise<Response>(resolve=>{finish=resolve;}):Promise.resolve(Response.json({error:'unauthenticated'},{status:401}));};
 await act(async()=>{stream.emit('access-changed');stream.emit('access-changed');await Promise.resolve();});
 assert.equal(requests,1);
 await act(async()=>{finish!(Response.json({role:'student',accountStatus:'active'}));await Promise.resolve();});
 assert.equal(requests,2);assert.equal(privateResources.scope,null);
}));
test('LISTEN unavailability can recover on online without repeated error polling',async()=>fixture(async({stream,requests})=>{
 await act(async()=>{stream.emit('error');stream.emit('error');await Promise.resolve();});
 assert.equal(requests(),1,'one state check per disconnected period');
 await act(async()=>{stream.emit('unavailable');await Promise.resolve();});
 assert.equal(stream.closed,true);
 await act(async()=>{window.dispatchEvent(new Event('online'));await Promise.resolve();});
 assert.equal(Events.all.length,2);
}));
