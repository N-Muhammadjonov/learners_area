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
 assert.equal(plan.status,'EDITORIAL_SELECTION_COMPLETE_NOT_PUBLISHED');
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

test('All 100 editorial selections are source exact, never unresolved',()=>{
 assert.equal(plan.items.length,100);
 assert.equal(plan.items.filter(x=>x.status==='existing_sense_selected').length,86);
 assert.equal(plan.items.filter(x=>x.status==='new_entry_source_checked').length,14);
 assert.equal(plan.items.filter(x=>x.status.includes('draft')||x.status.includes('requires')||x.status.includes('unresolved')).length,0);
 assert(plan.items.every(x=>x.status==='existing_sense_selected'||x.status==='new_entry_source_checked'));
});

test('New lexical entries supply required dictionary fields and avoid sentence headwords',()=>{
 const batch=JSON.parse(readFileSync(new URL('lexical-new-entries.source-checked.json',root),'utf8'));
 assert.equal(batch.entries.length,14);
 for(const entry of batch.entries){
  assert(entry.headword.length>1&&entry.headword.length<100);
  assert(!/[.!?]$/.test(entry.headword));
  assert(entry.partOfSpeech&&entry.definitionEn&&entry.translationUz&&entry.exampleSentence);
  assert(Array.isArray(entry.synonyms)&&Array.isArray(entry.antonyms)&&Array.isArray(entry.collocations));
  assert(entry.source?.url?.startsWith('https://'));
  assert.equal(entry.editorialState,'source_checked_ready_for_release_build');
  const part=entry.target.part;
  assert.equal(data.transcript[String(part)].slice(entry.target.start,entry.target.end),entry.target.surface);
 }
 assert.equal(batch.releaseDraftStatus,'NOT_PUBLISHED');
});

test('100 selected editorial targets never overlap',()=>{
 for(let i=0;i<plan.items.length;i++){
  const a=plan.items[i].selected;
  for(let j=i+1;j<plan.items.length;j++){
   const b=plan.items[j].selected;
   assert(a.part!==b.part||a.end<=b.start||b.end<=a.start,
    'Overlapping target positions #'+plan.items[i].entryNumber+' and #'+plan.items[j].entryNumber);
  }
 }
 assert.equal(plan.audits.selectedTargetsNonOverlapping,true);
});

test('Part 1 inventories every token and preserves single-sense candidate boundaries',()=>{
 const part=JSON.parse(readFileSync(new URL('script-part1-sense-candidates.json',root),'utf8'));
 assert.equal(part.part,1);
 assert.equal(part.tokenCount,779);
 assert.equal(part.tokens.length,779);
 assert.equal(part.uniqueForms,282);
 assert.equal(part.stats.uniqueCandidateSpans,part.singleSenseCandidateSpans.length);
 const transcript=data.transcript['1'];
 for(const token of part.tokens){
  assert.equal(transcript.slice(token.start,token.end),token.surface);
  const spans=part.knownEditorialPhrases.filter(x=>token.start>=x.from&&token.end<=x.to);
  assert.deepEqual(token.phraseTargets,spans.map(x=>x.id));
 }
 for(const span of part.singleSenseCandidateSpans){
  assert.equal(transcript.slice(span.start,span.end),span.surface);
  const t=part.tokens[span.tokenIndex-1];
  assert.equal(t.start,span.start);
  assert.equal(t.end,span.end);
  assert.equal(t.visibility,'visible');
  assert.equal(t.phraseTargets.length,0);
  assert.match(span.entryId,/^[0-9a-f-]{36}$/);
  assert.match(span.senseId,/^[0-9a-f-]{36}$/);
 }
});

test('Part 1 external lexical sources and proper-name exclusions are explicit',()=>{
 const verified=JSON.parse(readFileSync(new URL('script-part1-verified-missing-lemmas.json',root),'utf8'));
 assert.equal(verified.releaseState,'NOT_PUBLISHED');
 assert.deepEqual(verified.wordEntries.map(x=>x.lemma).sort(),['oh','shall','yours']);
 assert.deepEqual(verified.properNames.map(x=>x.surface).sort(),['jim','june','peter']);
 for(const e of verified.wordEntries){
  assert(e.source.startsWith('https://dictionary.cambridge.org/'));
  assert(e.meaning&&e.uz&&e.pos&&e.cefr);
  assert(Array.isArray(e.synonyms)&&Array.isArray(e.antonyms));
  assert(e.occurrences.length>0);
 }
});

test('Part 1 context review rejects semantically incorrect unique dictionary senses',()=>{
 const part=JSON.parse(readFileSync(new URL('script-part1-sense-candidates.json',root),'utf8'));
 const review=part.editorialQueue;
 assert.equal(review.summary.approvedOccurrences,21);
 assert.equal(review.summary.rejectedOccurrences,13);
 assert.equal(review.summary.remainingOccurrences,0);
 const all=[...review.contextApproved,...review.rejectedWrongSense];
 assert.equal(new Set(all.map(x=>x.tokenIndex)).size,all.length);
 for(const x of review.contextApproved){
  assert.equal(part.tokens[x.tokenIndex-1].surface,data.transcript['1'].slice(x.start,x.end));
  assert(x.definitionEn&&x.translationUz&&x.senseId);
 }
 for(const x of review.rejectedWrongSense){
  assert(x.reason&&x.status==='rejected_false_single_sense');
 }
 assert(review.rejectedWrongSense.some(x=>x.lemma==='minutes'));
 assert(review.rejectedWrongSense.some(x=>x.lemma==='played'));
});

test('Part 1 staged mappings use exact, nonoverlapping transcript spans and real sense UUIDs',()=>{
 const mapped=JSON.parse(readFileSync(new URL('script-part1-staged-sense-mapping.json',root),'utf8'));
 assert.equal(mapped.part,1);
 assert.equal(mapped.count,mapped.mappings.length);
 assert.equal(mapped.deploymentStatus,'NOT_PUBLISHED');
 const transcription=data.transcript['1'], sorted=[...mapped.mappings].sort((a,b)=>a.start-b.start);
 for(const [i,x] of sorted.entries()){
  assert.equal(transcription.slice(x.start,x.end),x.surface,'invalid span at '+i);
  assert.match(x.senseId,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  if(i)assert(sorted[i-1].end<=x.start,'overlapping mappings');
 }
 assert(!sorted.some(x=>x.surface.toLowerCase()==='two'&&x.senseId==='531939e8-d737-416a-9ef4-ed170f918dd0'));
});
