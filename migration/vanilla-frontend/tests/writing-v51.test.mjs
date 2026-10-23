/** Writing V50: real ESM syntax plus focused source-contract checks.
 * Does not claim the entire app built or live integration passed. */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../modules/writing');
const modules=['shared','index','home','lessons','exam','translation','typing','topic','grade','activation','stealing','submissions'];
for(const name of modules){
 const file=join(root,`${name}.js`);
 assert.ok(existsSync(file),`Missing ${name}.js`);
 // The stage has no package.json: force true ESM parsing rather than Node's
 // ambiguous .js check, which masked two original V49 syntax defects.
 const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:readFileSync(file),encoding:'utf8'});
 assert.equal(checked.status,0,`${name}.js ESM parse failure:\n${checked.stderr}`);
}
const source=name=>readFileSync(join(root,`${name}.js`),'utf8');
assert.match(source('shared'),/data\?\.error\?\.code/);
assert.match(source('shared'),/!res\.ok/);
assert.match(source('grade'),/if\(!uuid\(res\.id\)\)/);
assert.match(source('typing'),/starting=false;finishing=false/);
assert.match(source('typing'),/generation!==requestGeneration/);
assert.match(source('typing'),/function graphSvg\(/);
assert.match(source('exam'),/data-exam-combined/);
assert.match(source('exam'),/const revision=s\.revision,content=s\.text/);
assert.match(source('exam'),/savedRevision=Math\.max\(latest\.savedRevision,revision\)/);
assert.match(source('exam'),/g1\+2\*g2/);
assert.match(source('exam'),/data-exam-grade/);
assert.match(source('translation'),/data-translation-fixes/);
assert.match(source('topic'),/sentence_frame:'frames'/);
assert.match(source('topic'),/data-topic-patterns/);
assert.match(source('lessons'),/\/api\/writing\/lessons\/\$\{id\}`,[^\n]+,'POST'/);
assert.ok(existsSync(join(root,'writing.css')));
console.log('V50: 12/12 JavaScript files pass strict ESM parsing; focused source contracts PASS.');
