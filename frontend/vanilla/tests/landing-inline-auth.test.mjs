import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {LANDING_HTML} from '../modules/landing-inline.js';

const read = relative => readFileSync(new URL(relative,import.meta.url),'utf8');

test('public login eagerly includes the landing document in the same module graph',()=>{
 const source=read('../modules/auth/public.js');
 const routes=read('../js/routes.js');
 assert.match(source,/import \{LANDING_HTML\} from '\.\.\/landing-inline\.js'/);
 assert.match(source,/frame\.srcdoc=LANDING_HTML/);
 assert.match(source,/frame\.setAttribute\('loading','eager'\)/);
 assert.match(routes,/pattern:"\/landing",load:\(\)=>import\('\.\.\/modules\/auth\/public\.js'\)/);
 assert.match(read('../index.html'),/class="la-static-landing"/);
});

test('landing is public and inline scripts inherit the server nonce',()=>{
 assert.match(read('../../../services/backend/app/frontend_static.py'),/PUBLIC_PAGES\s*=.*'\/landing'/);
 assert.match(read('../modules/auth/public.js'),/script\[nonce\]/);
 assert.match(read('../modules/auth/public.js'),/event\.source!==frame\.contentWindow/);
 assert.match(read('../modules/auth/public.js'),/allowed\.has\(target\.pathname\)/);
});

