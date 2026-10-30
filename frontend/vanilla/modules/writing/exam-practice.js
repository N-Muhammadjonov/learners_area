import {el,button,words} from './shared.js';
import {attachExamImageZoom} from './exam-picker.js';

const duration=seconds=>{
 const s=Math.max(0,Math.floor(seconds));
 const h=Math.floor(s/3600),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),sec=String(s%60).padStart(2,'0');
 return h?`${h}:${m}:${sec}`:`${m}:${sec}`;
};

/** Client-only practice: no writing exam paper is started or submitted. */
export function mountExamPractice(ctx,host,question,onBack){
 const uz=ctx.locale==='uz',signal=ctx.signal;
 const task=question.taskType==='task1'?'Task 1':'Task 2',min=question.taskType==='task1'?150:250;
 const started=performance.now();let done=false,disposed=false;
 const timer=el('output',{role:'timer','aria-live':'off','data-practice-timer':'',class:'font-display text-2xl tabular-nums text-ink-900','aria-label':uz?'Mashq vaqti':'Practice elapsed time'},'00:00');
 const textarea=el('textarea',{class:'input min-h-[24rem] flex-1 resize-y text-base leading-relaxed','data-practice-editor':'',spellcheck:'false',autocorrect:'off',autocapitalize:'off',autocomplete:'off',maxlength:'20000','aria-label':uz?'Javobingiz':'Your answer'});
 const counter=el('span',{class:'text-sm text-ink-500','data-practice-words':''});
 const note=el('p',{role:'status',class:'text-sm text-ink-500','data-practice-status':''});
 const updateWords=()=>{const n=words(textarea.value);counter.textContent=`${n} ${uz?'so‘z':'words'} · ${uz?'kamida':'minimum'} ${min}`;};
 const updateTimer=()=>{if(!disposed&&!done)timer.textContent=duration((performance.now()-started)/1000);};
 const interval=setInterval(updateTimer,250);
 const cleanup=()=>{if(disposed)return;disposed=true;clearInterval(interval);};
 signal.addEventListener('abort',cleanup,{once:true});
 function exit(){
  if(!done&&textarea.value.trim()&&!confirm(uz?'Mashqni tark etsangiz yozgan javobingiz saqlanmaydi. Chiqilsinmi?':'Your practice answer is not saved. Exit practice?'))return;
  cleanup();onBack();
 }
 const leave=button(uz?'Mashqdan chiqish':'Exit practice',exit,{signal,cls:'btn-secondary min-h-11',attrs:{'data-practice-exit':''}});
 const finish=button(uz?'Mashqni yakunlash':'Finish practice',()=>{
  if(done)return;updateTimer();done=true;clearInterval(interval);textarea.readOnly=true;finish.disabled=true;
  note.textContent=uz?'Mashq yakunlandi. Javobingiz shu oynada qoladi.':'Practice finished. Your answer remains visible until you exit.';
 },{signal,cls:'btn-primary min-h-11',attrs:{'data-practice-finish':''}});
 const toolbar=el('div',{class:'sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-paper-raised px-4 py-3 shadow-sm'},
  timer,counter,el('span',{class:'text-sm font-semibold text-ink-900'},uz?'Practice · vaqt cheklanmagan':'Practice · untimed'),
  el('div',{class:'ml-auto flex flex-wrap gap-2'},leave,finish));
 const questionPane=el('section',{class:'card exam-question-pane'},
  el('p',{class:'text-xs font-semibold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400'},`${uz?'Savol':'Question'} · ${task}`),
  el('p',{class:'whitespace-pre-line text-base leading-relaxed text-ink-900'},question.prompt),
  el('p',{class:'text-sm text-ink-500'},`${uz?'Kamida':'Minimum'} ${min} ${uz?'so‘z':'words'}`));
 if(question.image?.objectKey){
  const imageHost=el('div',{'data-exam-materials':''});
  const image=el('img',{src:'/api/resources/'+question.image.objectKey,alt:question.image.name??question.title??task,class:'writing-original-image',loading:'eager',decoding:'async'});
  imageHost.append(el('div',{class:'writing-image-frame'},image));questionPane.append(imageHost);
  attachExamImageZoom(ctx,imageHost);
 }
 const answerPane=el('section',{class:'card exam-answer-pane'},
  el('label',{class:'text-sm font-semibold text-ink-900',htmlFor:'practice-writing-answer'},uz?'Javobingiz':'Your answer'),
  textarea,el('p',{class:'text-sm text-ink-500'},uz?'Vaqt oldinga sanaladi. Javob serverga yuborilmaydi.':'Timer counts up. Your answer is not submitted to the server.'));
 textarea.id='practice-writing-answer';
 textarea.addEventListener('input',updateWords,{signal});
 host.replaceChildren(el('section',{'data-exam-runner':'','data-writing-practice':question.taskType,class:'flex flex-col gap-4'},
  toolbar,note,el('div',{class:'exam-writing-workspace'},questionPane,answerPane)));
 updateWords();
}
