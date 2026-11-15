import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {LANDING_MARKUP} from '../modules/landing-markup.js';

const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');

test('portal, globe, sky and dunes remain a single scroll flow',()=>{
 const css=read('../modules/landing-stage.css');
 const runtime=read('../modules/landing-runtime.js');
 assert.match(LANDING_MARKUP,/id="bandJourney"/);
 assert.match(LANDING_MARKUP,/id="introBrandTop"/);
 assert.match(LANDING_MARKUP,/id="introBrandBottom"/);
 assert(LANDING_MARKUP.includes('ROAD TO <strong>IELTS</strong>'));
 assert(LANDING_MARKUP.includes('𝓛𝓮𝓪𝓻𝓷𝓮𝓻𝓼 𝓐𝓻𝓮𝓪'));
 assert(!LANDING_MARKUP.includes('id="introBrandBottom" aria-hidden="true">LEARNERS AREA'));
 assert.match(LANDING_MARKUP,/class="cinematic-hero-flow"/);
 assert.match(LANDING_MARKUP,/id="cinematicGlobeFrame"/);
 assert.match(LANDING_MARKUP,/id="cinematicSky"/);
 assert.match(LANDING_MARKUP,/id="cinematicDunes"/);
 assert.match(runtime,/const globeScale=1\+\.48\*earthApproach/);
 assert.match(runtime,/const skyProgress=smoothstep/);
 assert.match(runtime,/const duneProgress=smoothstep/);
 assert.doesNotMatch(runtime,/cinematicNight|nightProgress|nightLayer|nightImage/);
 assert.doesNotMatch(LANDING_MARKUP,/cinematicNight|night-sky/);
 assert.match(css,/#cinematicBackdrop\{/);
 assert.match(runtime,/onWindow\('scroll',queueJourney/);
 assert.match(runtime,/ResizeObserver/);
 assert.match(css,/\.cinematic-hero-flow/);
 assert.match(css,/\.cinematic-backdrop/);
});

test('cinematic typography, button widths and glass panels are maintained',()=>{
 const css=read('../modules/landing-stage.css');
 const runtime=read('../modules/landing-runtime.js');
 const index=read('../index.html');
 assert(css.includes('body.intro-inverted::after{content:none!important'));
 assert(css.includes('intro-brandline-top'));
 assert(css.includes('intro-brandline-bottom'));
 assert(css.includes('font-size:clamp(30px,4.2vw,66px)'));
 assert(css.includes('background:linear-gradient(108deg,#ffe2a0'));
 assert(LANDING_MARKUP.includes('𝓛𝓮𝓪𝓻𝓷𝓮𝓻𝓼 𝓐𝓻𝓮𝓪'));
 assert(css.includes('font-family:"Apple Symbols","STIX Two Math","Cambria Math",Georgia,serif'));
 assert(css.includes('font-size:clamp(46px,4.65vw,79px)'));
 const landingEntry=read('../modules/landing-page.js');
 assert(!landingEntry.includes('family=Grand+Hotel'));
 assert(css.includes('min-width:295px!important'));
 assert(css.includes('body.intro-inverted #imkon .sh>p:not(.ey){'));
 assert(css.includes('backdrop-filter:blur(20px)'));
 assert(css.includes('body.intro-inverted .reversed-finale .band-story-card{'));
 assert(runtime.includes('const cleanLabel=label.replace'));
 assert(runtime.includes('introBrandTop.style.opacity'));
 assert.doesNotMatch(index,/la-static-landing|data-public-landing-fallback|la-landing-loading/);
});

test('media files are lightweight and not embedded in landing code',()=>{
 const files=[
  ['../brand/landing/earth-horizon-921fe67.webp',125000],
  ['../brand/landing/blue-sky-ee5ef14.webp',25000],
  ['../brand/landing/desert-poster-4516763.webp',60000],
  ['../brand/landing/purple-desert-892507c.mp4',1500000],
 ];
 for(const [file,maxBytes] of files){
  const bytes=statSync(new URL(file,import.meta.url)).size;
  assert(bytes>0&&bytes<maxBytes,file+': '+bytes);
 }
 assert.equal(LANDING_MARKUP.includes('base64,'),false);
});

test('no hidden replacement copy of the deleted HTML remains',()=>{
 const publicPage=read('../index.html');
 const script=read('../modules/landing-page.js');
 assert.doesNotMatch(publicPage,/id="bigBandNumber"|id="bandStory"|id="bandJourney"/);
 assert.doesNotMatch(script,/srcdoc|document\.write|landing-inline\.js/);
 assert.match(publicPage,/<!--public-content-start-->/);
 assert.match(publicPage,/<!--public-content-end-->/);
});

test('scroll lifecycle and preloading handle updates without trapping touch input',()=>{
 const runtime=read('../modules/landing-runtime.js');
 assert.match(runtime,/onWindow\('resize',queueJourney/);
 assert.match(runtime,/onWindow\('pageshow',queueJourney/);
 assert.match(runtime,/signal\.addEventListener\('abort'/);
 assert.match(runtime,/desertVideo\.pause\(\)/);
 assert.match(LANDING_MARKUP,/preload="none"/);
 assert.doesNotMatch(read('../modules/landing-page.js'),/iframe|overflow:\s*hidden/);
});
