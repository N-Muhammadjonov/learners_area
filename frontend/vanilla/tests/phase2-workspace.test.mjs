import test from 'node:test';import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';import {createWorkspace} from '../js/workspace.js';
import {api} from '../js/api-client.js';import {privateScope} from '../js/private-scope.js';
import {fixtureSession} from './fixtures.mjs';
test('opening another authenticated document does not broadcast an account mutation to mounted exams',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://fixture.invalid/app'}),original=api.request,saved=globalThis.BroadcastChannel,messages=[];
 for(const k of ['window','document','Node'])globalThis[k]=dom.window[k];document.cookie='la_locale=en; Path=/';
 globalThis.BroadcastChannel=class{postMessage(m){messages.push(m);}close(){}};
 const workspaces=[createWorkspace(document.querySelector('main')),createWorkspace(document.createElement('main'))];
 try{api.request=async()=>fixtureSession();for(const ws of workspaces)await ws.prepare({url:new URL('https://fixture.invalid/app'),signal:new AbortController().signal});
  assert.deepEqual(messages,[]);assert.equal(privateScope.scope,'isolated-fixture-user');
 }finally{for(const ws of workspaces)ws.destroy();api.request=original;globalThis.BroadcastChannel=saved;privateScope.setScope(null);dom.window.close();}
});
