import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,tick,ID} from './staff-final30/harness.mjs';
import {sourceDocument} from '../modules/reading/source-layout.js';

test('rich General Reading keeps exact unlinked text without inventing dictionary targets',()=>{
  const h=setup({path:'/app/reading/general/'+ID(2),role:'student'});
  globalThis.DOMParser=h.dom.window.DOMParser;
  try{
    const passage='He offered food to the visitor.';
    const source=sourceDocument('<p>'+passage+'</p>',{
      lexicalContext:h.ctx,sourceId:ID(1),sourceBody:passage
    });
    h.ctx.root.append(source);
    assert.equal(source.querySelector('[data-clickable-text]').textContent,passage);
    const words=[...source.querySelectorAll('.lexical-dotted-word')];
    assert.deepEqual(words.map(x=>x.textContent),[]);
    assert.equal(source.querySelector('[data-word=He]'),null);
    assert.equal(source.querySelector('[data-word=to]'),null);
    assert.equal(source.querySelectorAll('[data-word-popover]').length,0);
  }finally{h.dispose();}
});

test('rich Reading context double-click sends the exact source occurrence',async()=>{
  const h=setup({path:'/app/reading/general/'+ID(2),role:'student'});
  globalThis.DOMParser=h.dom.window.DOMParser;
  const passage='He offered food to the visitor.';
  h.stub({
    '/api/vocabulary/lookup':{status:'resolved',contextual:{
      term:'offer',definitionEn:'to give or present',translationUz:'taklif qilmoq',
      partOfSpeech:'verb',provenance:'dictionary_context',
      dictionary:{lexemeId:ID(3),senseId:ID(4),releaseId:'release'}
    },known:null},
    '/api/vocabulary/folders':{folders:[]}
  });
  try{
    const source=sourceDocument('<p>'+passage+'</p>',{
      lexicalContext:h.ctx,sourceId:ID(1),sourceBody:passage,
      occurrences:[{id:ID(5),startChar:3,endChar:10,surfaceForm:'offered',
        definitionEn:'to give or present',translationUz:'taklif qilmoq',partOfSpeech:'verb'}]
    });
    h.ctx.root.append(source);
    source.querySelector('[data-word=offered]').dispatchEvent(new h.dom.window.MouseEvent('dblclick',{bubbles:true,button:0}));
    await tick(5);
    const call=h.calls.find(x=>x.path.startsWith('/api/vocabulary/lookup'));
    assert(call,'A source occurrence request must be sent');
    const url=new URL(call.path,'https://learnersarea.uz');
    assert.equal(url.searchParams.get('sourceType'),'reading');
    assert.equal(url.searchParams.get('sourceId'),ID(1));
    assert.equal(url.searchParams.get('occurrenceId'),ID(5));
    assert.equal(h.calls.filter(x=>x.path.startsWith('/api/vocabulary/meaning')).length,0);
    assert(h.dom.window.document.querySelector('[data-word-popover]')?.textContent.includes('taklif qilmoq'));
  }finally{h.dispose();}
});

test('a labelled paragraph links every part of a reviewed expression, including its pronoun', async()=>{
  const h=setup({path:'/app/reading/general/'+ID(2),role:'student'});
  globalThis.DOMParser=h.dom.window.DOMParser;
  const phrase='on their own',passage='ATry it '+phrase+'.';
  const occurrence={id:ID(5),startChar:8,endChar:20,surfaceForm:phrase,
    definitionEn:'without other people helping',translationUz:'mustaqil ravishda',partOfSpeech:'idiom'};
  h.stub({'/api/vocabulary/folders':{folders:[]},
    '/api/vocabulary/lookup':{status:'resolved',contextual:{term:phrase},known:null}});
  try{
    const source=sourceDocument('<p><span class="para-letter">A</span>Try it on <em>their</em> own.</p>',{
      lexicalContext:h.ctx,sourceId:ID(1),sourceBody:passage,occurrences:[occurrence]
    });
    h.ctx.root.append(source);
    assert.equal(source.querySelector('[data-word=it]'),null);
    const inside=source.querySelector('em [data-word=their]');
    assert.equal(inside?.dataset.occurrenceId,ID(5));
    inside.dispatchEvent(new h.dom.window.MouseEvent('dblclick',{bubbles:true,button:0}));
    await tick(5);
    const popup=h.dom.window.document.querySelector('[data-word-popover]');
    assert.equal(popup?.getAttribute('aria-label'),phrase);
    assert(popup?.textContent.includes('mustaqil ravishda'));
  }finally{h.dispose();}
});
