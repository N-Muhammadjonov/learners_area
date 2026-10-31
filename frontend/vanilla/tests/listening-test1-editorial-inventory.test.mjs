import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../../../content/listening/academic/test-01/',import.meta.url);
const plan=JSON.parse(readFileSync(new URL('contextual-next-100.editorial.json',root),'utf8'));
const html=readFileSync(new URL('source.html',root),'utf8');
const at=html.indexOf('const DATA=');
assert(at>=0);
const data=JSON.parse(html.slice(at+11,html.indexOf(';\nconst PARTS=',at)));

test('Test 1 inventory has exactly 100 unique source numbered targets',()=>{
 assert.equal(plan.items.length,100);
 assert.deepEqual(plan.items.map(r=>r.entryNumber),Array.from({length:100},(_,i)=>i+1));
 assert.equal(new Set(plan.items.map(r=>r.entryNumber)).size,100);
 assert.equal(plan.sourceTest,'listening-test-1');
 assert.equal(plan.status,'STAGED_ONLY_NOT_PUBLISHED');
});

test('Every selected source span matches original Test 1 transcript verbatim',()=>{
 for(const x of plan.items){
  assert([1,2,3,4].includes(x.selected.part),x.surface);
  const source=data.transcript[String(x.selected.part)];
  assert.equal(source.slice(x.selected.start,x.selected.end),x.selected.surface,'#'+x.entryNumber+' '+x.surface);
 }
});

test('No published sense is fabricated; IDs must be backed by active release entry inventory',()=>{
 const valid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
 for(const x of plan.items){
  if(x.exactExistingSenseId){
   assert(valid.test(x.exactExistingSenseId),x.surface);
   assert(x.availableSenseIds.includes(x.exactExistingSenseId),x.surface);
   assert(x.activeReleaseEntryIds.length>0,x.surface);
  }else if(x.newEntryDraft){
   assert.equal(x.newEntryDraft.reviewStatus,'not_published');
   assert(x.newEntryDraft.headword);
   assert(x.newEntryDraft.partOfSpeech);
   assert(x.newEntryDraft.definitionEn);
   assert(x.newEntryDraft.translationUz);
   assert(x.newEntryDraft.sourceUrl.startsWith('https://'));
  }
 }
});

test('Gap-hidden targets are recorded as inaccessible rather than falsely linked',()=>{
 const gaps={};
 for(let part=1;part<=4;part++){
  const source=data.transcript[String(part)];
  let cursor=0;
  gaps[part]=data.script_completion.filter(g=>g.part===part).sort((a,b)=>a.n-b.n).flatMap(g=>{
   const index=source.indexOf(g.match,cursor);
   if(index<0)return [];
   cursor=index+g.match.length;
   return [{start:index,end:cursor}];
  });
 }
 const hidden=plan.items.filter(x=>gaps[x.selected.part].some(g=>x.selected.start<g.end&&x.selected.end>g.start));
 assert.deepEqual(hidden.map(x=>x.entryNumber),plan.audits.hiddenTargets.map(x=>x.i));
 assert.equal(plan.audits.safeToPublish,false);
});

test('Full Test 1 transcript inventory has exact offsets across all four Parts',()=>{
 const full=JSON.parse(readFileSync(new URL('script-all-tokens.pending.json',root),'utf8'));
 assert.equal(full.totalTokens,3098);
 assert.equal(full.distinctSurfaceForms,824);
 assert.equal(full.parts.length,4);
 assert.equal(full.parts.reduce((n,p)=>n+p.tokens.length,0),3098);
 for(const part of full.parts){
  const transcript=data.transcript[String(part.part)];
  assert.equal(part.sourceLength,transcript.length);
  for(const t of part.tokens){
   assert.equal(transcript.slice(t.start,t.end),t.surface);
   assert(t.end>t.start);
  }
 }
 assert.equal(full.status,'STAGED_NOT_CONTEXTUALLY_RESOLVED');
});
test('Bridge uses actual active Script tab, not unset aria-selected',()=>{
 const helper=readFileSync(new URL('../../js/generated/authored-helpers.js',import.meta.url),'utf8');
 assert.match(helper,/querySelector\('#scriptTabs \[data-spart\]\.active'\)/);
 assert.doesNotMatch(helper,/data-spart\]\[aria-selected/);
});
