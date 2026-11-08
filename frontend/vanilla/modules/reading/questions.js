import {sourceQuestions} from './source-layout.js';
import {el} from '../../js/dom.js';
import {readingQuestionType,readingOption} from '../../js/generated/reading-lib/question-model.js';
import {buildSharedStimulus,isSharedStimulusRow,parseStimulus} from '../../js/generated/reading-lib/stimulus.js';
/** Original ReadingExam.tsx question components (GroupHeading, GroupQuestions, StimulusCard, QuestionCard), as DOM.
 * Controls keep their ids so the exam can restore focus after a redraw. */
const LABELLED=/^([A-Z])\s*[—–-]\s*(\S.*)$/;
export const lettersOnly=choices=>choices.length>0&&choices.every(c=>LABELLED.test(c));
export function constraintOf(question){
 const raw=question.answerConstraint??{};const descriptor=readingQuestionType(question.typeCode??question.type);
 return {...raw,
  max_words:raw.max_words??raw.maxWords??(descriptor?.grading==='text_word_limit'&&descriptor.answerModel.kind==='text'?descriptor.answerModel.wordLimit:undefined),
  selection_count:raw.selection_count??(descriptor?.answerModel.kind==='choice_multi'?descriptor.answerModel.count:undefined)};
}
export function ternaryChoices(question){
 const allowed=constraintOf(question).allowed_values;
 if(allowed&&allowed.length>0)return allowed.map(value=>({value:value.toLowerCase().trim().replace(/\s+/g,'_'),label:value}));
 const model=readingQuestionType(question.typeCode??question.type)?.answerModel;
 return model?.kind==='ternary'?model.choices.map(label=>({value:label.toLowerCase().replace(/\s+/g,'_'),label})):[];
}
function constraintLabel(constraint,t){
 const parts=[];
 if(typeof constraint.selection_count==='number')parts.push(t.constraintSelect.replace('{n}',String(constraint.selection_count)));
 if(typeof constraint.max_words==='number')parts.push(constraint.max_words===1?t.constraintOneWord:t.constraintWords.replace('{n}',String(constraint.max_words)));
 if(constraint.number_allowed)parts.push(t.constraintNumber);
 return parts.length?parts.join(' · '):null;
}
const inputWidth=value=>({width:`${Math.min(24,Math.max(16,value.length+3))}ch`});
/** `onChange(questionId,value)`; `focusable` is the id scheme shared with the exam's focus restore. */
export function groupHeading(dict,group){
 if(group.sourceHtml)return null;
 const range=group.displayTitle?null:group.fromQuestionNo&&group.toQuestionNo?dict.readingPractice.groupQuestions.replace('{from}',String(group.fromQuestionNo)).replace('{to}',String(group.toQuestionNo)):null;
 return el('div',{class:'rounded-[16px] border border-ink-100 bg-paper-sunken p-4','data-group-instructions':group.typeCode},
  (group.displayTitle||range)?el('p',{class:'mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500'},group.displayTitle??range):null,
  group.instructionsText?el('p',{class:'whitespace-pre-line text-sm text-ink-700'},group.instructionsText):null,
  group.sharedChoices.length>0?el('ul',{class:'mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2','data-group-choices':true},group.sharedChoices.map((choice,index)=>{const {letter,text}=readingOption(choice,index);return el('li',{class:'text-sm text-ink-700'},el('span',{class:'mr-1.5 font-semibold text-ink-900'},letter),text);})):null);
}
export function groupQuestions(context,{dict,group,questions,answers,onChange}){
 if(group.sourceHtml)return [sourceQuestions({group,questions,answers,onChange})];
 const shared=questions.filter(q=>isSharedStimulusRow(q));
 const stimulus=shared.length>0?buildSharedStimulus(shared.map(q=>({...q,questionNo:q.sourceQuestionNo??q.questionNo}))):null;
 const byNumber=new Map();for(const q of questions)if(q.questionNo!==null)byNumber.set(q.sourceQuestionNo??q.questionNo,q);
 const covered=new Set(stimulus?.numbers??[]);
 const cards=questions.filter(q=>!isSharedStimulusRow(q)||q.questionNo===null||!covered.has(q.sourceQuestionNo??q.questionNo));
 return [
  stimulus&&stimulus.numbers.length>0?stimulusCard(dict,group,stimulus,byNumber,answers,onChange):null,
  ...cards.map(q=>questionCard(context,{dict,question:q,group,value:answers[q.id]??'',onChange:v=>onChange(q.id,v),inputId:`answer-${q.id}`}))];
}
function stimulusCard(dict,group,stimulus,byNumber,answers,onChange){
 const paragraphs=stimulus.text.split(/\n{2,}/);
 return el('div',{class:'card flex flex-col p-4','data-stimulus':group.position,'data-stimulus-type':group.typeCode},
  paragraphs.map((paragraph,paragraphIndex)=>el('p',{class:`academic-text whitespace-pre-line text-sm leading-relaxed text-ink-900 ${paragraphIndex>0?'mt-3':''}`},
   parseStimulus(paragraph).map(segment=>{
    if(segment.kind==='text')return el('span',{},segment.text);
    const question=byNumber.get(segment.questionNo);
    if(!question)return el('span',{class:'mx-1 rounded-sm bg-paper-sunken px-1.5 text-xs text-ink-500'},String(segment.questionNo));
    const value=answers[question.id]??'';
    const input=el('input',{id:`answer-${question.id}`,value,placeholder:dict.reading.yourAnswer,'aria-label':`${dict.reading.yourAnswer} ${question.questionNo}`,autocomplete:'off',spellcheck:'false','data-answer-input':question.id,class:`input mx-1 inline-block w-auto min-w-[15ch] max-w-[16rem] px-2 py-1 align-baseline ${value.trim()?'border-signal-600/40':''}`,style:inputWidth(value)});
    input.addEventListener('input',()=>onChange(question.id,input.value.slice(0,200)));
    return el('span',{class:'whitespace-nowrap','data-answer-slot':question.questionNo,'data-answered':value.trim()?'true':'false'},
     el('span',{class:'mr-1 align-baseline text-xs font-semibold text-ink-500','data-stimulus-number':question.questionNo},String(question.questionNo)),input);
   }))));
}
/** One question. Rebuilt on every change; the exam restores focus to the same control afterwards. */
export function questionCard(context,{dict,question,group,value,onChange,inputId}){
 const t=dict.readingPractice,constraint=constraintOf(question),descriptor=readingQuestionType(question.typeCode??question.type),model=descriptor?.answerModel;
 const isTernary=model?.kind==='ternary',isMulti=model?.kind==='choice_multi',isText=model?.kind==='text';
 const choices=question.options&&question.options.length>0?question.options:(group?.sharedChoices??[]);
 const showFull=!isTernary&&!isMulti&&!isText&&choices.length>0&&!lettersOnly(choices);
 const showChips=!isTernary&&!isMulti&&!isText&&choices.length>0&&lettersOnly(choices);
 const hint=/(?:ONE|TWO|THREE|FOUR|[1-9])\s+WORDS?/i.test(group?.instructionsText??'')?null:constraintLabel(constraint,t);
 const number=question.questionNo??question.order;
 const parts=isText?question.questionText.split(/_{3,}/):[question.questionText];
 const inline=isText&&parts.length>1;
 const aria=`${dict.reading.yourAnswer} ${number}`;
 const textInput=(id,extra={})=>{const input=el('input',{id,value,placeholder:t.yourAnswerPlaceholder,'aria-label':aria,autocomplete:'off',spellcheck:'false','data-answer-input':question.id,class:'input',...extra});input.addEventListener('input',()=>onChange(input.value.slice(0,200)));return input;};
 const body=question.questionText.trim()===''
  ?el('p',{class:'text-sm text-ink-500'},t.chooseLetter)
  :inline
   ?el('p',{class:'text-sm leading-relaxed text-ink-900'},parts.map((part,index)=>{
      if(index===parts.length-1)return el('span',{},part);
      const input=el('input',{id:index===0?inputId:`${inputId}-${index}`,value,placeholder:dict.reading.yourAnswer,'aria-label':aria,autocomplete:'off',spellcheck:'false','data-answer-input':question.id,class:'input mx-1 inline-block w-auto min-w-[15ch] max-w-[16rem] px-2 py-1 align-baseline',style:inputWidth(value)});
      input.addEventListener('input',()=>onChange(input.value.slice(0,200)));
      return el('span',{},part,input);}))
   :el('p',{class:'whitespace-pre-line text-sm leading-relaxed text-ink-900'},question.questionText);
 const children=[];
 if(isTernary)children.push(el('div',{class:'flex flex-wrap gap-2',role:'radiogroup','aria-label':aria},ternaryChoices(question).map(choice=>{
  const button=el('button',{type:'button',role:'radio','aria-checked':value===choice.value?'true':'false','data-answer-option':choice.value,class:`min-h-[44px] rounded-sm border px-3 text-sm ${value===choice.value?'border-signal-600 bg-signal-600 font-medium text-white':'border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken'}`},choice.label);
  button.addEventListener('click',()=>onChange(value===choice.value?'':choice.value));return button;})));
 if(isMulti){const selected=value.split(/[,;]/).map(v=>v.trim()).filter(Boolean);
  children.push(el('fieldset',{class:'flex flex-col gap-2','aria-label':aria},el('legend',{class:'sr-only'},question.questionText),choices.map((choice,index)=>{
   const {letter,text}=readingOption(choice,index),checked=selected.includes(letter);
   const box=el('input',{type:'checkbox',value:letter,'data-answer-option':letter});box.checked=checked;
   box.addEventListener('change',()=>onChange((checked?selected.filter(v=>v!==letter):[...selected,letter]).join(', ')));
   return el('label',{class:'flex min-h-[44px] items-center gap-2 text-sm'},box,`${letter}: ${text}`);})));}
 if(showChips)children.push(el('div',{class:'flex flex-wrap gap-2',role:'radiogroup','aria-label':aria},choices.map((choice,index)=>{
  const {letter,text}=readingOption(choice,index),selected=value===choice;
  const button=el('button',{type:'button',role:'radio','aria-checked':selected?'true':'false','aria-label':`${letter}: ${text}`,title:text,'data-answer-option':letter,class:`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-sm border px-3 text-sm font-semibold ${selected?'border-signal-600 bg-signal-600 text-white':'border-ink-100 bg-paper-raised text-ink-700 hover:bg-paper-sunken'}`},letter);
  button.addEventListener('click',()=>onChange(selected?'':choice));return button;})));
 if(showFull)children.push(el('ul',{class:'flex flex-col gap-1.5','data-full-choices':true},choices.map((choice,index)=>{
  const {letter,text}=readingOption(choice,index),id=`${inputId}-${index}`;
  const radio=el('input',{id,type:'radio',name:inputId,value:choice});radio.checked=value===choice;
  radio.addEventListener('change',()=>onChange(choice));
  return el('li',{},el('label',{for:id,class:'flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-ink-700'},radio,el('span',{},el('span',{class:'mr-1.5 font-semibold text-ink-900'},letter),text)));})));
 if((isText||(!isTernary&&!choices.length))&&!inline)children.push(textInput(inputId));
 return el('div',{class:`card p-4 ${value.trim()?'border-signal-600/40':''}`,'data-reading-type':descriptor?.id,'data-question':question.id,'data-question-no':number,'data-answered':value.trim()?'true':'false'},
  el('div',{class:'mb-2 flex items-start gap-3'},
   el('span',{class:'mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paper-sunken px-1.5 text-xs font-semibold text-ink-700'},String(number)),
   el('div',{class:'min-w-0 flex-1'},body,hint?el('p',{class:'mt-1 text-xs text-ink-300'},hint):null)),
  ...children);
}
