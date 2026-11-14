import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {paintedBridge} from '../modules/listening/authored-progressive.js';
import {originalScriptAccessibility} from '../modules/listening/script-v37.js';

const root=new URL('../../../',import.meta.url);
const read=path=>readFileSync(new URL(path,root),'utf8');

test('Listening Script marks only exact local authored occurrences, not every English word',()=>{
  const source=[{part:1,start:7,end:13,surface:'energy',occurrenceId:'example-id',
    definitionEn:'power produced by natural resources',translationUz:'energiya'}];
  const code=originalScriptAccessibility('fixture',source);
  assert.match(code,/linkedOccurrences=/);
  assert.match(code,/sourceRows=linkedOccurrences\.filter/);
  assert.match(code,/dataset\.occurrenceId=row\.occurrenceId/);
  assert.doesNotMatch(code,/const word=\/\[A-Za-z\]/);
  assert.match(code,/savedOccurrences/);
  assert.match(code,/dismiss-word/);
  new Function(code);
});

test('Listening word bridge sends exact occurrence IDs and never uses a spelling-only fallback',()=>{
  const code=paintedBridge('fixture',{},'Notes','storage',null,false,[]);
  assert.match(code,/occurrences\.filter/);
  assert.match(code,/if\(matches\.length!==1\)return;/);
  assert.match(code,/mode:'script',occurrenceId:matches\[0\]\.occurrenceId/);
  assert.doesNotMatch(code,/mode:'script-context'/);
  new Function(code);
});

test('Listening meaning opens the test-local snapshot, displays one sense, and supports dismissal',()=>{
  const authored=read('frontend/vanilla/modules/listening/authored.js');
  const popup=read('frontend/vanilla/modules/vocabulary/contextual-popover.js');
  const projection=read('services/backend/app/step21_listening_authored_reads.py');
  assert.match(authored,/localMeaning:\{term:row\.surface,definitionEn:row\.definitionEn/);
  assert.match(authored,/sourceTitle:content\.testTitle/);
  assert.match(authored,/originalScriptAccessibility\(token,content\.contextualOccurrences\?\?\[\]\)/);
  assert.match(popup,/if\(sourceType==='listening'&&occurrenceId&&localMeaning\?\.definitionEn/);
  assert.match(popup,/document\.addEventListener\('pointerdown',dismiss,true\)/);
  assert.match(popup,/document\.addEventListener\('keydown',dismiss,true\)/);
  assert.match(popup,/alternatives=sourceType==='listening'\?\[\]/);
  assert.match(projection,/entries=content\.get\('contextualMeanings',\[\]\)/);
  assert.match(projection,/name_spans/);
  assert.match(projection,/speaker_labels/);
});

test('Saving a Listening word creates a folder named after the same test',()=>{
  const create=read('services/backend/app/step21_vocabulary_create.py');
  assert.match(create,/if source=='listening' and not folder_id:/);
  assert.match(create,/SELECT title FROM listening_tests WHERE id=\$1/);
  assert.match(create,/INSERT INTO vocab_folders\(user_id,name\)/);
  assert.match(create,/ON CONFLICT\(user_id,name\)/);
  const sql=read('services/backend/migrations/0102_listening_test_local_meanings.sql');
  assert.match(sql,/\{contextualMeanings\}/);
  assert.match(sql,/definitionEn/);
  assert.match(sql,/translationUz/);
  assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)/i);
});
