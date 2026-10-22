import test from 'node:test';
import assert from 'node:assert/strict';
import {withReadingFeedback} from '../src/lib/reading/feedback';
import {isUnstatedAnswer} from '../src/lib/reading/unstated';
import type {readingQuestions} from '../src/db/schema';
const question=(patch:Partial<typeof readingQuestions.$inferSelect>={})=>({id:'00000000-0000-4000-8000-000000000001',questionText:'The first preservative was salt.',correctAnswer:'true',type:'true_false_not_given',explanation:'',evidenceQuote:'Salt preserved the food.',...patch} as typeof readingQuestions.$inferSelect);
test('post-check explanations use exact evidence and the unchanged answer key; authored prose always wins',()=>{
 const q=question(),body='Salt preserved the food.';
 const [row]=withReadingFeedback([q],body);assert.ok(row!.explanation.includes('TRUE'));assert.equal(row!.correctAnswer,q.correctAnswer);assert.equal(row!.evidenceQuote,q.evidenceQuote);
 assert.equal(withReadingFeedback([question({explanation:'Author rationale'})],body)[0]!.explanation,'Author rationale');
 assert.equal(withReadingFeedback([question()], 'An unrelated passage.')[0]!.explanation,'','an unlocated quote cannot be promoted to proof');
});
test('Not Given explains absent information without inventing a supporting sentence',()=>{
 const [row]=withReadingFeedback([question({correctAnswer:'not_given',evidenceQuote:null})],'An unrelated passage.');
 assert.equal(row!.evidenceQuote,null);assert.match(row!.explanation,/does not state/);
 assert.equal(isUnstatedAnswer('D — Not mentioned in the passage.'),true);assert.equal(isUnstatedAnswer('false'),false);
});
test('source-edited questions cannot inherit a supplement from an unrelated body',()=>{
 const q=question({id:'27de7dd8-a5d8-406d-9a57-b4ce5b65f304',evidenceQuote:null});
 const [row]=withReadingFeedback([q],'changed source');assert.equal(row!.evidenceQuote,null);assert.equal(row!.explanation,'');
});
