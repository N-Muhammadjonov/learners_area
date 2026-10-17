/** Only the versioned Test 1 receives this adapter. Uploaded scripts never do. */
export function adaptOriginalTestOne(html: string) {
  return html
    // Open the ready screen immediately; this cosmetic delay is not exam time.
    .replace("setTimeout(()=>{$('#loadingScreen').classList.add('hidden');$('#startScreen').classList.remove('hidden')},600)", "$('#loadingScreen').classList.add('hidden');$('#startScreen').classList.remove('hidden')")
    .replace("if(!auto&&!confirm('Submit Listening Test 1? You will see your score, then use Review & Revision for answers and evidence.'))return;", "if(!auto){confirmInFrame('Submit Listening Test 1? You will see your score, then use Review & Revision for answers and evidence.',()=>submitExam(true));return;}")
    .replace("if(!confirm('Leave Exam Mode? Your current attempt will be saved as an exited attempt and the audio will stop.'))return;", "if(!window.laExitConfirmed){confirmInFrame('Leave Exam Mode? Your current attempt will be saved as an exited attempt and the audio will stop.',()=>{window.laExitConfirmed=true;backHub();window.laExitConfirmed=false;});return;}")
    .replace('function startExam(){', "function startExam(){const resume=state.attemptStatus==='in_progress';const checkpoint=getStored();window.laAttemptKey=resume?(checkpoint.attemptKey||crypto.randomUUID()):crypto.randomUUID();")
    .replace('state.answers={};state.flags.clear();', 'if(!resume){state.answers={};state.flags.clear();}')
    .replace('state.examRemaining=Math.round(1645.061);state.reviewRemaining=120;', 'state.examRemaining=Math.max(0,Math.round(1645.061-(resume?(checkpoint.audioPosition||0):0)));state.reviewRemaining=120;')
    .replace('state.reviewPhase=false;saveStored();',"state.reviewPhase=false;$('#sharedAudio').currentTime=resume?(checkpoint.audioPosition||0):0;saveStored();")
    .replace("const a=$('#sharedAudio');a.currentTime=0;", "const a=$('#sharedAudio');a.currentTime=resume?(checkpoint.audioPosition||0):0;")
    .replace('</script></body></html>', `${originalHooks}</script></body></html>`);
}
export function adaptOriginalListening(html:string,definition:{number:number;storageKey:string;durationSeconds:number;media:{contentType:string;durationSeconds:number}[]}) {
 const audio=definition.media.filter(m=>m.contentType.startsWith('audio/'));
 const split=audio.length>1;
 const durations=JSON.stringify(audio.map(m=>m.durationSeconds));
 const position=split?`((${durations}).slice(0,audioPart-1).reduce((a,b)=>a+b,0)+($('#sharedAudio').currentTime||0))`:"($('#sharedAudio').currentTime||0)";
 const seek=split?`let laPosition=resume?(checkpoint.audioPosition||0):0;const laDurations=${durations};let laPart=0;while(laPart<laDurations.length-1&&laPosition>=laDurations[laPart])laPosition-=laDurations[laPart++];setAudioPart(laPart+1,true);const a=$('#sharedAudio');a.currentTime=laPosition;`:"const a=$('#sharedAudio');a.currentTime=resume?(checkpoint.audioPosition||0):0;";
 let hooks=originalHooks.replace("const practiceKey='la_listening_test_1_practice';",`const practiceKey='la_listening_test_${definition.number}_practice';`).replace("($('#sharedAudio').currentTime||0)",position);
 // Families without a particular trainer must not reference its absent variable.
 const fields=['scriptPart','reviewPart','mcqIndex','mcqStage','mcqSelected','mapIndex','multiIndex','completionIndex','matchingIndex'];
 const present=fields.filter(name=>new RegExp(`\\b(?:let|const|var)\\s+[^;\\n]*\\b${name}\\s*=`).test(html));
 hooks=hooks.replace('scriptPart,reviewPart,mcqIndex,mcqStage,mcqSelected,mapIndex,multiIndex,completionIndex,fields',present.join(',')+',fields');
 const restore='scriptPart=savedView.scriptPart||1;reviewPart=savedView.reviewPart||1;mcqIndex=savedView.mcqIndex||0;mcqStage=savedView.mcqStage||1;mcqSelected=savedView.mcqSelected||\'\';mapIndex=savedView.mapIndex||0;multiIndex=savedView.multiIndex||0;completionIndex=savedView.completionIndex||0;';
 hooks=hooks.replace(restore,present.map(name=>`${name}=savedView.${name}??${name};`).join(''));
 const output=html
 .replace(/const PARTS\s*=/,"DATA.vocabulary=DATA.vocabulary.map(v=>({...v,headword:v.headword??v.word,type:v.type??v.lexical_type??v.pos,definition:v.definition??v.def,uzbek:v.uzbek??v.uz}));const PARTS=")
 .replace(/const STORAGE_KEY='[^']+'/,`const STORAGE_KEY='${definition.storageKey}'`)
 .replace("setTimeout(()=>{$('#loadingScreen').classList.add('hidden');$('#startScreen').classList.remove('hidden')},600)","$('#loadingScreen').classList.add('hidden');$('#startScreen').classList.remove('hidden')")
 .replace(/if\(!auto&&!confirm\('([^']+)'\)\)return;/,"if(!auto){confirmInFrame('$1',()=>submitExam(true));return;}")
 .replace("if(!confirm('Leave Exam Mode? Your current attempt will be saved as an exited attempt and the audio will stop.'))return;","if(!window.laExitConfirmed){confirmInFrame('Leave Exam Mode? Your current attempt will be saved as an exited attempt and the audio will stop.',()=>{window.laExitConfirmed=true;backHub();window.laExitConfirmed=false;});return;}")
 .replace('function startExam(){',"function startExam(){const resume=state.attemptStatus==='in_progress';const checkpoint=getStored();window.laAttemptKey=resume?(checkpoint.attemptKey||crypto.randomUUID()):crypto.randomUUID();")
 .replace('state.answers={};state.flags.clear();','if(!resume){state.answers={};state.flags.clear();}')
 .replace(/state.examRemaining=[^;]+;state.reviewRemaining=120;/,`state.examRemaining=Math.max(0,Math.round(${definition.durationSeconds}-(resume?(checkpoint.audioPosition||0):0)));state.reviewRemaining=120;`)
 .replace('state.reviewPhase=false;saveStored();',`state.reviewPhase=false;(()=>{${seek}})();saveStored();`)
 .replace("const a=$('#sharedAudio');a.currentTime=0;","const a=$('#sharedAudio');")
 .replace(/<\/script>\s*<\/body>\s*<\/html>\s*$/,hooks+'</script></body></html>');
 if(output===html||!output.includes('const originalSaveStored=saveStored;'))throw Error('Unsupported original source adapter');
 return output;
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
