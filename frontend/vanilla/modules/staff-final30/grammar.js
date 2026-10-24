import {el,listen,mountStaff,BackLink,errorText,fill,setChildren} from './kit.js';
import {topics,topic,createTopic,createExercise,parseGrammarBundle,importGrammar} from '../../js/adapters/staff-final30/grammar.js';
const ROLES=['admin','owner'];
/** Source: admin/grammar/page.tsx + NewTopicForm + GrammarImport. */
function newTopicForm(ctx,view){
 const {dict,signal,navigate}=ctx,f=dict.formCopy,S=(ctx.state.newTopic??={open:false,skillArea:'writing',title:'',explanation:'',pending:false,error:''});
 if(!S.open){const b=el('button',{type:'button',class:'btn-secondary','data-new-topic':''},`+ ${dict.admin.newTopic}`);listen(b,'click',()=>{S.open=true;view.rerender();},signal);return b;}
 const lab=(id,t)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},t);
 const area=el('select',{id:'skillArea',class:'input'},el('option',{value:'writing'},f.writing),el('option',{value:'speaking'},f.speaking));area.value=S.skillArea;listen(area,'change',()=>{S.skillArea=area.value;},signal);
 const title=el('input',{id:'title',class:'input',required:'','data-focus-key':'nt-title'});title.value=S.title;listen(title,'input',()=>{S.title=title.value;},signal);
 const expl=el('textarea',{id:'explanation',class:'input',required:''});expl.value=S.explanation;listen(expl,'input',()=>{S.explanation=expl.value;},signal);
 const cancel=el('button',{type:'button',class:'btn-ghost',disabled:S.pending},dict.common.cancel);listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);
 const form=el('form',{class:'card flex flex-col gap-3 p-4'},el('div',{},lab('skillArea',f.skillArea),area),el('div',{},lab('title',f.title),title),el('div',{},lab('explanation',f.explanation),expl),S.error?el('p',{role:'alert',class:'text-sm text-band-bad'},S.error):null,el('div',{class:'flex gap-2'},el('button',{type:'submit',class:'btn-primary',disabled:S.pending},S.pending?dict.common.saving:dict.common.save),cancel));
 listen(form,'submit',async e=>{e.preventDefault();if(S.pending||signal.aborted||!form.checkValidity())return;S.pending=true;S.error='';view.rerender();
  try{const r=await createTopic({skillArea:S.skillArea,title:S.title,explanation:S.explanation},signal);if(signal.aborted)return;S.pending=false;
   if(typeof r?.id==='string'){Object.assign(S,{open:false,title:'',explanation:''});void navigate(`/app/admin/grammar/${r.id}`);}else{S.error=dict.apiErrors.generic;view.rerender();}}
  catch(x){if(signal.aborted)return;S.pending=false;S.error=errorText(x,dict);view.rerender();}},signal);
 return form;
}
function importPanel(ctx,view){
 const {dict,signal}=ctx,t=dict.grammar,S=(ctx.state.grammarImport??={text:'',pending:false,preview:null,message:''});
 const ta=el('textarea',{class:'input min-h-32',maxlength:'500000',disabled:S.pending,'data-focus-key':'gi-text'});ta.value=S.text;
 listen(ta,'input',()=>{S.text=ta.value;S.preview=null;S.message='';view.rerender();},signal);
 async function submit(dry){if(S.pending||signal.aborted||(!dry&&S.preview!==S.text))return;const bundle=parseGrammarBundle(S.text);if(!bundle){S.message=dict.apiErrors.invalid;view.rerender();return;}
  S.pending=true;S.message='';view.rerender();
  try{const r=await importGrammar(bundle,dry,signal);if(signal.aborted)return;S.pending=false;S.preview=dry?S.text:null;S.message=fill(dry?t.importPreview:t.importSaved,{topics:r.topics,exercises:r.exercises});if(!dry){S.text='';await view.reload({quiet:true});}view.rerender();}
  catch(x){if(signal.aborted)return;S.pending=false;S.preview=null;S.message=errorText(x,dict);view.rerender();}}
 const validate=el('button',{type:'button',class:'btn-secondary',disabled:S.pending||!S.text.trim(),'data-grammar-validate':''},S.pending?dict.common.saving:t.importValidate);listen(validate,'click',()=>void submit(true),signal);
 const apply=S.preview===S.text&&S.text?el('button',{type:'button',class:'btn-primary',disabled:S.pending,'data-grammar-apply':''},t.importApply):null;if(apply)listen(apply,'click',()=>void submit(false),signal);
 return el('section',{class:'card space-y-3 p-4','data-grammar-import':''},el('h2',{class:'font-display text-lg'},t.importTitle),el('p',{class:'text-sm text-ink-500'},`${t.importHelp} `,el('a',{href:'/content/grammar-foundation-original.json',download:'',class:'underline'},t.importExample)),el('label',{class:'flex flex-col gap-1 text-sm'},t.importSource,ta),el('div',{class:'flex flex-wrap gap-2'},validate,apply),S.message?el('p',{role:'status',class:'text-sm'},S.message):null);
}
export const listMount=mountStaff({name:'management-grammar',roles:ROLES,load:c=>topics(c.signal),
 render(ctx,data,view){const {dict}=ctx;return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},el('div',{class:'flex items-center justify-between'},el('h1',{class:'font-display text-2xl text-ink-900'},dict.admin.grammarTitle),newTopicForm(ctx,view)),importPanel(ctx,view),
  el('div',{class:'flex flex-col gap-2'},data.topics.map(t=>el('a',{href:`/app/admin/grammar/${t.id}`},el('div',{class:'card flex items-center justify-between hover:border-signal-400'},el('span',{class:'text-sm font-medium text-ink-900'},t.title),el('span',{class:'text-xs text-ink-300'},t.skillArea))))));}});
