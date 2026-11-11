import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {articles} from '../modules/reading/articles-data.js';
import {mountArticles,mountArticle} from '../modules/reading/articles.js';
import {api} from '../js/api-client.js';
import {returnPolicy} from '../modules/campus/return-policy.js';
import routes from '../js/routes.js';
import dict from '../js/i18n/en.js';
const originalArticles=[...articles],originalRequest=api.request;
let dom;
function setup(path='/app/reading/articles'){
 dom=new JSDOM('<!doctype html><html data-theme="day"><head></head><body><main></main></body></html>',{url:'https://example.test'+path});
 for(const name of ['window','document','Node','MutationObserver'])globalThis[name]=dom.window[name];
 return {root:document.querySelector('main'),url:new URL(window.location.href),locale:'en',dict,session:{user:{id:'user-1'}},signal:new dom.window.AbortController().signal,navigate(){}};
}
afterEach(()=>{articles.splice(0,articles.length,...originalArticles);api.request=originalRequest;dom?.window.close();});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('31 distinct article cards omit reading duration and use the protected workspace',()=>{
 const context=setup();mountArticles(context);
 assert.equal(context.root.querySelectorAll('[data-reading-article]').length,31);
 assert.equal(new Set(articles.map(x=>x.id)).size,31);
 assert.equal(articles.filter(x=>x.id==='artificial-intelligence').length,1);
 const images=[...context.root.querySelectorAll('.reading-article-image')];
 assert.equal(images.filter(image=>image.getAttribute('loading')==='eager').length,articles.length);
 for(const [index,image] of images.entries())if(articles[index].image.endsWith('.jpg'))assert.match(image.getAttribute('src'),/\.thumb\.webp$/);
 assert.doesNotMatch(context.root.textContent,/min read|daqiqalik/);
 assert.equal(routes.find(route=>route.pattern==='/app/reading/articles/:articleId').layout,'focus');
 assert.deepEqual(returnPolicy(new URL('https://example.test/app/reading/articles/plastic-bags')),{mode:'back',href:'/app/reading/articles'});
});
test('article grid has three compact columns on desktop and one on mobile',async()=>{
 const css=await readFile(new URL('../modules/reading/articles.css',import.meta.url),'utf8');
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/height:clamp\(135px,calc\(\(100dvh - 650px\)\/2\),185px\)/);
 assert.match(css,/@media\(max-width:600px\).*grid-template-columns:minmax\(0,1fr\)/);
});
test('topic, search, level and completion filters combine correctly',async()=>{
 const context=setup();api.request=async()=>({completed:['plastic-bags']});mountArticles(context);await tick();
 const visible=()=>[...context.root.querySelectorAll('[data-reading-article]')].filter(node=>!node.hidden).map(node=>node.dataset.readingArticle);
 const levels=context.root.querySelectorAll('[data-article-level]'),topic=context.root.querySelector('[data-article-topic]'),search=context.root.querySelector('[data-article-search]');
 assert.ok(articles.every(article=>article.level===(article.questionCount===13?'B2':'C1')));
 levels[0].click();assert.ok(visible().every(id=>articles.find(article=>article.id===id).questionCount===13));
 topic.value='Environment';topic.dispatchEvent(new dom.window.Event('change'));assert.deepEqual(visible(),['plastic-bags','air-pollution']);
 search.value='plastic';search.dispatchEvent(new dom.window.Event('input'));assert.deepEqual(visible(),['plastic-bags']);
 context.root.querySelector('[data-article-status="completed"]').click();assert.deepEqual(visible(),['plastic-bags']);
 context.root.querySelector('[data-article-status="not_completed"]').click();assert.deepEqual(visible(),[]);
 assert.equal(context.root.querySelector('.reading-articles-empty').hidden,false);
});
test('article completion is saved only when every question is answered and checked',async()=>{
 const article=originalArticles[0],context=setup(`/app/reading/articles/${article.id}`),calls=[];
 api.request=async(path,options)=>{calls.push({path,options});return {ok:true};};mountArticle(context);
 const frame=context.root.querySelector('iframe'),doc=frame.contentDocument;
 doc.open();doc.write(`<!doctype html><html><body><div><button id="im-check-btn">Check</button></div>${Array.from({length:article.questionCount},(_,i)=>`<button data-im-question="${i+1}" class="im-answered"></button>`).join('')}</body></html>`);doc.close();frame.dispatchEvent(new dom.window.Event('load'));
 const questions=doc.querySelectorAll('[data-im-question]');questions[0].classList.remove('im-answered');doc.getElementById('im-check-btn').click();await tick();assert.equal(calls.length,0);
 questions[0].classList.add('im-answered');doc.getElementById('im-check-btn').click();await tick();assert.equal(calls[0].path,`/api/reading/articles/${article.id}/complete`);assert.equal(calls[0].options.method,'POST');
 assert.equal(calls[0].options.keepalive,true);assert.equal(calls[0].options.signal,undefined);
 doc.getElementById('im-check-btn').click();await tick();assert.equal(calls.length,1);
});
test('completion retries failed saves and survives returning to the catalogue',async()=>{
 const article=originalArticles[0],context=setup(`/app/reading/articles/${article.id}`),controller=new dom.window.AbortController();context.signal=controller.signal;
 let calls=0,finish;
 api.request=async()=>{calls++;if(calls===1)throw Error('offline');return new Promise(resolve=>{finish=resolve;});};mountArticle(context);
 const frame=context.root.querySelector('iframe'),doc=frame.contentDocument;
 doc.open();doc.write(`<!doctype html><html><body><div><button id="im-check-btn">Check</button></div><p id="im-score"></p>${Array.from({length:article.questionCount},(_,i)=>`<button data-im-question="${i+1}" class="im-answered"></button>`).join('')}</body></html>`);doc.close();frame.dispatchEvent(new dom.window.Event('load'));
 const check=doc.getElementById('im-check-btn');check.click();await tick();assert.match(doc.getElementById('im-score').nextElementSibling.textContent,/Could not save/);
 check.click();check.click();assert.equal(calls,2);controller.abort();finish({ok:true});await tick();assert.equal(calls,2);
});
test('empty catalogue remains explicit',()=>{articles.length=0;const context=setup();mountArticles(context);assert.match(context.root.textContent,/when they are published/);});
for(const article of originalArticles){
 test(`${article.id}: exercise, countdown, restart and dictionary work`,async()=>{
  const html=await readFile(new URL(`../modules/reading/article-assets/${article.id}.html`,import.meta.url),'utf8');
  let elapsed=0,clockTick=null;
  const page=new JSDOM(html,{url:'https://example.test/article?user=user-1',runScripts:'dangerously',beforeParse(window){
   window.matchMedia=()=>({matches:false});window.HTMLElement.prototype.scrollIntoView=function(){};
   Object.defineProperty(window.performance,'now',{value:()=>elapsed});
   window.setInterval=callback=>{clockTick=callback;return 10};window.clearInterval=()=>{};
  }});
  const doc=page.window.document;
  assert.equal(doc.querySelectorAll('[data-im-question]').length,article.questionCount);
  assert.equal(doc.querySelector('#im-clock').textContent,'20:00');
  assert.ok(article.vocabulary.length>0);
  doc.querySelector('#im-dictionary-list').click();
  assert.equal(doc.querySelector('#im-dictionary-panel').hidden,false);
  assert.ok(article.vocabulary.some(w=>w.term.toLowerCase()===doc.querySelector('#im-dict-title').textContent.toLowerCase()));
  elapsed=61000;clockTick();assert.equal(doc.querySelector('#im-clock').textContent,'18:59');
  doc.querySelector('#im-pause').click();elapsed=90000;clockTick();assert.equal(doc.querySelector('#im-clock').textContent,'18:59');
  doc.querySelector('#im-pause').click();elapsed=110000;clockTick();assert.equal(doc.querySelector('#im-clock').textContent,'18:39');
  elapsed=1500000;clockTick();assert.equal(doc.querySelector('#im-clock').textContent,'00:00');assert.equal(doc.querySelector('#im-pause').hidden,true);
  doc.querySelector('#im-restart').click();assert.equal(doc.querySelector('#im-clock').textContent,'20:00');assert.equal(doc.querySelector('#im-pause').hidden,false);
  doc.querySelector('#im-check-btn').click();assert.match(doc.querySelector('#im-score').textContent,new RegExp('0 / '+article.questionCount));
  page.window.close();
 });
}

