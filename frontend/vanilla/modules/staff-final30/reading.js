import {el,listen,mountStaff,BackLink,errorText,publicationControl,put,setChildren} from './kit.js';
import {resourceComposer} from './resource-composer.js';
import {passages,passage,createPassage,createQuestion} from '../../js/adapters/staff-final30/reading.js';
const ROLES=['admin','owner'];
const TERNARY={true_false_not_given:[['true','True'],['false','False'],['not_given','Not Given']],yes_no_not_given:[['yes','Yes'],['no','No'],['not_given','Not Given']]};
const lab=(id,t)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},t);
function newPassageForm(ctx,view){
 const {dict,signal,navigate}=ctx,f=dict.formCopy,S=(ctx.state.newPassage??={open:false,title:'',bodyText:'',level:'B2',minutes:'15',pending:false,error:false});
 if(!S.open){const b=el('button',{type:'button',class:'btn-secondary','data-new-passage':''},`+ ${dict.admin.newPassage}`);listen(b,'click',()=>{S.open=true;view.rerender();},signal);return b;}
 const bind=(n,k)=>{n.value=S[k];listen(n,'input',()=>{S[k]=n.value;},signal);return n;};
 const level=el('select',{id:'difficultyLevel',class:'input'},['A2','B1','B2','C1','C2'].map(l=>el('option',{value:l},l)));bind(level,'level');listen(level,'change',()=>{S.level=level.value;},signal);
 const cancel=el('button',{type:'button',class:'btn-ghost'},dict.common.cancel);listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);
 const form=el('form',{class:'card flex flex-col gap-3 p-4'},el('div',{},lab('title',f.title),bind(el('input',{id:'title',class:'input',required:'','data-focus-key':'np-title'}),'title')),el('div',{},lab('bodyText',f.passageText),bind(el('textarea',{id:'bodyText',class:'input min-h-[200px]',required:''}),'bodyText')),
  el('div',{class:'grid grid-cols-1 gap-3 sm:grid-cols-2'},el('div',{},lab('difficultyLevel',f.level),level),el('div',{},lab('suggestedMinutes',f.minutes),bind(el('input',{id:'suggestedMinutes',type:'number',min:'5',max:'90',class:'input'}),'minutes'))),
  S.error?el('p',{role:'alert',class:'text-sm text-band-bad'},dict.common.error):null,el('div',{class:'flex gap-2'},el('button',{type:'submit',class:'btn-primary',disabled:S.pending},S.pending?dict.common.saving:dict.common.save),cancel));
 listen(form,'submit',async e=>{e.preventDefault();if(S.pending||signal.aborted)return;S.error=false;S.pending=true;view.rerender();
  try{const r=await createPassage({title:S.title,bodyText:S.bodyText,difficultyLevel:S.level,suggestedMinutes:S.minutes},signal);if(signal.aborted)return;S.pending=false;void navigate(`/app/admin/reading/${r.id}`);}
  catch{if(signal.aborted)return;S.pending=false;S.error=true;view.rerender();}},signal);
 return form;
}
/** Source: admin/reading/page.tsx. Deviation D-1: the card's title is the link; the publication control is a sibling (the source nests controls inside an anchor, which is invalid HTML). */
export const listMount=mountStaff({name:'management-reading',roles:ROLES,load:c=>passages(c.signal),
 render(ctx,data,view){const {dict}=ctx;
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},el('div',{class:'flex items-center justify-between'},el('h1',{class:'font-display text-2xl text-ink-900'},dict.admin.readingTitle),
   el('div',{class:'flex items-center gap-2'},el('a',{href:'/app/admin/reading/retention',class:'btn-secondary','data-reading-retention-link':''},dict.retentionMemory.admin.title),el('a',{href:'/app/admin/reading/import',class:'btn-secondary','data-admin-reading-import':''},dict.readingImport.title),newPassageForm(ctx,view))),
   el('div',{class:'flex flex-col gap-2'},data.passages.map(p=>el('div',{class:'card flex items-center justify-between hover:border-signal-400','data-passage':p.id},el('a',{href:`/app/admin/reading/${p.id}`,class:'text-sm font-medium text-ink-900'},p.title),
    el('div',{class:'flex flex-col items-end gap-1'},el('span',{class:'text-xs text-ink-300'},`${p.difficultyLevel} · ${p.suggestedMinutes} min`),publicationControl(ctx,{type:'reading',id:p.id,state:p.publicationState,publishAt:p.publishAt,onSaved:()=>view.reload({quiet:true})}))))));}});
