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
 dom=new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>',{url:'https://example.test'+path});
 for(const name of ['window','document','Node','MutationObserver'])globalThis[name]=dom.window[name];
 return {root:document.querySelector('main'),url:new URL(window.location.href),locale:'en',dict,session:{user:{id:'user-1'}},signal:new dom.window.AbortController().signal,navigate(){}};
}
afterEach(()=>{articles.splice(0,articles.length,...originalArticles);api.request=originalRequest;dom?.window.close();});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('five real article cards use the protected article workspace',()=>{
 const context=setup();mountArticles(context);
 assert.deepEqual([...context.root.querySelectorAll('[data-reading-article]')].map(n=>n.dataset.readingArticle),['plastic-bags','advertising','remote-work-wars','unemployment','food-market-growth']);
 assert.equal(context.root.querySelectorAll('[data-reading-article] img').length,5);
 assert.equal(routes.find(route=>route.pattern==='/app/reading/articles/:articleId').layout,'focus');
 assert.deepEqual(returnPolicy(new URL('https://example.test/app/reading/articles/plastic-bags')),{mode:'back',href:'/app/reading/articles'});
});
test('empty catalogue remains explicit',()=>{articles.length=0;const context=setup();mountArticles(context);assert.match(context.root.textContent,/when they are published/);});
for(const article of originalArticles){
 test(`${article.id}: source exercise and dictionary work`,async()=>{
  const html=await readFile(new URL(`../modules/reading/article-assets/${article.id}.html`,import.meta.url),'utf8');
  const page=new JSDOM(html,{url:`https://example.test/article?user=user-1`,runScripts:'dangerously',beforeParse(window){window.matchMedia=()=>({matches:false});window.HTMLElement.prototype.scrollIntoView=function(){};}});
  assert.equal(page.window.document.querySelectorAll('[data-im-question]').length,article.questionCount);
  assert.equal(article.vocabulary.length,12);
  page.window.document.querySelector('#im-dictionary-list').click();
  assert.equal(page.window.document.querySelector('#im-dictionary-panel').hidden,false);
  assert.ok(article.vocabulary.some(w=>w.term.toLowerCase()===page.window.document.querySelector('#im-dict-title').textContent.toLowerCase()));
  page.window.document.querySelector('#im-check-btn').click();
  assert.match(page.window.document.querySelector('#im-score').textContent,new RegExp('0 / '+article.questionCount));
  page.window.close();
 });
 test(`${article.id}: one or all words use the selected folder`,async()=>{
  const context=setup(`/app/reading/articles/${article.id}`),calls=[];
  api.request=async(path,options={})=>{calls.push({path,...options});return path.endsWith('/folders')?{folders:[{id:'folder-1',name:'My folder'}]}:{ok:true,added:1,duplicates:0,needsDefinition:[]};};
  mountArticle(context);document.body.append(context.root);
  const frame=context.root.querySelector('iframe'),doc=frame.contentDocument;
  doc.open();doc.write(`<!doctype html><html><body><div class="im-dict-title-row"><h2 id="im-dict-title">${article.vocabulary[0].term}</h2></div><div id="im-dict-words"></div></body></html>`);doc.close();frame.dispatchEvent(new dom.window.Event('load'));
  doc.querySelector('[data-article-add-word]').click();await tick();
  let dialog=document.querySelector('.reading-article-folder');dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  let save=calls.find(call=>call.method==='POST');assert.equal(save.body.items.length,1);assert.equal(save.body.items[0].term,article.vocabulary[0].term);assert.equal(save.body.folderName,article.title);assert.equal(save.body.folderId,undefined);
  doc.querySelector('[data-article-add-all]').click();await tick();dialog=document.querySelector('.reading-article-folder');dialog.querySelector('select').value='folder-1';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
  save=calls.filter(call=>call.method==='POST')[1];assert.equal(save.body.items.length,12);assert.equal(save.body.folderId,'folder-1');assert.equal(save.body.folderName,undefined);
 });
}
test('existing plastic-bag answers remain available to their owner',async()=>{
 const html=await readFile(new URL('../modules/reading/article-assets/plastic-bags.html',import.meta.url),'utf8');
 const page=new JSDOM(html,{url:'https://example.test/article?user=user-1',runScripts:'dangerously',beforeParse(window){
  window.matchMedia=()=>({matches:false});window.HTMLElement.prototype.scrollIntoView=function(){};
  window.localStorage.setItem('learners-area.article.plastic-bags.v1.user-1',JSON.stringify({answers:{q5:'TRUE'},remainingSeconds:12,isPaused:true}));
 }});
 assert.equal(page.window.document.querySelector('#q5-true').checked,true);
 page.window.close();
});