test('landing routes are canonical and cursor lighting uses teal-green',()=>{
 assert.match(LANDING_HTML,/href="\/login"/);
 assert.match(LANDING_HTML,/href="\/register"/);
 assert.doesNotMatch(LANDING_HTML,/https:\/\/learnersarea\.uz\/#\/(?:login|register)/);
 assert.match(LANDING_HTML,/rgba\(50,222,208,\.5346\)/);
 assert.match(LANDING_HTML,/rgba\(50,222,208,\.2025\)/);
 assert.match(LANDING_HTML,/la:landing:navigate/);
 assert.match(LANDING_HTML,/id="bandJourney"/);
 assert.match(LANDING_HTML,/data-locale="en"/);
 assert.match(LANDING_HTML,/data-locale="uz"/);
});

test('legacy premium landing was removed without changing the current landing',()=>{
 const routes=read('../js/routes.js');
 const manifest=JSON.parse(read('../routes.json'));
 const fsFiles=['../modules/premium-landing.js','../modules/premium-landing.css','../modules/premium-i18n.js'];
 for(const obsolete of fsFiles){
  assert.throws(()=>read(obsolete),{code:'ENOENT'});
 }
 for(const legacy of ['/method','/about','/faq','/contact','/privacy']){
  assert(!manifest.routes.includes(legacy),legacy+' still in build routes');
  assert(!routes.includes('pattern:"'+legacy+'"'),legacy+' still in SPA routes');
 }
 assert(!LANDING_HTML.includes('href="/privacy"'));
 assert(!LANDING_HTML.includes('>Maxfiylik</a>'));
 assert.match(LANDING_HTML,/href="https:\/\/t\.me\/Learnersareaaccessbot"/);
 assert.match(LANDING_HTML,/id="bandJourney"/);
});

test('srcdoc navigation scrolls to local sections and starts the existing quiz without resetting it',()=>{
 const match=LANDING_HTML.match(/<script>\s*(\/\* Embedded SPA bridge:[\s\S]*?)<\/script>/);
 assert(match,'The inline navigation bridge is missing');
 let handler;
 const sections=new Map();
 const messages=[];
 const document={
  baseURI:'https://learnersarea.uz/landing',
  addEventListener:(name,callback)=>{if(name==='click')handler=callback;},
  getElementById:id=>sections.get(id)??null,
 };
 runInNewContext(match[1],{document,window:{parent:{postMessage:x=>messages.push(x)}},URL});
 assert.equal(typeof handler,'function');
 let scrolls=[],starts=0,canStart=true;
 for(const id of ['top','test','imkon','natija','faq']){
  sections.set(id,{
   scrollIntoView:opts=>scrolls.push({id,opts}),
   querySelector:selector=>id==='test'&&selector==='[data-a="start"]'&&canStart?{click:()=>{starts++;}}:null,
  });
  assert(LANDING_HTML.includes('href="#'+id+'"'),'Broken anchor #'+id);
 }
 const click=href=>{
  let prevented=false;
  const link={getAttribute:()=>href,hasAttribute:()=>false,target:''};
  handler({defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,
   target:{closest:()=>link},preventDefault:()=>{prevented=true;}});
  return prevented;
 };
 assert(click('#test'));
 assert.equal(starts,1,'Start CTA should begin the quiz once');
 assert.equal(scrolls.length,0,'Start handler already performs scrolling');
 canStart=false;
 assert(click('#test'),'A running quiz must remain reachable');
 assert.equal(starts,1,'Returning to the running quiz must not restart it');
 assert.deepEqual(scrolls.map(x=>x.id),['test']);
 for(const id of ['imkon','natija','faq','top'])assert(click('#'+id),id+' was not intercepted');
 assert.deepEqual(scrolls.map(x=>x.id),['test','imkon','natija','faq','top']);
 assert(scrolls.every(x=>x.opts.behavior==='smooth'&&x.opts.block==='start'));
 assert.equal(click('#unknown'),false,'Unknown fragments should not be captured');
 assert.equal(messages.length,0,'Local fragments must not trigger SPA navigation');
});

test('site root uses the shared landing, while login and registration keep their SPA routes',()=>{
 const source=read('../modules/auth/public.js');
 const routes=read('../js/routes.js');
 assert.match(source,/context\.url\.pathname==='\/'\|\|context\.url\.pathname==='\/landing'/);
 assert.match(source,/href:register\?'\/login':'\/register'/);
 for(const route of ['/','/landing','/login','/register']){
  assert(routes.includes('pattern:"'+route+'",load:()=>import(\'../modules/auth/public.js\')'),'Missing shared public route: '+route);
 }
 assert.match(LANDING_HTML,/<a class="hn" href="\/register">/);
 assert.match(LANDING_HTML,/@media\(min-width:861px\)\{\.hero h1 \.rot\{display:block\}\}/);
 assert.match(LANDING_HTML,/\.rot\.o\{opacity:0;transform:translateY\(\.25em\);filter:blur\(8px\)\}/);
});

test('server-rendered public first paint shows landing, not login',()=>{
 const initial=read('../index.html');
 const firstPaint=initial.split('<!--public-content-start-->')[1]?.split('<!--public-content-end-->')[0];
 assert(firstPaint,'Missing static public fallback');
 assert.match(firstPaint,/class="la-static-landing"/);
 assert.match(firstPaint,/Darajangizni aniqlang/);
 assert.match(firstPaint,/Birinchi marta keldingizmi\?/);
 assert.match(firstPaint,/href="\/register"/);
 assert.doesNotMatch(firstPaint,/la-static-login|Telegram orqali davom etish|Xush kelibsiz/);
});

test('9.0 reveal uses bounded zoom and recalculates on page resume',()=>{
 assert.match(LANDING_HTML,/const zoom=1\+5\.5\*Math\.pow/);
 assert.doesNotMatch(LANDING_HTML,/const zoom=1\+15\*Math\.pow/);
 assert.doesNotMatch(LANDING_HTML,/pointer-events:none;will-change:transform;display:flex/);
 assert.match(LANDING_HTML,/addEventListener\('pageshow',queueJourney\)/);
 assert.match(LANDING_HTML,/visibilitychange',\(\)=>\{if\(!document\.hidden\)queueJourney\(\)\}/);
 assert.match(LANDING_HTML,/story\.inert=p<=\.64/);
 assert.match(LANDING_HTML,/id="bandStory"/);
});