function newQuestionForm(ctx,passageId,view){
 const {dict,signal}=ctx,f=dict.formCopy,S=(ctx.state.newQuestion??={open:false,type:'true_false_not_given',questionText:'',options:['','','',''],correct:'true',evidence:'',explanation:'',pending:false,error:''});
 if(!S.open){const b=el('button',{type:'button',class:'btn-secondary','data-new-question':''},`+ ${dict.admin.newQuestion}`);listen(b,'click',()=>{S.open=true;view.rerender();},signal);return b;}
 const bind=(n,k)=>{n.value=S[k];listen(n,'input',()=>{S[k]=n.value;},signal);return n;};
 const type=el('select',{id:'type',class:'input'},[['true_false_not_given',f.tfng],['yes_no_not_given',f.ynng],['multiple_choice',f.multipleChoice],['short_answer',f.shortAnswer]].map(([v,l])=>el('option',{value:v},l)));type.value=S.type;
 listen(type,'change',()=>{S.type=type.value;S.correct=type.value==='yes_no_not_given'?'yes':type.value==='true_false_not_given'?'true':'';view.rerender();},signal);
 const form=el('form',{class:'card flex flex-col gap-3 p-4'},el('div',{},lab('type',f.questionType),type),el('div',{},lab('questionText',f.question),bind(el('textarea',{id:'questionText',class:'input min-h-[80px]',required:'','data-focus-key':'nq-text'}),'questionText')));
 if(S.type==='multiple_choice'){
  const correct=el('select',{id:'correctAnswerMcq',class:'input'});
  const refresh=()=>{const c=S.options.map(o=>o.trim()).filter(Boolean);setChildren(correct,el('option',{value:''},'—'),...c.map(o=>el('option',{value:o},o)));correct.value=c.includes(S.correct)?S.correct:'';if(correct.value==='')S.correct='';};
  const opts=S.options.map((o,i)=>{const n=el('input',{class:'input',placeholder:`Option ${i+1}`,'aria-label':`Option ${i+1}`,'data-focus-key':'nq-opt-'+i});n.value=o;listen(n,'input',()=>{S.options[i]=n.value;refresh();},signal);return n;});
  refresh();listen(correct,'change',()=>{S.correct=correct.value;},signal);
  put(form,el('div',{class:'flex flex-col gap-2'},el('span',{class:'block text-sm font-medium text-ink-700'},f.optionsFill),opts,lab('correctAnswerMcq',f.correctOptionExact),correct));
 }else if(TERNARY[S.type]){const s=el('select',{id:'correctAnswerTernary',class:'input'},TERNARY[S.type].map(([v,l])=>el('option',{value:v},l)));s.value=S.correct;listen(s,'change',()=>{S.correct=s.value;},signal);put(form,el('div',{},lab('correctAnswerTernary',f.correctAnswer),s));}
 else put(form,el('div',{},lab('correctAnswerShort',f.correctAnswerShort),bind(el('input',{id:'correctAnswerShort',class:'input',required:''}),'correct')));
 const cancel=el('button',{type:'button',class:'btn-ghost'},dict.common.cancel);listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);
 put(form,el('div',{},lab('evidenceQuote',f.evidenceQuote),bind(el('textarea',{id:'evidenceQuote',class:'input min-h-[60px]'}),'evidence')),el('div',{},lab('explanation',f.explanation),bind(el('textarea',{id:'explanation',class:'input min-h-[60px]',required:''}),'explanation')),S.error?el('p',{class:'text-sm text-band-bad',role:'alert'},S.error):null,el('div',{class:'flex gap-2'},el('button',{type:'submit',class:'btn-primary',disabled:S.pending},S.pending?dict.common.saving:dict.common.save),cancel));
 listen(form,'submit',async e=>{e.preventDefault();if(S.pending||signal.aborted||!form.checkValidity())return;S.pending=true;S.error='';view.rerender();
  try{await createQuestion(passageId,{type:S.type,questionText:S.questionText,options:S.options,correctAnswer:S.correct,evidenceQuote:S.evidence,explanation:S.explanation},signal);if(signal.aborted)return;Object.assign(S,{pending:false,open:false,questionText:'',options:['','','',''],evidence:'',explanation:''});view.rerender();await view.reload({quiet:true});}
  catch(x){if(signal.aborted)return;S.pending=false;S.error=errorText(x,dict);view.rerender();}},signal);
 return form;
}
/** Source: admin/reading/[id]/page.tsx + ResourceComposer (ported in resource-composer.js; `ctx.resourceComposer(ctx,{…})` may override it, e.g. in tests). */
export const detailMount=mountStaff({name:'management-reading-passage',roles:ROLES,notFoundBack:null,load:c=>passage(c.url.pathname.split('/').filter(Boolean).at(-1),c.signal),
 render(ctx,d,view){const {dict}=ctx;
  const composer=(ctx.resourceComposer??resourceComposer)(ctx,{ownerType:'reading',ownerId:d.passage.id,title:dict.resources.title});
  return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},BackLink({fallbackHref:'/app/admin/reading',label:dict.common.back}),el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},d.passage.title),el('p',{class:'mt-1 max-h-32 overflow-y-auto whitespace-pre-line text-sm text-ink-500'},d.passage.bodyText)),
   el('div',{class:'flex flex-col gap-2'},d.questions.map(q=>el('div',{class:'card','data-question':q.id},el('div',{class:'flex items-center justify-between'},el('span',{class:'text-sm font-medium text-ink-900'},`${q.order}. ${q.questionText}`),el('span',{class:'text-xs text-ink-300'},q.type)),el('p',{class:'mt-1 text-xs text-ink-300'},`Answer: ${q.correctAnswer}`)))),composer,newQuestionForm(ctx,d.passage.id,view));}});
