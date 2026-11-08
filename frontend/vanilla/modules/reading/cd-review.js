import {el} from '../../js/dom.js';
import {createWorkspace} from './workspace.js';
import {mountAnalysis} from './analysis.js';
import {sourceDocument} from './source-layout.js';
/** Review uses the same paper and passage navigation; verdicts remain server-owned. */
export function cdReview(ctx,p){
 const state={pane:'passage',fontSize:16,split:50},parts=p.passages?.length?p.passages:[{title:p.passageTitle,body:p.passageBody}];let active=0,ws;
 function draw(){
  const part=parts[active],questions=part.id?p.questions.filter(q=>q.passageId===part.id):p.questions,ids=new Set(questions.map(q=>q.groupId));
  const pane=part.sourceHtml?sourceDocument(part.sourceHtml):el('article',{class:'reading-passage-text'},el('h2',{class:'reading-passage-title'},part.title),...part.body.split(/\n\s*\n/).map(text=>el('p',{class:'academic-text'},text)));
  const review=mountAnalysis(ctx,{...p,questions,groups:p.groups.filter(g=>ids.has(g.id)),passageBody:part.body,passageTitle:part.title});
  const nav=el('div',{class:'reading-part-navigation'},parts.map((part,i)=>{const b=el('button',{type:'button',class:'reading-part-button','aria-pressed':String(active===i)},'Passage '+(i+1));b.addEventListener('click',()=>{active=i;draw();},{signal:ctx.signal});return b;}));
  for(const q of questions){const b=el('button',{type:'button',class:'reading-question-button'},String(q.questionNo??q.order));b.addEventListener('click',()=>review.querySelector('[data-review-question=\"'+q.id+'\"]')?.scrollIntoView?.({block:'start'}),{signal:ctx.signal});nav.append(b);}
  ws.update({passagePane:pane,questionsPane:review,navigation:nav,action:el('a',{href:'/app/reading/academic',class:'reading-back'},ctx.dict.common.back),tools:[el('strong',{},'Review · '+p.score+'/'+p.total)],pane:state.pane});
 }
 ws=createWorkspace({labels:ctx.dict.readingWorkspace,brand:'Learners Area',title:'Reading · Review',state,setPane:pane=>{state.pane=pane;ws.update({pane});},setFont:size=>{state.fontSize=Math.max(14,Math.min(22,size));ws.update({});}});draw();return ws.root;
}
