import {el as node} from '../../js/dom.js';
import {bindCdPaper,questionNumber} from './cd-paper.js';
import {positionExamBrand} from './authored-ui.js';
import {isolatedListeningStyle} from './source-style.js';

function el(tag,{onclick,...attributes}={},...children){
 const element=node(tag,attributes,...children);
 if(onclick)element.addEventListener('click',onclick);
 return element;
}

const VIEW_STYLE = `
.la-exam-scroll{height:100%;overflow:auto;overscroll-behavior:contain}
.la-exam-scroll .exam-header{top:0}
.la-exam-scroll :is(.loading-screen,.start-screen){inset:0}
.la-exam-scroll .exam-interface{min-height:100%}
.la-exam-scroll [data-listening-source-question]{scroll-margin-top:70px}
.la-exam-feedback{padding:0 18px;font-size:13px;color:#555}
.la-exam-feedback:empty{display:none}
`;

const formatTime=seconds=>{
 const remaining=Math.max(0,Math.ceil(seconds));
 return Math.floor(remaining/60)+':'+String(remaining%60).padStart(2,'0');
};

function readWorkspace(raw){
 try{
  const saved=JSON.parse(raw);
  if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
   return {
    notes:Object.fromEntries(Object.entries(saved.notes??{}).filter(([q,value])=>/^([1-9]|[1-3]\d|40)$/.test(q)&&typeof value==='string')),
    flags:Array.isArray(saved.flags)?saved.flags.filter(q=>Number.isInteger(q)&&q>=1&&q<=40):[],
    question:Number.isInteger(saved.question)&&saved.question>=1&&saved.question<=40?saved.question:1,
    reviewUntil:Number.isFinite(saved.reviewUntil)&&saved.reviewUntil<=Date.now()+120000?saved.reviewUntil:0,
   };
  }
 }catch{}
 return {notes:raw?{'1':raw}:{},flags:[],question:1,reviewUntil:0};
}

