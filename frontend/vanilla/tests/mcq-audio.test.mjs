import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mcqAudio} from '../modules/listening/mcq-audio.js';
import {listeningAudio} from '../modules/listening/audio-preload.js';
import {privateScope} from '../js/private-scope.js';

const origin='https://learnersarea.uz',resource='/api/resources/audio/mcq-one.mp3',turn=()=>new Promise(r=>setImmediate(r));
for(const mode of ['ready','denied','abort'])test('MCQ cached download is playable only after fresh access: '+mode,async()=>{
 const dom=new JSDOM('<main><audio data-mcq-audio="q1" data-mcq-at="12"></audio><textarea>own draft</textarea></main>',{url:origin});
 for(const k of ['window','document','Node','location'])globalThis[k]=dom.window[k];
 dom.window.HTMLMediaElement.prototype.load=function(){};dom.window.HTMLMediaElement.prototype.pause=function(){};
 const previous=globalThis.fetch,abort=new AbortController();let bytes=0,grants=0,finish;
 privateScope.setScope('mcq-fixture');
 globalThis.fetch=async(url,init)=>{
  if(String(url).includes('direct=1'))return Response.json({url:resource+'?stream=1'});
  if(String(url).includes('capability=1')){grants++;if(mode==='abort')return new Promise(r=>finish=r);return mode==='denied'?new Response(null,{status:403}):Response.json({expiresAt:Date.now()+120000});}
  bytes++;assert.equal(init.credentials,'same-origin');return new Response(new Uint8Array(8),{headers:{'Content-Type':'audio/mpeg','Content-Length':'8'}});
 };
 const host=document.querySelector('main'),audio=host.querySelector('audio'),textarea=host.querySelector('textarea');
 let media;
 try{
  listeningAudio.warmResources([{url:resource}]);for(let i=0;i<30&&listeningAudio.status(resource).state!=='ready';i++)await turn();assert.equal(bytes,1);
  media=mcqAudio({signal:abort.signal,dict:{common:{retry:'Retry'}}},resource);media.bind(host);textarea.focus();
  for(let i=0;i<30&&(mode==='abort'?!finish:!audio.hasAttribute('src')&&!host.querySelector('button'));i++)await turn();
  if(mode==='abort'){assert(finish);abort.abort();finish(Response.json({expiresAt:Date.now()+120000}));await turn();}
  assert.equal(grants,1);assert.equal(bytes,1);
  if(mode==='ready'){assert.match(audio.getAttribute('src'),/^blob:.*#t=12$/);assert.equal(audio.preload,'auto');assert.equal(document.activeElement,textarea);assert.equal(textarea.value,'own draft');}
  else{assert.equal(audio.hasAttribute('src'),false);if(mode==='denied')assert.equal(host.querySelector('button').textContent,'Retry');}
 }finally{abort.abort();media?.dispose();listeningAudio.clear();privateScope.setScope(null);globalThis.fetch=previous;dom.window.close();delete globalThis.location;}
});
