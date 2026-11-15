import test from 'node:test';
import assert from 'node:assert/strict';
import {indexPageSchema} from '../../workers/shared/dictionary/search-index.ts';
import {measurementGroupSchema} from '../../src/lib/retention/measurement.ts';
import {listeningAuthoredRuntimeSchema} from '../../src/lib/listening/package.ts';

test('oversized dictionary terms stop at the collection limit before validating elements',()=>{
 const result=indexPageSchema.safeParse({
  version:'prefix-sorted-postings-v3',release_id:'rel-v1-'+'a'.repeat(24),
  direction:'EN',prefix:'',terms:Array(30001).fill(null),previews:{},
 });
 assert.equal(result.success,false);
 assert.equal(result.error.issues.length,1);
 assert.equal(result.error.issues[0].code,'too_big');
 assert.deepEqual(result.error.issues[0].path,['terms']);
});

test('retention keeps domain error labels for unsupported kinds and unknown fields',()=>{
 const base={id:'group-1',points:100,kind:'concept',anyOf:['learning']};
 const unsupported=measurementGroupSchema.safeParse({...base,kind:'unsupported'});
 assert.equal(unsupported.success,false);
 assert.equal(unsupported.error.issues[0].message,'group_kind_unsupported');
 const extra=measurementGroupSchema.safeParse({...base,untrusted:true});
 assert.equal(extra.success,false);
 assert.equal(extra.error.issues[0].message,'group_unexpected_field');
});

test('authored Listening runtime accepts string-keyed files and rejects non-text values',()=>{
 const source={entryPath:'index.html',files:{'index.html':'<main>Question</main>'}};
 assert.deepEqual(listeningAuthoredRuntimeSchema.parse(source),source);
 assert.equal(listeningAuthoredRuntimeSchema.safeParse({
  ...source,files:{'index.html':{html:'unsafe'}},
 }).success,false);
});
