/** Own exam UI recovery only. Canonical grading remains in originalExamPolicy/parent/server. */
export function examDraft(value, attemptKey, now = Date.now()) {
 if (!value || value.attemptKey !== attemptKey || !attemptKey) return null;
 const question = Number.isInteger(value.question) && value.question >= 1 && value.question <= 40 ? value.question : 1;
 const deadline = Number.isFinite(value.reviewDeadline) && value.reviewDeadline > 0 && value.reviewDeadline <= now + 120000 ? value.reviewDeadline : null;
 return {attemptKey, question, reviewDeadline: deadline};
}
export function originalExamWorkflow() {return `(()=>{
 const readDraft=${examDraft.toString()},draftKey='la-original-exam-v13';
 document.addEventListener('DOMContentLoaded',()=>{
 if(typeof startExam!=='function'||typeof state==='undefined'||!document.getElementById('examQuestionHost'))return;
 let reviewDeadline=null,awaiting=false,saveSecond=-1,returnFocus=null,disposed=false;
 const audio=()=>document.getElementById('sharedAudio');
 const identity=()=>window.laAttemptKey||getStored().attemptKey;
 const draft=()=>{try{return readDraft(JSON.parse(localStorage.getItem(draftKey)||'null'),identity());}catch{return null;}};
 const remember=()=>{if(!identity())return;localStorage.setItem(draftKey,JSON.stringify({attemptKey:identity(),question:state.currentQ,reviewDeadline}));};
 const oldSave=saveStored;saveStored=function(){remember();return oldSave();};
 const oldBegin=beginExamTimer;
 const oldStart=startExam;startExam=function(){
 if(disposed||awaiting||state.examStarted){if(awaiting)toast('Wait for the server result before starting another attempt.');return;}
 const saved=state.attemptStatus==='in_progress'?draft():null;
 reviewDeadline=saved?.reviewDeadline??null;saveSecond=-1;
 // Final review is silent. Do not start the private recording even briefly on resume.
 const a=audio(),play=a.play;
 if(reviewDeadline)a.play=()=>Promise.resolve();
 try{oldStart();}finally{if(reviewDeadline)a.play=play;}
 if(saved){state.currentQ=saved.question;renderExamPart(Math.ceil(saved.question/10));}
 if(reviewDeadline){state.reviewPhase=true;state.reviewRemaining=Math.max(0,Math.ceil((reviewDeadline-Date.now())/1000));a.pause();$('#examStatus').innerHTML='<span class="review-phase">Final review</span>';}
 $('#timerDisplay').textContent=fmt(reviewDeadline?Math.max(0,Math.ceil((reviewDeadline-Date.now())/1000)):state.examRemaining);
 remember();focusQuestion(state.currentQ);
 if(reviewDeadline&&reviewDeadline<=Date.now())tickExam();
 };
 const startButton=document.getElementById('startTestBtn');if(startButton)startButton.onclick=()=>startExam();
 // Match the source listening countdown, but use elapsed wall time rather than
 // number of interval callbacks (background tabs throttle those callbacks).
 let lastTick=null;
 beginExamTimer=function(){if(disposed||!state.examStarted||state.submitted)return;lastTick=Date.now();oldBegin();};
 tickExam=function(){
 if(disposed||!state.examStarted||state.submitted)return;
 const now=Date.now(),elapsed=lastTick===null?1:Math.max(0,(now-lastTick)/1000);lastTick=now;
 if(!state.reviewPhase){
 const excess=Math.max(0,elapsed-state.examRemaining);state.examRemaining=Math.max(0,state.examRemaining-elapsed);
 if(state.examRemaining<=0||audio().ended){state.reviewPhase=true;reviewDeadline=now+120000-excess*1000;audio().pause();$('#examStatus').innerHTML='<span class="review-phase">Final review</span>';saveStored();}
 }
 if(state.reviewPhase){reviewDeadline??=now+120000;state.reviewRemaining=Math.max(0,Math.ceil((reviewDeadline-now)/1000));$('#timerDisplay').textContent=fmt(state.reviewRemaining);if(state.reviewRemaining<=0){submitExam(true);return;}}
 else $('#timerDisplay').textContent=fmt(state.examRemaining);
 const second=Math.floor(now/5000);if(second!==saveSecond){saveSecond=second;saveStored();}
 };
 const oldSubmit=submitExam;submitExam=function(auto=false){if(disposed||!state.examStarted||state.submitted||awaiting)return;return oldSubmit(auto);};
 const oldSnapshot=snapshotAttempt;snapshotAttempt=function(status){awaiting=true;reviewDeadline=null;return oldSnapshot(status);};
 addEventListener('la-checkpoint',event=>{let v;try{v=JSON.parse(event.detail?.[STORAGE_KEY]||'{}');}catch{return;}
 if(v.attemptKey===identity()&&['submitted','exited'].includes(v.attemptStatus)&&v.lastResults?.length===40)awaiting=false;
 });
 const oldFocus=focusQuestion;focusQuestion=function(q){oldFocus(q);setTimeout(()=>{
 if(disposed||!state.examStarted||state.currentQ!==q||document.querySelector('#noteModal:not(.hidden),#globalModal:not(.hidden)'))return;
 const host=$('#examQuestionHost'),control=host.querySelector('#q'+q+',input[name="q'+q+'"]:checked')||host.querySelector('input[name="q'+q+'"]')||host.querySelector('[data-q="'+q+'"],[data-qnum="'+q+'"]');
 if(control){if(!control.matches('input,select,textarea,button'))control.tabIndex=-1;control.focus({preventScroll:true});}
 },50);};
 const decorate=()=>{
 document.querySelectorAll('#examQuestionHost input,#examQuestionHost select').forEach(input=>{
 const match=/^q([0-9]+)$/.exec(input.id||input.name);if(!match)return;
 if(!input.getAttribute('aria-label')&&!input.labels?.length)input.setAttribute('aria-label','Answer for question '+match[1]);
 if(input.type==='text')input.maxLength=500;
 });
 document.querySelectorAll('[data-qnav]').forEach(button=>{button.setAttribute('aria-current',Number(button.dataset.qnav)===state.currentQ?'step':'false');button.setAttribute('aria-label','Question '+button.dataset.qnav+(button.classList.contains('answered')?', answered':'')+(button.classList.contains('flagged')?', flagged':''));});
 };
 const oldRender=renderExamPart;renderExamPart=function(part){oldRender(part);decorate();if(state.examStarted)remember();};
 const oldNav=updateNav;updateNav=function(){oldNav();decorate();};
 // Native source handlers are assigned before this wrapper; delegate in capture
 // phase, then restore paired controls after their original change handler ran.
 document.addEventListener('focusin',event=>{const input=event.target;if(!input.closest?.('#examQuestionHost'))return;const match=/^q([0-9]+)$/.exec(input.id||input.name);if(match){state.currentQ=Number(match[1]);updateNav();remember();}});
 document.addEventListener('change',event=>{if(event.target.closest?.('#examQuestionHost'))queueMicrotask(()=>{restoreExamInputs();remember();});});
 document.addEventListener('click',event=>{if(event.target.closest?.('[data-part],[data-qnav],#prevPart,#nextPart'))queueMicrotask(()=>{if(state.examStarted)saveStored();});},true);
 // Retain source dialogs, with keyboard containment and focus restoration.
 const visibleModal=()=>['noteModal','globalModal'].map(id=>document.getElementById(id)).find(node=>node&&!node.classList.contains('hidden'));
 const oldModal=showModal;showModal=function(html){returnFocus=document.activeElement;oldModal(html);const modal=document.getElementById('globalModal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',modal.querySelector('h2')?.textContent||'Options');modal.querySelector('button,input,textarea,select')?.focus();};
 const oldClose=closeModal;closeModal=function(){oldClose();if(returnFocus?.isConnected)returnFocus.focus();};
 document.addEventListener('click',event=>{if(event.target.closest?.('#notesBtn')){returnFocus=event.target.closest('button');const modal=document.getElementById('noteModal');modal?.setAttribute('role','dialog');modal?.setAttribute('aria-modal','true');modal?.setAttribute('aria-label','Question notes');}if(event.target.closest?.('#closeNotesBtn,#doneNotesBtn'))queueMicrotask(()=>{if(returnFocus?.isConnected)returnFocus.focus();});},true);
 document.addEventListener('keydown',event=>{
 const modal=visibleModal();if(!modal)return;
 if(event.key==='Escape'){event.preventDefault();if(modal.id==='noteModal'){closeNotes();if(returnFocus?.isConnected)returnFocus.focus();}else closeModal();return;}
 if(event.key!=='Tab')return;
 const controls=Array.from(modal.querySelectorAll('button,input,textarea,select,[tabindex="0"]')).filter(node=>!node.disabled&&!node.hidden);
 if(!controls.length)return;const first=controls[0],last=controls.at(-1);
 if(event.shiftKey&&(document.activeElement===first||!modal.contains(document.activeElement))){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))){event.preventDefault();first.focus();}
 });
 addEventListener('pagehide',()=>{remember();disposed=true;clearInterval(state.examTimer);audio()?.pause();});
 });})();`;}
