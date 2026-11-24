import {el} from '../../js/dom.js';
import {createWorkspace} from './workspace.js';
import {mountAnalysis} from './analysis.js';
import {sourceDocument} from './source-layout.js';
import {groupHeading,groupQuestions,questionCard} from './questions.js';
import {bindEvidence,evidenceRanges,inlineReview} from './inline-review.js';
/** Completed review retains the CD paper, including the authored question layouts. */
export function cdReview(ctx,p){
 const {dict}=ctx,state={pane:'passage',fontSize:16,split:50},parts=p.passages?.length?p.passages:[{title:p.passageTitle,body:p.passageBody}];
 const answers=Object.fromEntries(p.answers.map(a=>[a.questionId,a.userAnswer??''])),answerBy=new Map(p.answers.map(a=>[a.questionId,a])),expanded=new Set();
 let active=0,ws,partController;
 function setPane(pane){state.pane=pane;ws.update({pane});}
 function draw(){
  partController?.abort();partController=new AbortController();
  const part=parts[active],questions=part.id&&parts.length>1?p.questions.filter(q=>q.passageId===part.id||part.questionIds?.includes(q.id)):p.questions,ids=new Set(questions.map(q=>q.groupId)),groups=p.groups.filter(g=>ids.has(g.id));
  const rows=questions.map(q=>({...q,questionId:q.id,isCorrect:answerBy.get(q.id)?.isCorrect===true}));
  const content=part.sourceHtml?sourceDocument(part.sourceHtml,{skipTitle:true}):el('div',{class:'reading-passage-text'},...part.body.split(/\n\s*\n/).map(text=>el('p',{class:'academic-text'},text)));
  const numbers=questions.map(q=>q.questionNo??q.order),range=numbers.length?dict.readingWorkspace.questionRange.replace('{from}',String(Math.min(...numbers))).replace('{to}',String(Math.max(...numbers))):'';
  const pane=el('div',{},el('h2',{class:'reading-pane-heading'},dict.generalReading.passageN.replace('{n}',String(active+1))),el('p',{class:'reading-part-instruction'},range),el('h3',{class:'reading-passage-title'},part.title),content);
  bindEvidence(content,part.body,partController.signal)(evidenceRanges(part.body,questions,rows));
  const paper=el('div',{'data-reading-analysis':true,'data-native-view':'reading-analysis'},el('h2',{class:'reading-pane-heading'},range),
   el('div',{class:'reading-question-blocks'},
    groups.map(group=>el('section',{class:'reading-question-group'},groupHeading(dict,group),...groupQuestions(ctx,{dict,group,questions:questions.filter(q=>q.groupId===group.id),answers,onChange:()=>{}}))),
    questions.filter(q=>!groups.some(g=>g.id===q.groupId)).map(q=>questionCard(ctx,{dict,question:q,group:null,value:answers[q.id]??'',onChange:()=>{},inputId:'answer-'+q.id}))));
  inlineReview(paper,{dict,questions,rows,answers,expanded,readonly:true});
  paper.append(el('details',{class:'reading-review-statistics'},el('summary',{},dict.reading.typeMastery),mountAnalysis({...ctx,signal:partController.signal},{...p,questions,groups,passageBody:part.body,passageTitle:part.title,summaryOnly:true})));
  const nav=el('div',{class:'reading-part-navigation'},parts.map((part,i)=>{
   const label=dict.generalReading.passageN.replace('{n}',String(i+1));
   if(i===active)return el('span',{class:'reading-part-label','aria-current':'true'},label);
   const b=el('button',{type:'button',class:'reading-part-button'},label);
   b.addEventListener('click',()=>{active=i;draw();},{signal:partController.signal});return b;
  }));
  const nums=el('div',{class:'reading-question-numbers'});
  for(const q of questions){
   const b=el('button',{type:'button','data-reading-question-nav':q.id,'data-reading-verdict':answerBy.get(q.id)?.isCorrect===true?'correct':'incorrect'},String(q.questionNo??q.order));
   b.addEventListener('click',()=>{setPane('questions');[...paper.querySelectorAll('[data-review-question]')].find(n=>n.dataset.reviewQuestion===q.id)?.scrollIntoView?.({block:'center'});},{signal:partController.signal});nums.append(b);
  }
  nav.append(nums);
  ws.update({passagePane:pane,questionsPane:paper,navigation:nav,action:el('a',{href:'/app/reading/academic',class:'reading-back'},dict.common.back),tools:[el('strong',{},'Review · '+p.score+'/'+p.total)],pane:state.pane});
 }
 ctx.signal.addEventListener('abort',()=>partController?.abort(),{once:true});
 ws=createWorkspace({labels:dict.readingWorkspace,brand:'Learners Area',title:'Reading · Review',state,setPane,setFont:size=>{state.fontSize=Math.max(14,Math.min(22,size));ws.update({});}});draw();return ws.root;
}
