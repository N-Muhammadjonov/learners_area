import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LANDING_HTML} from '../modules/landing-inline.js';

const read = relative => readFileSync(new URL(relative,import.meta.url),'utf8');

test('public login eagerly includes the landing document in the same module graph',()=>{
 const source=read('../modules/auth/public.js');
 const routes=read('../js/routes.js');
 assert.match(source,/import \{LANDING_HTML\} from '\.\.\/landing-inline\.js'/);
 assert.match(source,/frame\.srcdoc=LANDING_HTML/);
 assert.match(source,/frame\.setAttribute\('loading','eager'\)/);
 assert.match(routes,/pattern:"\/landing",load:\(\)=>import\('\.\.\/modules\/auth\/public\.js'\)/);
 assert.match(read('../index.html'),/href="\/landing"/);
});

test('landing is public and inline scripts inherit the server nonce',()=>{
 assert.match(read('../../../services/backend/app/frontend_static.py'),/PUBLIC_PAGES\s*=.*'\/landing'/);
 assert.match(read('../modules/auth/public.js'),/script\[nonce\]/);
 assert.match(read('../modules/auth/public.js'),/event\.source!==frame\.contentWindow/);
 assert.match(read('../modules/auth/public.js'),/allowed\.has\(target\.pathname\)/);
});

test('landing links use canonical SPA routes and mouse lighting is exactly 10 percent dimmer',()=>{
 assert.match(LANDING_HTML,/href="\/login"/);
 assert.match(LANDING_HTML,/href="\/register"/);
 assert.doesNotMatch(LANDING_HTML,/https:\/\/learnersarea\.uz\/#\/(?:login|register)/);
 assert.match(LANDING_HTML,/rgba\(76,169,255,\.594\)/);
 assert.match(LANDING_HTML,/rgba\(80,170,255,\.225\)/);
 assert.match(LANDING_HTML,/la:landing:navigate/);
 assert.match(LANDING_HTML,/id="bandJourney"/);
 assert.match(LANDING_HTML,/data-locale="en"/);
 assert.match(LANDING_HTML,/data-locale="uz"/);
});
