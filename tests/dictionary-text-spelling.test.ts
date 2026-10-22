import test from 'node:test';import assert from 'node:assert/strict';import {dictionarySpellingVariants} from '../src/lib/dictionary/spelling-variants';
test('lookup recovers possessed plurals and spaced compounds without dropping semantic prefixes',()=>{
 assert.deepEqual(dictionarySpellingVariants('children’s'),["children's",'children']);
 assert.deepEqual(dictionarySpellingVariants('decision-making'),['decision-making','decision making']);
 assert.deepEqual(dictionarySpellingVariants('re-sign'),['re-sign','re sign']);
 assert.deepEqual(dictionarySpellingVariants('unrelated'),['unrelated']);
 assert.deepEqual(dictionarySpellingVariants('find out'),['find out']);
});