export function authoredCdView(data,{questions,imageUrl,notes,saveWorkspace,signal}){
 const workspace=readWorkspace(notes),flags=new Set(workspace.flags);
 const surface=el('div',{'data-listening-cd-exam':'','data-listening-attempt-mode':'full_exam'});
 // Site-wide CSS, day/night, locale and profile styles must never change the
 // internal interface of any Listening test (1–32). Each source keeps its own CSS.
 // Shadow DOM blocks outside selectors; the host reset also blocks inherited typography.
 const shadow=surface.attachShadow({mode:'open'});
 const stage=el('div',{class:'la-listening-source la-exam-scroll'});
 const template=document.createElement('template');
 template.innerHTML=data.shell;
 positionExamBrand(template.content);
 stage.append(template.content);
 // The original document's body defaults belong to this scroll surface, not the site body.
 shadow.append(el('style',{},isolatedListeningStyle(data.style)+VIEW_STYLE),stage);
 const get=id=>shadow.getElementById(id);
 const root=get('examRoot'),paper=get('examQuestionHost'),startScreen=get('startScreen'),start=get('startTestBtn');
 const frame=get('examInterface'),nav=get('bottomNav'),noteModal=get('noteModal'),note=get('noteTextarea');
 const flag=get('flagBtn'),status=get('examStatus'),volume=get('volumeSlider');
 const alert=el('p',{role:'alert',class:'la-exam-feedback'}),saveStatus=el('p',{role:'status',class:'la-exam-feedback'});
 frame.querySelector('.exam-header').after(alert,saveStatus);
 const startAlert=el('p',{role:'alert',class:'la-exam-feedback'});
 start.after(startAlert);
 const loadingScreen=get('loadingScreen');
 const modalCard=el('div',{class:'modal-card'});
 const modal=el('div',{class:'modal hidden',role:'dialog','aria-modal':'true'},modalCard);
 root.append(modal);
 let scope,question=workspace.question,part=0,returnFocus,activeModal;
 let previousAnswers,needsPaper=true,reviewUntil=workspace.reviewUntil,reviewSent=false;
 const highlights=new Map();
 const partOf=q=>Math.ceil(q/10);
 const persist=()=>saveWorkspace(JSON.stringify({notes:workspace.notes,flags:[...flags],question,reviewUntil}));
 function bind(id,event,handler){get(id).addEventListener(event,handler,{signal});}
 function focusModal(node,trigger){
  activeModal=node;
  returnFocus=trigger;
  node.classList.remove('hidden');
  node.querySelector('textarea,button')?.focus();
 }
 function closeModal(){
  activeModal?.classList.add('hidden');
  activeModal=null;
  returnFocus?.focus();
 }
 function showOptions(){
  const choiceRow=(title,description,labels,onChange)=>{
   const choices=el('div',{class:'choice-buttons'},labels.map(([value,label])=>
    el('button',{type:'button',onclick:()=>onChange(value)},label)));
   return el('div',{class:'option-row'},el('span',{},el('b',{},title),el('br'),el('small',{},description)),choices);
  };
  modal.setAttribute('aria-label','Options');
  modalCard.replaceChildren(el('h2',{},'Options'),
   choiceRow('Contrast','Choose a display mode',[['','Black on white'],['contrast-whiteblack','White on black'],['contrast-yellowblack','Yellow on black']],value=>{
    root.classList.remove('contrast-whiteblack','contrast-yellowblack');if(value)root.classList.add(value);
   }),
   choiceRow('Text size','Adjust question text',['Small','Medium','Large','Extra large'].map((label,i)=>[['size-small','size-medium','size-large','size-xlarge'][i],label]),value=>{
    root.classList.remove('size-small','size-medium','size-large','size-xlarge');root.classList.add(value);
   }),el('div',{style:{textAlign:'right',marginTop:'14px'}},el('button',{class:'btn primary',type:'button',onclick:closeModal},'Done')));
  focusModal(modal,get('optionsBtn'));
 }
 function openSubmit(){
  modal.setAttribute('aria-label','Submit Test');
  modalCard.replaceChildren(el('h2',{},'Submit Test'),el('p',{},'Submit this test and open Review & Revision?'),
   el('div',{class:'choice-buttons'},
    el('button',{type:'button',onclick:closeModal},'Keep working'),
    el('button',{type:'button',class:'btn primary',onclick:()=>{closeModal();void scope.submit();}},'Submit Test')));
  focusModal(modal,get('submitTest'));
 }
 function paintAnswers(answers=scope?.answers){
  if(!scope)return;
  scope.answers=previousAnswers=answers;
  for(const q of questions){
   const button=nav.querySelector('[data-qnav="'+q.number+'"]');
   const answered=!!scope.answers[q.id]?.trim(),flagged=flags.has(q.number),noted=!!workspace.notes[q.number];
   button.classList.toggle('answered',answered);
   button.classList.toggle('flagged',flagged);
   button.classList.toggle('noted',noted);
   button.classList.toggle('current',q.number===question);
   button.setAttribute('aria-current',q.number===question?'step':'false');
   button.setAttribute('aria-label','Question '+q.number+(answered?', answered':'')+(flagged?', flagged':''));
  }
  const flagged=flags.has(question);
  flag.classList.toggle('active',flagged);
  flag.setAttribute('aria-pressed',String(flagged));
  flag.textContent=flagged?'⚑ Flagged':'⚑ Flag';
 }
 function rememberHighlights(){
  highlights.set(part,[...paper.querySelectorAll('mark.user-highlight')].map(mark=>mark.textContent).filter(Boolean));
 }
 function restoreHighlights(){
  for(const word of highlights.get(part)??[]){
   const walker=document.createTreeWalker(paper,NodeFilter.SHOW_TEXT);
   for(let text=walker.nextNode();text;text=walker.nextNode()){
    const index=text.data.indexOf(word);
    if(index<0||text.parentElement.closest('mark,button,option,textarea'))continue;
    const range=document.createRange();range.setStart(text,index);range.setEnd(text,index+word.length);
    range.surroundContents(el('mark',{class:'user-highlight'}));break;
   }
  }
 }
 function showPart(next,requested=(next-1)*10+1,focus=false){
  question=requested;
  if(part!==next||needsPaper){
   part=next;needsPaper=false;
   const fragment=document.createElement('template');
   fragment.innerHTML=data.parts[part-1];
   for(const img of fragment.content.querySelectorAll('img')){
    img.referrerPolicy='no-referrer';
    if(imageUrl)img.src=imageUrl;
   }
   paper.replaceChildren(fragment.content);
   bindCdPaper(paper,questions.filter(q=>q.section===part),scope.answers,scope.change);
   restoreHighlights();
   get('examPartTitle').textContent='SECTION '+part;
   get('examPartDesc').textContent='Questions '+((part-1)*10+1)+'-'+(part*10)+' · '+data.sections[part-1];
   for(const group of nav.querySelectorAll('[data-qgroup]'))group.classList.toggle('hidden',Number(group.dataset.qgroup)!==part);
   for(const button of nav.querySelectorAll('[data-part]')){
    const active=Number(button.dataset.part)===part;
    button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
   }
   stage.scrollTop=0;
  }
  paintAnswers();persist();
  if(focus){
   const control=paper.querySelector('[data-listening-source-question="'+question+'"],#q'+question+',input[name="q'+question+'"]');
   const anchor=control??paper.querySelector('[data-q="'+question+'"],[data-qnum="'+question+'"]');
   anchor?.scrollIntoView?.({behavior:'smooth',block:'center'});
   control?.focus?.({preventScroll:true});
  }
 }
 const parts=el('div',{class:'parts-navigation'});
 for(let p=1;p<=4;p++){
  const partButton=el('button',{type:'button',class:'part-button','data-part':p,onclick:()=>showPart(p)},'Part '+p);
  const numbers=el('div',{class:'question-numbers','data-qgroup':p});
  for(const q of questions.filter(q=>q.section===p)){
   numbers.append(el('button',{type:'button',class:'question-number','data-qnav':q.number,
    onclick:()=>showPart(p,q.number,true)},q.number));
  }
  parts.append(el('div',{class:'part-nav-item'},partButton,numbers));
 }
 nav.append(parts,
  el('button',{type:'button',class:'nav-arrow',id:'prevPart','aria-label':'Previous part',onclick:()=>showPart(Math.max(1,part-1))},'‹'),
  el('button',{type:'button',class:'nav-arrow',id:'nextPart','aria-label':'Next part',onclick:()=>showPart(Math.min(4,part+1))},'›'));
 function selectQuestion(event){
  const selected=questionNumber(event.target);
  if(!selected||partOf(selected)!==part||selected===question)return;
  question=selected;paintAnswers();persist();
 }
 paper.addEventListener('focusin',selectQuestion,{signal});
 paper.addEventListener('click',selectQuestion,{signal});
 bind('startTestBtn','click',()=>void scope.play());
 volume.value='1';
 bind('volumeSlider','input',()=>{scope.audio.volume=Number(volume.value);});
 bind('flagBtn','click',()=>{if(flags.has(question))flags.delete(question);else flags.add(question);paintAnswers();persist();});
 bind('notesBtn','click',()=>{
  get('noteQuestionLabel').textContent='Question '+question;
  note.value=workspace.notes[question]??'';
  get('noteSaved').textContent='';
  focusModal(noteModal,get('notesBtn'));note.focus();
 });
 note.maxLength=1000;
 bind('noteTextarea','input',()=>{
  workspace.notes[question]=note.value;
  get('noteSaved').textContent='Saved';
  paintAnswers();persist();
 });
 bind('clearNoteBtn','click',()=>{note.value='';delete workspace.notes[question];get('noteSaved').textContent='';paintAnswers();persist();});
 for(const button of ['closeNotesBtn','doneNotesBtn'])bind(button,'click',closeModal);
 for(const overlay of [noteModal,modal])overlay.addEventListener('click',event=>{if(event.target===overlay)closeModal();},{signal});
 bind('optionsBtn','click',showOptions);
 bind('fullscreenBtn','click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await surface.requestFullscreen();}
  catch{alert.textContent='Fullscreen is not available';}
 });
 bind('submitTest','click',openSubmit);
 bind('highlightBtn','mousedown',event=>event.preventDefault());
 bind('highlightBtn','click',()=>{
  const selection=shadow.getSelection?.()??window.getSelection();
  if(!selection?.rangeCount||!selection.toString().trim())return;
  const range=selection.getRangeAt(0);
  if(!paper.contains(range.commonAncestorContainer))return;
  try{range.surroundContents(el('mark',{class:'user-highlight'}));selection.removeAllRanges();rememberHighlights();}catch{}
 });
 bind('removeHighlightBtn','click',()=>{for(const mark of paper.querySelectorAll('mark.user-highlight'))mark.replaceWith(...mark.childNodes);highlights.delete(part);});
 shadow.addEventListener('keydown',event=>{
  if(!activeModal)return;
  if(event.key==='Escape'){event.preventDefault();closeModal();return;}
  if(event.key!=='Tab')return;
  const focusable=[...activeModal.querySelectorAll('textarea,button:not([disabled])')];
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&shadow.activeElement===first){event.preventDefault();last?.focus();}
  if(!event.shiftKey&&shadow.activeElement===last){event.preventDefault();first?.focus();}
 },{signal});
 function paintTime(position,duration){
  if(!scope)return;
  const seconds=reviewUntil?(reviewUntil-Date.now())/1000:duration-position;
  get('timerDisplay').textContent=formatTime(seconds);
  if(reviewUntil){
   if(!status.firstElementChild)status.replaceChildren(el('span',{class:'review-phase'},'Final review'));
   if(seconds<=0&&!reviewSent&&!scope.busy&&!scope.conflict){reviewSent=true;void scope.submit();}
  }
 }
 function beginReview(){
  if(!scope||reviewUntil)return;
  reviewUntil=Date.now()+120000;
  persist();paintTime(scope.position,scope.duration);
 }
 const timer=setInterval(()=>{if(reviewUntil)paintTime(scope.position,scope.duration);},1000);
 signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
 return {
  surface,paintAnswers,paintTime,beginReview,
  update(next){
   const first=!scope;
   const recovering=scope&&next.answers!==previousAnswers;
   scope=next;previousAnswers=next.answers;
   if(recovering)needsPaper=true;
   if(first||needsPaper)showPart(partOf(question),question);
   const waiting=next.preparing||next.loading&&!next.entered;
   loadingScreen.classList.toggle('hidden',!waiting);
   startScreen.classList.toggle('hidden',waiting||next.entered);
   frame.classList.toggle('hidden',!next.entered);
   start.textContent=next.started||next.position>0?'Resume Test':'Start Test';
   start.disabled=waiting||next.busy;
   if(next.audio)volume.value=String(next.audio.volume);
   get('submitTest').disabled=next.busy||next.conflict;
   alert.replaceChildren(next.error);
   startAlert.textContent=next.error;
   if(!reviewUntil)status.textContent=next.playing?'Audio plays once':next.loading?'Loading audio…':'Audio ready';
   if(next.entered&&!next.playing&&!next.loading&&next.error&&!reviewUntil){
    alert.append(' ',el('button',{class:'exam-icon action-label',type:'button',onclick:()=>void scope.play()},'Retry audio'));
   }
   saveStatus.textContent=next.saved;
   if(next.entered&&next.duration>0&&next.position>=next.duration-.25)beginReview();
   paintTime(next.position,next.duration);
  },
  saveStatus(message){saveStatus.textContent=message;},
 };
}
