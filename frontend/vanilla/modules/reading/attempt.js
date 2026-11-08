import {el} from '../../js/dom.js';
import {viewData} from '../../js/adapters/frontend.js';
import {uuid} from '../../js/adapters/listening-v7.js';
import {readingAttemptDTO} from '../../js/adapters/reading-v44.js';
import {publicReadingConstraint,readingQuestionType} from '../../js/generated/reading-lib/question-model.js';
import {questionTypeLabel} from '../../js/generated/reading-lib/reading-labels.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {missing} from '../listening/catalogue-v9.js';
import {mountExam} from './exam.js';
import {cdReview as mountAnalysis} from './cd-review.js';
/** Original src/app/app/(focus)/reading/attempts/[id]/page.tsx. An open attempt is the exam; a finished one is the
 * analysis. The original's 404 rules (malformed id, unknown row) are answered by the not-found presentation. */
export function mountAttempt(context){
 const {root,url,signal,dict,locale}=context,id=url.pathname.split('/')[4],host=el('div',{class:'reading-attempt-route','data-native-view':'reading-attempt'});root.append(host);let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;host.replaceChildren(el('p',{role:'status'},dict.common.loading));
  try{
   if(!uuid(id)){host.replaceChildren(missing(dict));return;}
   const raw=await viewData(url.pathname+url.search,signal);if(signal.aborted)return;
   if(raw.kind==='not_found'){host.replaceChildren(missing(dict));return;}
   const d=readingAttemptDTO(raw,id);
   const requested=url.searchParams.get('type');
   const types=d.questions.map(q=>readingQuestionType(q.typeCode??q.type)?.id);
   const notice=requested&&types.includes(requested)?el('p',{class:'body-text','data-requested-reading-type':requested},`${dict.readingV4.requestedType}: ${questionTypeLabel(requested,locale)}. ${dict.readingV4.wholePassage}`):null;
   host.replaceChildren(notice??'');
   const body=el('div',{class:d.attempt.status==='in_progress'?'reading-fill':''});host.append(body);
   const passageMeta=d.passage.testNo!=null&&d.passage.passageNo!=null?dict.readingPractice.passageMeta.replace('{test}',String(d.passage.testNo)).replace('{passage}',String(d.passage.passageNo)):null;
   if(d.attempt.status==='in_progress'){
    const sections=d.sections;
    mountExam({...context,root:body},{
     attemptId:id,testTitle:d.passage.testNo!=null?`Reading Test ${d.passage.testNo}`:d.passage.title,passageTitle:d.passage.title,passageBody:d.passage.bodyText,passageSourceHtml:sections[0]?.passage.sourceHtml,passageMeta,
     parts:sections.length>1?sections.map(section=>({title:section.passage.title,body:section.passage.bodyText,sourceHtml:section.passage.sourceHtml,paragraphs:section.paragraphs.map(publicParagraph),questionIds:section.questions.map(q=>q.id),groupIds:section.groups.map(g=>g.id)})):[],
     startedAt:d.attempt.startedAt,suggestedMinutes:sections.length>1?60:d.passage.suggestedMinutes,
     groups:d.groups.map(publicGroup),paragraphs:d.paragraphs.map(publicParagraph),
     savedAnswers:Object.fromEntries(d.answers.filter(a=>a.isCorrect===null).map(a=>[a.questionId,a.userAnswer])),
     questions:d.questions.map(publicQuestion)});
   }else{
    body.append(mountAnalysis({...context,root:body},{
     attemptId:id,score:d.attempt.score,total:d.attempt.totalQuestions,questions:d.questions,groups:d.groups,answers:d.answers,
     passageBody:d.passage.bodyText,passageTitle:d.passage.title,passageLevel:d.passage.difficultyLevel,occurrences:d.occurrences,
     passages:d.sections.map(s=>({id:s.passage.id,title:s.passage.title,body:s.passage.bodyText,sourceHtml:s.passage.sourceHtml})),
    }));
   }
  }catch(e){
   if(signal.aborted)return;
   if(e.status===404){host.replaceChildren(missing(dict));return;}
   host.replaceChildren(RegionFailureNotice({region:'reading-attempt',message:dict.auth.errorServer,retryLabel:dict.globalDictionary.retry,refresh:load}));
  }finally{busy=false;}
 }
 void load();
}
const publicGroup=g=>({id:g.id,position:g.position,typeCode:g.typeCode,displayTitle:g.displayTitle,instructionsText:g.instructionsText,fromQuestionNo:g.fromQuestionNo,toQuestionNo:g.toQuestionNo,sharedChoices:g.sharedChoices,sourceHtml:g.sourceHtml});
const publicParagraph=p=>({id:p.id,position:p.position,label:p.label,text:p.text,isFootnote:p.isFootnote});
const publicQuestion=q=>({id:q.id,order:q.order,questionNo:q.questionNo,sourceQuestionNo:q.sourceQuestionNo,type:q.type,typeCode:q.typeCode,groupId:q.groupId,renderMode:q.renderMode,questionText:q.questionText,options:q.options??null,answerConstraint:publicReadingConstraint(q.answerConstraint)});
