import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {splitByHighlights} from '../js/generated/lexical-text-helpers.js';
import {phraseTarget} from '../js/generated/reading-lib/phrase-target.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');

test('highlight token splitting preserves blue/yellow/grey and original blue defaults', () => {
  const token={value:'expression',start:0,end:10};
  assert.equal(splitByHighlights(token,[{id:'a',start:0,end:4,color:'yellow'}])[0].color,'yellow');
  assert.equal(splitByHighlights(token,[{id:'b',start:0,end:4,color:'grey'}])[0].color,'grey');
  assert.equal(splitByHighlights(token,[{id:'c',start:0,end:4}])[0].color,'blue');
});

test('the source highlight palette is three colors and applies immediately', () => {
  const clickable=read('modules/vocabulary/clickable-text.js');
  const highlighted=read('modules/reading/lesson-text.js');
  assert.match(clickable, /\['blue','#5ab2ff'/);
  assert.match(clickable, /\['yellow','#ffe080'/);
  assert.match(clickable, /\['grey','#b8c0cc'/);
  assert.match(clickable, /onHighlightRange\(selected\)/);
  assert.match(clickable, /data-highlight-remove/);
  assert.match(clickable, /class:'btn-primary min-h-9 px-3 text-xs'/);
  assert.match(highlighted, /HIGHLIGHT_COLORS/);
  assert.match(highlighted, /color='blue'/);
  assert.match(highlighted, /\.\.\.row,color/);
});

test('HTML passages preserve the same three-color highlighting model', () => {
  const source=read('modules/reading/source-layout.js');
  const session=read('modules/reading/general-session.js');
  assert.match(source, /readingHighlighted\(lexicalContext/);
  assert.match(source, /highlightScope\?\?sourceId/);
  assert.match(session, /occurrences:passage\.occurrences,highlightScope/);
});

test('a contextual multiword expression opens as one span, not a single token', () => {
  const body='Scientists tried to find out what happened.';
  const start=body.indexOf('find out');
  const row={id:'occurrence',startChar:start,endChar:start+8,surfaceForm:'find out'};
  const selected={start,end:start+4,clean:'find'};
  assert.deepEqual(phraseTarget(body,selected,[row]),{word:'find out',occurrence:row});
  const missing=phraseTarget(body,selected,[]);
  assert.equal(missing.word,'find out');
  assert.equal(missing.occurrence,undefined);
});
