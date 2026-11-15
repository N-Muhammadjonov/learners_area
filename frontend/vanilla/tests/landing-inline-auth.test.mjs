import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {LANDING_MARKUP} from '../modules/landing-markup.js';

const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');

test('public landing is native SPA DOM, not nested srcdoc or old HTML',()=>{
 const publicAuth=read('../modules/auth/public.js');
 const entry=read('../modules/landing-page.js');
 const index=read('../index.html');
 const routes=read('../js/routes.js');
 assert.match(publicAuth,/await import\('\.\.\/landing-page\.js'\)/);
 assert.doesNotMatch(publicAuth,/srcdoc|landing-inline\.js|landing-next-level\.m4a|entranceAudio/);
 assert.match(entry,/initializeLanding/);
 assert.match(entry,/LANDING_MARKUP/);
 assert.doesNotMatch(entry,/iframe/);
 assert(!existsSync(new URL('../modules/landing-inline.js',import.meta.url)));
 assert.doesNotMatch(index,/data-public-landing-fallback|la-landing-loading|la-landing-first-paint/);
 assert(index.includes('<div id="root"><!--public-content-start--><!--public-content-end--></div>'));
 assert.doesNotMatch(index,/id="bandJourney"/);
 for(const route of ['/','/landing','/login','/register'])
  assert(routes.includes('pattern:"'+route+'",load:()=>import(\'../modules/auth/public.js\')'));
});

test('new landing retains the actual quiz and responsive navigation',()=>{
 const css=read('../modules/landing-stage.css');
 assert.match(LANDING_MARKUP,/id="bandJourney"/);
 assert.match(LANDING_MARKUP,/id="bigBandNumber"/);
 assert.match(LANDING_MARKUP,/id="cinematicBackdrop"/);
 assert.match(LANDING_MARKUP,/id="cinematicDesertVideo"/);
 assert.doesNotMatch(LANDING_MARKUP,/cinematicNight|night-sky/);
 for(const href of ['/login','/register','#test','#imkon'])
  assert(LANDING_MARKUP.includes('href="'+href+'"'));
 assert.match(css,/nav \.nv>a\[href="\/login"\]/);
 assert.match(css,/@media\(max-width:440px\)/);
 assert.match(css,/\.stage\{/);
});

test('no embedded media and all four assets are separately cacheable',()=>{
 const files=[
  '../brand/landing/earth-horizon-921fe67.webp',
  '../brand/landing/blue-sky-ee5ef14.webp',
  '../brand/landing/desert-poster-4516763.webp',
  '../brand/landing/purple-desert-892507c.mp4',
 ];
 for(const file of files){
  assert(existsSync(new URL(file,import.meta.url)),'Missing '+file);
  const extension=file.split('.').pop();
  assert(LANDING_MARKUP.includes('/brand/landing/'+file.split('/').pop()));
  assert(extension==='webp'||extension==='mp4');
 }
 assert.doesNotMatch(LANDING_MARKUP,/data:(?:image|video)\//);
});

test('landing runtime navigates using existing router and releases event listeners',()=>{
 const src=read('../modules/landing-runtime.js');
 assert.match(src,/navigate\(REGISTER\)/);
 assert.match(src,/navigate\(href\)/);
 assert.match(src,/signal\.addEventListener\('abort'/);
 assert.match(src,/clearInterval\(id\)/);
 assert.match(src,/observer\.disconnect\(\)/);
 assert.match(src,/ResizeObserver/);
 assert.doesNotMatch(src,/window\.parent\.postMessage|document\.write\(/);
});

test('original landing entrance audio is removed, quiz audio remains available',()=>{
 const publicAuth=read('../modules/auth/public.js');
 assert.doesNotMatch(publicAuth,/landing-next-level|createElement\('audio'\)/);
 const runtime=read('../modules/landing-runtime.js');
 assert.match(runtime,/laPublicAudio/);
 assert.match(runtime,/desertVideo\.play\(\)/);
});
