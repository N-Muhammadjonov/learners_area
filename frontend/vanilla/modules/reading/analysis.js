import {el} from '../../js/dom.js';
import {clickableText} from '../vocabulary/clickable-text.js';
import {questionTypeLabel} from '../../js/generated/reading-lib/reading-labels.js';
import {readingQuestionType} from '../../js/generated/reading-lib/question-model.js';
import {ternaryLabel} from '../../js/generated/reading-lib/reading-choices.js';
import {isUnstatedAnswer} from '../../js/generated/reading-lib/unstated.js';
import {occurrenceSpans} from '../../js/generated/reading-lib/occurrence-spans.js';
import {retentionCheck} from './retention-check.js';
/** Original ReadingAnalysis.tsx (+ ReadingEvidence.tsx). Everything shown comes from the learner's own attempt rows.
 * The type table counts submitted answers only. The passage-level RetentionCheck is mounted by the caller. */
const answerLabel=(type,raw)=>(type!=='true_false_not_given'&&type!=='yes_no_not_given')?raw:ternaryLabel(type,raw);
export function evidence(context,{dict,body,title,quote,unstated}){
 if(unstated&&!quote.trim())return el('details',{'data-reading-evidence-absence':true},el('summary',{class:'cursor-pointer text-xs'},`${dict.reading.evidence}: ${title}`),el('p',{class:'mt-2 text-sm'},dict.readingV4.unstatedEvidence),el('p',{class:'mt-2 whitespace-pre-line text-sm','data-reading-evidence-context':true},body));
 const start=quote.trim()?body.indexOf(quote):-1;
 if(start<0)return el('p',{'data-reading-evidence-unlocated':true},dict.readingPractice.evidenceMissing);
 const end=start+quote.length;
 return el('details',{'data-reading-evidence-location':true},el('summary',{class:'cursor-pointer text-xs'},`${dict.reading.evidence}: ${title}`),
  el('p',{class:'mt-2 whitespace-pre-line text-sm','data-reading-evidence-context':true},
   start>100?'…':'',body.slice(Math.max(0,start-100),start),el('mark',{},body.slice(start,end)),body.slice(end,end+100),end+100<body.length?'…':''));
}
export function mountAnalysis(context,p){
 const {dict,locale}=context,attemptId=p.attemptId,answerBy=new Map(p.answers.map(a=>[a.questionId,a]));
 const rows=new Map();
 for(const q of p.questions){const a=answerBy.get(q.id);if(!a)continue;const type=readingQuestionType(q.typeCode??q.type)?.id??q.type;const row=rows.get(type)??{correct:0,total:0};row.total+=1;if(a.isCorrect)row.correct+=1;rows.set(type,row);}
 const byType=[...rows.entries()].map(([type,row])=>({type,...row,ratio:row.total?row.correct/row.total:0}));
 const weakest=byType.length?byType.reduce((worst,row)=>row.ratio<worst.ratio?row:worst,byType[0]):null;
 const position=new Map(p.groups.map(g=>[g.id,g.position]));
 const ordered=[...p.questions].sort((a,b)=>{const ap=a.groupId?(position.get(a.groupId)??Number.MAX_SAFE_INTEGER):Number.MAX_SAFE_INTEGER,bp=b.groupId?(position.get(b.groupId)??Number.MAX_SAFE_INTEGER):Number.MAX_SAFE_INTEGER;return ap===bp?a.order-b.order:ap-bp;});
 const groupById=new Map(p.groups.map(g=>[g.id,g]));
 const text=(value,extra={})=>attemptId?clickableText(context,{text:value,lexicalAssistance:false,sourceType:'reading',sourceId:attemptId,...extra}).node:value;
 const root=el('div',{class:'flex flex-col gap-4','data-reading-analysis':true,'data-native-view':'reading-analysis'});
 root.append(el('div',{class:'card flex flex-col items-center gap-1 py-6 text-center p-5'},
  el('span',{class:'text-xs uppercase tracking-wide text-ink-300'},dict.reading.score),
  el('span',{class:'font-display text-4xl text-ink-900'},`${p.score??''}/${p.total??''}`),
  el('span',{class:'text-xs text-ink-300'},dict.readingPractice.rawScoreNote)));
 root.append(el('div',{class:'card flex flex-col gap-2 p-5'},
  el('h2',{class:'text-sm font-medium text-ink-900'},dict.reading.typeMastery),
  el('p',{class:'text-xs text-ink-300'},dict.reading.typeMasteryHint),
  byType.length===0?el('p',{class:'text-sm text-ink-500'},dict.reading.noTypeData):el('ul',{class:'flex flex-col gap-2','data-type-mastery':true},byType.map(row=>el('li',{class:'flex items-center gap-3','data-type':row.type},
   el('span',{class:'w-40 shrink-0 text-xs text-ink-700'},questionTypeLabel(row.type,locale)),
   el('span',{class:'h-1.5 flex-1 overflow-hidden rounded-full bg-paper-sunken'},el('span',{class:`block h-full ${row.ratio>=0.8?'bg-band-good':row.ratio>=0.5?'bg-band-warn':'bg-band-bad'}`,style:{width:`${Math.round(row.ratio*100)}%`}})),
   el('span',{class:'w-12 shrink-0 text-right font-mono text-xs text-ink-500'},`${row.correct}/${row.total}`)))),
  weakest?el('p',{class:'text-xs text-ink-500'},`${dict.reading.weakTypeNote}: `,el('strong',{class:'text-ink-900'},questionTypeLabel(weakest.type,locale)),` (${weakest.correct}/${weakest.total})`):null));
 if(p.passageBody&&attemptId)root.append(retentionCheck(context,{passageTitle:p.passageTitle,passageBody:p.passageBody,passageLevel:p.passageLevel,sourceId:attemptId,occurrences:p.occurrences,lexicalAssistance:true}));
 for(const [index,q] of ordered.entries()){
  const evidencePassage=p.passages.find(x=>x.id===q.passageId),a=answerBy.get(q.id),group=q.groupId?groupById.get(q.groupId):undefined;
  const isNewGroup=!!group&&ordered[index-1]?.groupId!==group.id;
  const alternatives=(q.acceptedAnswers??[]).filter(v=>v.trim().toLowerCase()!==q.correctAnswer.trim().toLowerCase());
  if(isNewGroup&&group)root.append(el('div',{class:'rounded-[16px] border border-ink-100 bg-paper-sunken p-4','data-group-instructions':group.typeCode},
   el('p',{class:'mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500'},group.displayTitle??dict.readingPractice.groupQuestions.replace('{from}',String(group.fromQuestionNo??q.questionNo??q.order)).replace('{to}',String(group.toQuestionNo??q.questionNo??q.order))),
   group.sharedChoices.length>0?el('ul',{},group.sharedChoices.map(c=>el('li',{},c))):null,
   group.instructionsText?el('p',{class:'whitespace-pre-line text-sm text-ink-700'},group.instructionsText):null));
  const card=el('div',{class:`card p-5 ${a?.isCorrect?'border-band-good/40':'border-band-bad/40'}`},
   el('div',{class:'mb-2 flex flex-wrap items-center justify-between gap-2'},
    el('p',{class:'text-sm font-medium text-ink-900'},`${q.questionNo??q.order}. ${q.questionText.trim()||dict.readingPractice.chooseLetter}`),
    el('span',{class:`badge ${a?.isCorrect?'bg-band-good/10 text-band-good':'bg-band-bad/10 text-band-bad'}`},a?.isCorrect?dict.reading.correct:dict.reading.incorrect)),
   el('p',{class:'text-xs uppercase tracking-wide text-ink-300'},`${dict.reading.questionType}: ${questionTypeLabel(q.typeCode??q.type,locale)}`),
   el('p',{class:'mt-1 text-sm text-ink-500'},`${dict.reading.yourAnswer}: `,el('span',{class:'text-ink-900'},a?.userAnswer?answerLabel(q.type,a.userAnswer):'—')),
   el('p',{class:'text-sm text-ink-500'},`${dict.reading.correctAnswer}: `,el('span',{class:'text-ink-900'},answerLabel(q.type,q.correctAnswer))),
   alternatives.length>0?el('p',{class:'text-xs text-ink-300'},`${dict.readingPractice.acceptedAnswers}: ${alternatives.join(', ')}`):null);
  if(q.evidenceQuote)card.append(el('div',{class:'mt-1 text-xs italic text-ink-300','data-evidence':q.id},`${dict.reading.evidence}: `,
   attemptId?clickableText(context,{text:q.evidenceQuote,lexicalAssistance:false,sourceType:'reading',sourceId:attemptId,occurrences:occurrenceSpans(p.passageBody??'',q.evidenceQuote,p.occurrences)}).node:q.evidenceQuote,
   q.evidenceType==='missing_source'?el('span',{class:'ml-1 not-italic'},`(${dict.readingPractice.evidenceMissing})`):null));
  if((q.evidenceQuote||isUnstatedAnswer(q.correctAnswer))&&evidencePassage)card.append(evidence(context,{dict,body:evidencePassage.body,title:evidencePassage.title,quote:q.evidenceQuote??'',unstated:isUnstatedAnswer(q.correctAnswer)}));
  if(!q.evidenceQuote&&!isUnstatedAnswer(q.correctAnswer))card.append(el('p',{class:'text-xs text-ink-500','data-evidence-missing':true},dict.readingV4.evidenceMissing));
  if(q.explanation)card.append(el('div',{class:'mt-1 text-xs text-ink-500'},el('span',{class:'text-ink-300'},`${dict.reading.explanation}: `),attemptId?clickableText(context,{text:q.explanation,lexicalAssistance:false,sourceType:'reading',sourceId:attemptId}).node:q.explanation));
  else card.append(el('p',{class:'text-xs text-ink-500','data-explanation-missing':true},dict.readingV4.explanationMissing));
  root.append(card);
 }
 return root;
}
