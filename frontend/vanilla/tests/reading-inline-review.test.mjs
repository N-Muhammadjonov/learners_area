import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {evidenceRanges,paintEvidence,inlineReview} from '../modules/reading/inline-review.js';
import {sourceQuestions} from '../modules/reading/source-layout.js';
const qs=[{id:'q1',questionNo:1,type:'short_answer'},{id:'q2',questionNo:2,type:'short_answer'},{id:'q3',questionNo:3,type:'true_false_not_given'}];
const rows=[{questionId:'q1',isCorrect:false,correctAnswer:'blue',evidenceQuote:'The blue sky',explanation:'First reason'},{questionId:'q2',isCorrect:true,correctAnswer:'sky',evidenceQuote:'blue sky',explanation:'Second reason'},{questionId:'q3',isCorrect:false,correctAnswer:'not_given',evidenceQuote:'The blue sky'}];
const dict={reading:{yourAnswer:'Your answer',correctAnswer:'Correct answer',correct:'Correct',incorrect:'Incorrect',explanation:'Explanation'},readingV4:{explanationMissing:'Unavailable',unstatedEvidence:'Not stated'},readingPractice:{acceptedAnswers:'Accepted'}};
function dom(){const d=new JSDOM('<main></main>');for(const k of ['document','Node','DOMParser'])globalThis[k]=d.window[k];return d;}
test('actual evidence overlaps without duplicate labels or invented absence evidence',()=>{
 const d=dom();try{const main=document.querySelector('main');main.innerHTML='<p>The <span data-token="0">blue</span> sky is clear.</p>';const token=main.querySelector('[data-token]'),ranges=evidenceRanges('The blue sky is clear.',qs,rows);
 assert.equal(ranges.length,2);assert.equal(evidenceRanges('The blue sky. The blue sky.',qs,rows).length,0);
 paintEvidence(main,'The blue sky is clear.',ranges);
 assert.equal(main.textContent,'The blue sky is clear.');assert.equal(main.querySelector('[data-token]'),token);
 assert.deepEqual([...main.querySelectorAll('[data-evidence-label]')].map(n=>n.dataset.evidenceLabel).filter(Boolean),['Q1','Q2']);
 paintEvidence(main,'The blue sky is clear.',[]);assert.equal(main.querySelector('mark'),null);
 }finally{d.window.close();}
});
test('source table stays intact, review is tied to question ID and explanations cover both outcomes',()=>{
 const d=dom();try{const paper=sourceQuestions({group:{sourceHtml:'<table><tr><td><input data-source-numbers="1"></td></tr><tr><td><input data-source-numbers="2"></td></tr></table>'},questions:qs.slice(0,2),answers:{q1:'red',q2:'sky'},onChange:()=>{}});
 inlineReview(paper,{dict,questions:qs.slice(0,2),rows,answers:{q1:'red',q2:'sky'},readonly:true});
 assert.equal(paper.querySelectorAll('tr').length,2);assert.equal(paper.querySelectorAll('td [data-reading-inline-review]').length,2);
 assert.equal(paper.querySelector('[data-reading-inline-review="q1"] .reading-review-correct').textContent,'Correct answer: blue');assert.equal(paper.querySelector('[data-reading-inline-review="q2"] .reading-review-correct'),null);
 assert.equal(paper.querySelectorAll('details').length,2);assert([...paper.querySelectorAll('details')].every(n=>!n.open));assert([...paper.querySelectorAll('input')].every(n=>n.disabled));
 }finally{d.window.close();}
});
