import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const source=readFileSync(new URL('../modules/vocabulary/clickable-text.js',import.meta.url),'utf8');

test('Reading highlight palette uses colored circular swatches with accessible labels',()=>{
 assert.match(source,/class:'h-9 w-9 shrink-0 rounded-full/);
 assert.match(source,/'aria-label':color, title:color/);
 assert.match(source,/style:\{backgroundColor:bg\}\}\);/);
 assert.doesNotMatch(source,/style:\{backgroundColor:bg,color:fg\}\},color\)/);
 assert.match(source,/'data-highlight-remove':true/);
});

test('only pronouns are excluded from verified Reading word candidates',()=>{
 assert.match(source,/const READING_PRONOUNS=new Set/);
 assert.match(source,/sourceType==='reading'&&verifiedOnly\?READING_PRONOUNS\.has\(normalized\):BASIC_WORDS\.has\(normalized\)/);
 assert.match(source,/!isExcludedLexicalWord\(t,sourceType,verifiedOnly\)/);
 assert.match(source,/!verifiedOnly\|\|phraseTarget\(text,t,occurrences\)\.occurrence/);
 assert.match(source,/if\(verifiedOnly&&!occurrence\)return/);
});