function newExerciseForm(ctx,topicId,view){
 const {dict,signal}=ctx,f=dict.formCopy,S=(ctx.state.newExercise??={open:false,promptText:'',options:['','','',''],correct:'',explanation:'',pending:false,error:''});
 if(!S.open){const b=el('button',{type:'button',class:'btn-secondary','data-new-exercise':''},`+ ${dict.admin.newExercise}`);listen(b,'click',()=>{S.open=true;view.rerender();},signal);return b;}
 const clean=S.options.map(o=>o.trim()).filter(Boolean),lab=(id,t)=>el('label',{for:id,class:'mb-1.5 block text-sm font-medium text-ink-700'},t);
 const prompt=el('textarea',{id:'promptText',class:'input min-h-[60px]',required:'','data-focus-key':'ne-prompt'});prompt.value=S.promptText;listen(prompt,'input',()=>{S.promptText=prompt.value;},signal);
 const optNodes=S.options.map((o,i)=>{const n=el('input',{class:'input',placeholder:`Option ${i+1}`,'data-focus-key':'ne-opt-'+i,'aria-label':`Option ${i+1}`});n.value=o;listen(n,'input',()=>{S.options[i]=n.value;},signal);listen(n,'input',()=>refreshCorrect(),signal);return n;});
 const correct=el('select',{id:'correctOption',class:'input'});function refreshCorrect(){const c=S.options.map(o=>o.trim()).filter(Boolean);setChildren(correct,el('option',{value:''},'—'),...c.map(o=>el('option',{value:o},o)));correct.value=c.includes(S.correct)?S.correct:'';if(correct.value==='')S.correct='';}refreshCorrect();listen(correct,'change',()=>{S.correct=correct.value;},signal);
 const expl=el('textarea',{id:'explanation',class:'input min-h-[60px]',required:''});expl.value=S.explanation;listen(expl,'input',()=>{S.explanation=expl.value;},signal);
 const cancel=el('button',{type:'button',class:'btn-ghost',disabled:S.pending},dict.common.cancel);listen(cancel,'click',()=>{S.open=false;view.rerender();},signal);
 const form=el('form',{class:'card flex flex-col gap-3 p-4'},el('div',{},lab('promptText',f.sentenceWithError),prompt),el('div',{class:'flex flex-col gap-2'},el('span',{class:'block text-sm font-medium text-ink-700'},f.options),optNodes),el('div',{},lab('correctOption',f.correctOptionExact),correct),el('div',{},lab('explanation',f.explanation),expl),S.error?el('p',{class:'text-sm text-band-bad',role:'alert'},S.error):null,el('div',{class:'flex gap-2'},el('button',{type:'submit',class:'btn-primary',disabled:S.pending},S.pending?dict.common.saving:dict.common.save),cancel));
 listen(form,'submit',async e=>{e.preventDefault();if(S.pending||signal.aborted||!form.checkValidity())return;S.pending=true;S.error='';view.rerender();
  try{await createExercise(topicId,{promptText:S.promptText,options:S.options,correctOption:S.correct,explanation:S.explanation},signal);if(signal.aborted)return;Object.assign(S,{pending:false,open:false,promptText:'',options:['','','',''],correct:'',explanation:''});view.rerender();await view.reload({quiet:true});}
  catch(x){if(signal.aborted)return;S.pending=false;S.error=errorText(x,dict);view.rerender();}},signal);
 return form;
}
export const detailMount=mountStaff({name:'management-grammar-topic',roles:ROLES,notFoundBack:null,load:c=>topic(c.url.pathname.split('/').filter(Boolean).at(-1),c.signal),
 render(ctx,d,view){const {dict}=ctx;return el('div',{class:'mx-auto flex max-w-3xl flex-col gap-4'},BackLink({fallbackHref:'/app/admin/grammar',label:dict.common.back}),el('div',{},el('h1',{class:'font-display text-2xl text-ink-900'},d.topic.title),el('p',{class:'text-sm text-ink-500'},d.topic.explanation)),
  el('div',{class:'flex flex-col gap-2'},d.exercises.map(x=>el('div',{class:'card','data-exercise':x.id},el('p',{class:'text-sm font-medium text-ink-900'},`${x.order}. ${x.promptText}`),el('p',{class:'mt-1 text-xs text-band-good'},`Correct: ${x.correctOption}`)))),newExerciseForm(ctx,d.topic.id,view));}});
