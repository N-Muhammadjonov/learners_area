/** Only the versioned Test 1 receives this adapter. Uploaded scripts never do. */
export function adaptOriginalTestOne(html: string) {
  return html
    .replace("if(!auto&&!confirm('Submit Listening Test 1? You will see your score, then use Review & Revision for answers and evidence.'))return;", "if(!auto){confirmInFrame('Submit Listening Test 1? You will see your score, then use Review & Revision for answers and evidence.',()=>submitExam(true));return;}")
    .replace("if(!confirm('Leave Exam Mode? Your current attempt will be saved as an exited attempt and the audio will stop.'))return;", "if(!window.laExitConfirmed){confirmInFrame('Leave Exam Mode? Your current attempt will be saved as an exited attempt and the audio will stop.',()=>{window.laExitConfirmed=true;backHub();window.laExitConfirmed=false;});return;}")
    .replace('function startExam(){', "function startExam(){const resume=state.attemptStatus==='in_progress';const checkpoint=getStored();window.laAttemptKey=resume?(checkpoint.attemptKey||crypto.randomUUID()):crypto.randomUUID();")
    .replace('state.answers={};state.flags.clear();', 'if(!resume){state.answers={};state.flags.clear();}')
    .replace('state.examRemaining=Math.round(1645.061);state.reviewRemaining=120;', 'state.examRemaining=Math.max(0,Math.round(1645.061-(resume?(checkpoint.audioPosition||0):0)));state.reviewRemaining=120;')
    .replace('state.reviewPhase=false;saveStored();',"state.reviewPhase=false;$('#sharedAudio').currentTime=resume?(checkpoint.audioPosition||0):0;saveStored();")
    .replace("const a=$('#sharedAudio');a.currentTime=0;", "const a=$('#sharedAudio');a.currentTime=resume?(checkpoint.audioPosition||0):0;")
    .replace('</script></body></html>', `${originalHooks}</script></body></html>`);
}
const originalHooks = `
// Keep confirmations inside the opaque frame; sandbox permissions remain unchanged.
function confirmInFrame(message,accept){showModal('<h2>'+escapeHtml(message)+'</h2><button class="btn" id="laConfirm">Confirm</button> <button class="btn" id="laCancel">Cancel</button>');$('#laConfirm').onclick=()=>{closeModal();accept()};$('#laCancel').onclick=closeModal;}
const originalSaveStored=saveStored;
saveStored=function(){originalSaveStored();const value=getStored();value.attemptKey=window.laAttemptKey||value.attemptKey;value.audioPosition=state.examStarted?($('#sharedAudio').currentTime||0):(value.audioPosition||0);localStorage.setItem(STORAGE_KEY,JSON.stringify(value));};
let checkpointSecond=-1;
$('#sharedAudio').addEventListener('timeupdate',()=>{if(!state.examStarted)return;const second=Math.floor($('#sharedAudio').currentTime/5);if(second!==checkpointSecond){checkpointSecond=second;saveStored();}});
// Source practice answers and position survive leaving the page and another device.
const practiceKey='la_listening_test_1_practice';
let practice={};try{practice=JSON.parse(localStorage.getItem(practiceKey)||'{}')}catch{}
const savePractice=()=>{const active=document.querySelector('.activity.active');if(!active||active.id==='activity-exam')return;const fields={};active.querySelectorAll('input,textarea,select').forEach((el,i)=>{fields[el.id||el.name||String(i)]={value:el.value,checked:el.checked}});practice.views=practice.views||{};practice.views[active.id.replace('activity-','')]={scriptPart,reviewPart,mcqIndex,mcqStage,mcqSelected,mapIndex,multiIndex,completionIndex,fields};localStorage.setItem(practiceKey,JSON.stringify(practice));};
const originalOpenActivity=openActivity;
openActivity=function(id){if(state.attemptStatus==='in_progress'&&id!=='exam'){toast('Resume and finish your current exam before opening study activities.');return;}const savedView=practice.views?.[id],restore=!!savedView;if(restore){scriptPart=savedView.scriptPart||1;reviewPart=savedView.reviewPart||1;mcqIndex=savedView.mcqIndex||0;mcqStage=savedView.mcqStage||1;mcqSelected=savedView.mcqSelected||'';mapIndex=savedView.mapIndex||0;multiIndex=savedView.multiIndex||0;completionIndex=savedView.completionIndex||0;}originalOpenActivity(id);if(restore)document.querySelector('.activity.active').querySelectorAll('input,textarea,select').forEach((el,i)=>{const saved=savedView.fields?.[el.id||el.name||String(i)];if(saved){el.value=saved.value;if('checked'in el)el.checked=!!saved.checked;}});if(id==='exam'&&state.attemptStatus==='in_progress')$('#startTestBtn').textContent='Resume Test';};
for(const event of ['input','change','click'])document.addEventListener(event,()=>queueMicrotask(savePractice));
window.addEventListener('la-checkpoint',e=>{try{const saved=JSON.parse(e.detail[STORAGE_KEY]||'{}');if(saved.attemptStatus===state.attemptStatus&&['submitted','exited'].includes(state.attemptStatus)){state.results=saved.lastResults||state.results;if(state.submitted&&document.querySelector('#globalModal:not(.hidden) h2')?.textContent==='Test Results')showResults();}}catch{}});
window.addEventListener('pagehide',()=>{if(state.examStarted)saveStored();savePractice();});
`;
