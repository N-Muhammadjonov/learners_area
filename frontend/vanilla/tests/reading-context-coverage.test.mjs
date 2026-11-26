import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,ID,tick} from './staff-final30/harness.mjs';
import {sourceDocument} from '../modules/reading/source-layout.js';
import {sourceTextRange} from '../modules/reading/source-text.js';
import {readingTokens} from '../modules/vocabulary/text-markup.js';
import {occurrenceSpans} from '../js/generated/reading-lib/occurrence-spans.js';

test('repeated paragraph text requires an exact server-positioned offset',()=>{
 const body='Clan. A clan. Clan.',rows=[{id:ID(2),startChar:14,endChar:18,surfaceForm:'Clan'}];
 assert.deepEqual(occurrenceSpans(body,'Clan.',rows),[]);
 assert.equal(occurrenceSpans(body,'Clan.',rows,14)[0].startChar,0);
 assert.deepEqual(occurrenceSpans(body,'Clan.',rows,1),[]);
});

test('source alignment maps whitespace and labels without shifting English word offsets',()=>{
 const body='They find out a fact.',html='A They  find\n out a fact.';
 const range=sourceTextRange(body,html);
 assert.equal(range.map[html.indexOf('find')],body.indexOf('find'));
 assert.equal(range.map[html.indexOf('out')],body.indexOf('out'));
 assert.equal(range.map[0],null);
 assert.equal(sourceTextRange('A claim. Another claim.','claim.'),null);
});

test('repeated heading aligns only at the next complete canonical paragraph',()=>{
 const body='Introduction.\n\nClan\n\nClan members live together.\n\nChiefdom\n\nChiefdom leaders govern.';
 const first=sourceTextRange(body,'Introduction.');
 const heading=sourceTextRange(body,'Clan',first.end);
 assert.equal(heading.start,body.indexOf('Clan'));
 assert.equal(sourceTextRange(body,'Clan',0),null);
 const preceding=sourceTextRange(body,'Clan members live together.',heading.end);
 assert.equal(sourceTextRange(body,'Chiefdom',preceding.end).start,body.indexOf('Chiefdom'));
 assert.equal(sourceTextRange('Introduction.\n\nClans live here.\n\nClan','Clan',13),null);
});

test('verified Reading keeps curly apostrophes and compound words as full tokens',()=>{
 const words=readingTokens("The scientist’s non-identical twins find out.").filter(row=>row.isWord);
 assert.deepEqual(words.map(row=>row.clean),['The','scientist’s','non-identical','twins','find','out']);
 for(const word of words)assert.equal("The scientist’s non-identical twins find out.".slice(word.start,word.end),word.clean);
});

function fixture(){
 const h=setup({path:'/app/reading/general/'+ID(1),locale:'uz',role:'student'});
 for(const name of ['DOMParser','NodeFilter','Element'])globalThis[name]=h.dom.window[name];
 const body='They find out a fact.',occurrences=[
  {id:ID(2),startChar:5,endChar:13,surfaceForm:'find out',definitionEn:'discover information',translationUz:'bilib olmoq',partOfSpeech:'phrasal verb'},
  {id:ID(3),startChar:14,endChar:15,surfaceForm:'a',definitionEn:'one unspecified thing',translationUz:'bir',partOfSpeech:'article'}
 ];
 h.stub({'/api/vocabulary/source-saved':{savedOccurrences:[]},'/api/vocabulary/lookup':{status:'resolved',contextual:{definitionEn:'wrong catalogue meaning',translationUz:'noto‘g‘ri'},known:null},'/api/vocabulary/folders':{folders:[]},'/api/vocabulary':{ok:true,added:1,ids:[ID(8)]}});
 h.ctx.root.append(sourceDocument('<p>They fi<strong>nd <em>out</em></strong> a fact.</p>',{lexicalContext:h.ctx,sourceId:ID(1),sourceBody:body,occurrences}));
 return h;
}

test('split HTML words and phrases open the exact authored sense and save its occurrence ID',async()=>{
 const h=fixture();try{
  assert.equal(h.qa('[data-word="They"]').length,0);
  assert.equal(h.qa('[data-word="a"]').length,1);
  const pieces=h.qa('[data-word="find"]');assert.equal(pieces.length,2);
  assert.equal(pieces[0].style.cursor,'text');
  pieces[1].dispatchEvent(new h.dom.window.MouseEvent('dblclick',{bubbles:true,button:0}));
  await tick();
  const popup=document.querySelector('[data-word-popover]');
  assert.equal(popup.getAttribute('aria-label'),'find out');
  assert.match(popup.textContent,/bilib olmoq/);
  assert.doesNotMatch(popup.textContent,/wrong catalogue meaning|noto‘g‘ri/);
  assert.equal(document.querySelectorAll('[data-context-alternative]').length,0);
  h.click(popup.querySelector('[data-word-save]'));await tick();
  const save=h.calls.find(call=>call.path==='/api/vocabulary');
  assert.equal(save.body.occurrenceId,ID(2));assert.equal(save.body.sourceId,ID(1));
  assert.equal(h.calls.filter(call=>call.path.startsWith('/api/vocabulary/meaning')).length,0);
  assert(pieces.every(node=>node.dataset.lexicalSaved==='true'));
 }finally{h.dispose();}
});

test('highlight selection crosses inline formatting and retains three unlabeled colors',()=>{
 const h=fixture();try{
  const region=h.q('[data-clickable-text]'),parts=h.qa('[data-token="2"]');
  const first=h.q('[data-word="find"]'),last=h.q('[data-word="out"]');
  const range=document.createRange();range.setStart(first.firstChild,0);range.setEnd(last.firstChild,last.textContent.length);
  window.getSelection().addRange(range);region.dispatchEvent(new h.dom.window.MouseEvent('mouseup',{bubbles:true}));
  const swatches=h.qa('[data-highlight-color-option]');assert.equal(swatches.length,3);
  assert.deepEqual(swatches.map(node=>node.dataset.highlightColorOption),['blue','yellow','grey']);
  assert(swatches.every(node=>node.textContent===''));
  h.click(swatches[1]);
  assert.equal(h.qa('mark').map(node=>node.textContent).join(''),'find out');
  assert(h.qa('mark').every(node=>node.dataset.highlightColor==='yellow'));
  assert(h.q('strong em mark'));
  const marked=h.qa('mark'),selection=document.createRange();selection.setStart(marked[0].firstChild,0);selection.setEnd(marked.at(-1).firstChild,marked.at(-1).textContent.length);
  window.getSelection().addRange(selection);h.q('[data-clickable-text]').dispatchEvent(new h.dom.window.MouseEvent('mouseup',{bubbles:true}));
  assert(h.q('[data-highlight-remove]').className.includes('btn-primary'));
  h.click(h.q('[data-highlight-remove]'));assert.equal(h.qa('mark').length,0);
 }finally{h.dispose();}
});