for(const article of originalArticles){
 test(`${article.id}: vocabulary preserves the supplied meanings and destination`,async()=>{
  const context=setup(`/app/reading/articles/${article.id}`),calls=[];
  api.request=async(path,options={})=>{calls.push({path,...options});return path.endsWith('/folders')?{folders:[{id:'folder-1',name:'My folder'}]}:{ok:true,added:1,duplicates:0,needsDefinition:[]};};
  mountArticle(context);document.body.append(context.root);
  const frame=context.root.querySelector('iframe'),doc=frame.contentDocument;
  doc.open();doc.write(`<!doctype html><html><body><div class="im-dict-title-row"><h2 id="im-dict-title">${article.vocabulary[0].term}</h2></div><div id="im-dict-words"></div></body></html>`);doc.close();frame.dispatchEvent(new dom.window.Event('load'));
  doc.querySelector('[data-article-add-word]').click();await tick();
  let dialog=document.querySelector('.reading-article-folder');dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  let save=calls.find(call=>call.method==='POST');assert.equal(save.body.items.length,1);assert.deepEqual(save.body.items[0],article.vocabulary[0]);assert.equal(save.body.folderName,article.title);
  doc.querySelector('[data-article-add-all]').click();await tick();dialog=document.querySelector('.reading-article-folder');dialog.querySelector('select').value='folder-1';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  save=calls.filter(call=>call.method==='POST')[1];assert.deepEqual(save.body.items,article.vocabulary);assert.equal(save.body.folderId,'folder-1');assert.equal(save.body.folderName,undefined);
 });
}
test('day/night theme follows the site and vocabulary saves one or all words',async()=>{
 const article=originalArticles.find(x=>x.id==='dreams'),context=setup(`/app/reading/articles/${article.id}`),calls=[];
 document.documentElement.style.setProperty('--workspace-paper','255 255 255');document.documentElement.style.setProperty('--workspace-ink','16 39 64');
 api.request=async(path,options={})=>{calls.push({path,...options});return path.endsWith('/folders')?{folders:[{id:'folder-1',name:'My folder'}]}:{ok:true,added:1,duplicates:0,needsDefinition:[]};};
 mountArticle(context);document.body.append(context.root);
 const frame=context.root.querySelector('iframe'),doc=frame.contentDocument;
 doc.open();doc.write(`<!doctype html><html data-theme="dark"><body><div class="im-dict-title-row"><h2 id="im-dict-title">${article.vocabulary[0].term}</h2></div><div id="im-dict-words"></div></body></html>`);doc.close();frame.dispatchEvent(new dom.window.Event('load'));
 assert.equal(doc.documentElement.dataset.theme,'light');assert.equal(doc.documentElement.style.getPropertyValue('--bg-main'),'rgb(255 255 255)');
 document.documentElement.style.setProperty('--workspace-paper','26 22 37');document.documentElement.dataset.theme='night';await tick();
 assert.equal(doc.documentElement.dataset.theme,'dark');assert.equal(doc.documentElement.style.getPropertyValue('--bg-main'),'rgb(26 22 37)');
 doc.querySelector('[data-article-add-word]').click();await tick();
 let dialog=document.querySelector('.reading-article-folder');dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
 let save=calls.find(call=>call.method==='POST');assert.equal(save.body.items.length,1);assert.equal(save.body.folderName,article.title);
 doc.querySelector('[data-article-add-all]').click();await tick();dialog=document.querySelector('.reading-article-folder');dialog.querySelector('select').value='folder-1';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
 save=calls.filter(call=>call.method==='POST')[1];assert.equal(save.body.items.length,article.vocabulary.length);assert.equal(save.body.folderId,'folder-1');assert.equal(save.body.folderName,undefined);
});
test('old plastic-bag answers survive but the outdated timer does not',async()=>{
 const html=await readFile(new URL('../modules/reading/article-assets/plastic-bags.html',import.meta.url),'utf8');
 const page=new JSDOM(html,{url:'https://example.test/article?user=user-1',runScripts:'dangerously',beforeParse(window){
  window.matchMedia=()=>({matches:false});window.HTMLElement.prototype.scrollIntoView=function(){};
  window.localStorage.setItem('learners-area.article.plastic-bags.v1.user-1',JSON.stringify({answers:{q5:'TRUE'},remainingSeconds:12,isPaused:true}));
 }});
 assert.equal(page.window.document.querySelector('#q5-true').checked,true);assert.equal(page.window.document.querySelector('#im-clock').textContent,'20:00');
 page.window.close();
});
