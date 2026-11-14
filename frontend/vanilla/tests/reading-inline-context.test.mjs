import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('General Reading supplies exact source meanings to its word renderer', () => {
 const session = source('modules/reading/general-session.js');
 const text = source('modules/reading/lesson-text.js');
 const html = source('modules/reading/source-layout.js');
 assert.match(session, /verifiedOnly:true/);
 assert.match(session, /occurrences:passage\.occurrences/);
 assert.match(text, /verifiedOnly/);
 assert.match(html, /verifiedOnly:true/);
 assert.match(html, /occurrences:occurrences\.filter/);
});

test('unlinked words do not open dictionary searches in General Reading', () => {
 const text = source('modules/vocabulary/clickable-text.js');
 assert.match(text, /verifiedOnly&&phraseTarget/);
 assert.match(text, /verifiedOnly\|\|phraseTarget/);
 assert.match(text, /if\(verifiedOnly&&!occurrence\)return/);
 assert.match(text, /inlineContext:verifiedOnly/);
});

test('Reading uses its one authored inline meaning, not dictionary alternatives', () => {
 const popup = source('modules/vocabulary/contextual-popover.js');
 assert.match(popup, /sourceType==='reading'&&occurrenceIdIsValid/);
 assert.match(popup, /contextual=inlineContext/);
 assert.match(popup, /if\(!inlineContext\)alternatives=/);
 assert.match(popup, /if\(!inlineContext&&data\?\.status==='unresolved'\)/);
});

test('Reading folder defaults to the authenticated source passage title', () => {
 const backend = readFileSync(new URL('../../../services/backend/app/step21_vocab_batch.py', import.meta.url),'utf8');
 assert.match(backend, /if source_type == 'reading':/);
 assert.match(backend, /SELECT title FROM reading_passages WHERE id=\$1/);
 assert.match(backend, /name=title\[:200\]/);
 assert.match(backend, /ON CONFLICT\(user_id,name\)/);
});
