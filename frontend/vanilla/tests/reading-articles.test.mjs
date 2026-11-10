import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {articles} from '../modules/reading/articles-data.js';
import {mountArticles,mountArticle} from '../modules/reading/articles.js';
import {api} from '../js/api-client.js';
import {sectionIdentity} from '../modules/shell/section-header.js';
import routes from '../js/routes.js';
import dict from '../js/i18n/en.js';
const originalArticles=[...articles],originalRequest=api.request;
let dom;
function setup(path='/app/reading/articles',locale='en'){
 dom=new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>',{url:'https://example.test'+path});
 for(const name of ['window','document','Node'])globalThis[name]=dom.window[name];
 return {root:document.querySelector('main'),url:new URL(window.location.href),locale,dict,session:{user:{id:'user-1'}},signal:new dom.window.AbortController().signal,navigate(){}};
}
afterEach(()=>{articles.splice(0,articles.length,...originalArticles);api.request=originalRequest;dom?.window.close();});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('article catalogue shows the supplied article and protects both routes',()=>{
 const context=setup();mountArticles(context);
 assert.match(context.root.textContent,/plastic bags.*13 questions/s);
 assert.equal(context.root.querySelector('[data-reading-article] a').getAttribute('href'),'/app/reading/articles/plastic-bags');
 for(const path of ['/app/reading/articles','/app/reading/articles/:articleId'])assert.equal(routes.find(route=>route.pattern===path)?.protected,true);
 assert.equal(sectionIdentity(context.url,dict).title,'Articles');
});
test('empty catalogue is explicit',()=>{articles.length=0;const context=setup();mountArticles(context);assert.match(context.root.textContent,/when they are published/);});
test('individual and all word saves choose the correct folder without duplicate requests',async()=>{
 const context=setup('/app/reading/articles/plastic-bags'),calls=[];
 api.request=async(path,options={})=>{calls.push({path,...options});return path.endsWith('/folders')?{folders:[{id:'folder-1',name:'My folder'}]}:{ok:true,added:1,duplicates:0,needsDefinition:[]};};
 mountArticle(context);
 context.root.querySelector('[data-article-add-word]').click();await tick();
 let dialog=document.querySelector('dialog');dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
 let save=calls.find(call=>call.method==='POST');assert.equal(save.body.items.length,1);assert.equal(save.body.folderName,originalArticles[0].title);assert.equal(save.body.folderId,undefined);
 context.root.querySelector('[data-article-add-all]').click();await tick();dialog=document.querySelector('dialog');dialog.querySelector('select').value='folder-1';dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();
 save=calls.filter(call=>call.method==='POST')[1];assert.equal(save.body.items.length,10);assert.equal(save.body.folderId,'folder-1');assert.equal(save.body.folderName,undefined);
 assert.equal(calls.filter(call=>call.method==='POST').length,2);
});
test('article practice preserves the provided questions and answer checking',async()=>{
 const html=await readFile(new URL('../modules/reading/article-assets/plastic-bags.html',import.meta.url),'utf8');
 const page=new JSDOM(html,{url:'https://example.test/article?user=user-1',runScripts:'dangerously',beforeParse(window){window.matchMedia=()=>({matches:false});window.HTMLElement.prototype.scrollIntoView=function(){};}});
 assert.equal(page.window.document.querySelectorAll('[data-im-question]').length,13);
 const q5=page.window.document.querySelector('#q5-true');q5.checked=true;q5.dispatchEvent(new page.window.Event('change',{bubbles:true}));
 page.window.document.querySelector('#im-check-btn').click();
 assert.match(page.window.document.querySelector('#im-score').textContent,/1 \/ 13/);
 page.window.close();
});
