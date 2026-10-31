import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mountMockWorkspace, buildMockRouteUrl, navigateMockRoute} from '../modules/mocks/runner.js';

const pageSrc=fs.readFileSync(new URL('../modules/mocks/page.js',import.meta.url),'utf8');
const routerSrc=fs.readFileSync(new URL('../js/router.js',import.meta.url),'utf8');

test('Mock registers inner navigation and history handlers synchronously before any async catalogue request', async () => {
  const c = new AbortController();
  const registered=[];
  const ctx={url:new URL('https://learnersarea.local/app/mocks'),signal:c.signal,
    onNavigate:fn=>registered.push(['navigate',fn]),
    onHistory:fn=>registered.push(['history',fn])};
  const host={querySelector:()=>null,replaceChildren:()=>{}};
  const pending=mountMockWorkspace(ctx,host);
  assert.deepEqual(registered.map(x=>x[0]),['navigate','history']);
  for(const [,handler] of registered) assert.equal(typeof handler,'function');
  assert.equal(registered[0][1](new URL('https://learnersarea.local/app/progress')),false);
  c.abort();await pending;
});

test('Mock page mounts route listener before initiating legacy projection, not from ready() after async delay', () => {
  const m=pageSrc.indexOf('void mountMockWorkspace(context, host);');
  const p=pageSrc.indexOf('const refresh = projection(');
  assert.ok(m!==-1 && p!==-1 && m<p);
  assert.ok(!pageSrc.slice(p).includes('void mountMockWorkspace(context, host);'));
  assert.ok(pageSrc.includes("if (url.searchParams.has('attempt')) return;"));
});

test('Mock deferred old catalogue projection cannot overwrite an active Mock screen',()=>{
  assert.match(pageSrc,/isEnhanced = \(\) =>/);
  assert.match(pageSrc,/!isEnhanced\(\) && !context.url.searchParams.has\('attempt'\)/);
  assert.match(pageSrc,/data-mock-result-summary/);
});

test('Current SPA router installs mount-time hooks, handles same-path query transitions, popstate and refresh lifetimes',()=>{
  assert.match(routerSrc,/onNavigate:handler=>hooks.navigate=handler/);
  assert.match(routerSrc,/onHistory:handler=>\{hooks.history=handler/);
  assert.match(routerSrc,/if\(active.navigate\(url,navigation\)===true\)/);
  assert.match(routerSrc,/sameDocument\?\.\(url,event\)===true/);
  assert.match(routerSrc,/dispose\(active,navigation.refresh\?'route-refresh'/);
});

test('Mock uses current SPA navigate and history-compatible URLs, no manual pushState or popstate listeners',async()=>{
  assert.equal(buildMockRouteUrl('id',false),'/app/mocks?attempt=id');
  assert.equal(buildMockRouteUrl('id',true),'/app/mocks?attempt=id&results=1');
  const calls=[];
  await navigateMockRoute({navigate:(...args)=>calls.push(args)},null,'/app/mocks?attempt=id&results=1');
  assert.deepEqual(calls[0],['/app/mocks?attempt=id&results=1',{}]);
  const src=fs.readFileSync(new URL('../modules/mocks/runner.js',import.meta.url),'utf8');
  assert.ok(!src.includes('history.pushState('));
  assert.ok(!src.includes("window.addEventListener('popstate'"));
});
