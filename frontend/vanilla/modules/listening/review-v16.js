/** Runtime-authorized source material only. No curriculum, answers or grader here. */
export function evidenceRange(transcript,evidence){
 if(typeof transcript!=='string'||typeof evidence!=='string'||!evidence.trim())return null;
 const start=transcript.indexOf(evidence);return start<0||transcript.indexOf(evidence,start+1)>=0?null:{start,end:start+evidence.length};
}
export function reviewMaterial(data,part){
 if(!Number.isInteger(part)||part<1||part>4)throw Error('Review part unavailable');
 const range=data?.part_audio_boundaries?.[part],transcript=data?.transcript?.[part];
 const incompleteSource=data?.test_id==='listening-test-10';
 if(!range||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end<=range.start||typeof transcript!=='string'||!incompleteSource&&!transcript.trim())throw Error('Review transcript or audio mapping unavailable');
 for(let q=(part-1)*10+1;q<=part*10;q++){const d=data.questions?.[q];if(typeof data.answers?.[q]!=='string'||!data.answers[q].trim()||data.alternatives?.[q]!==undefined&&(!Array.isArray(data.alternatives[q])||data.alternatives[q].some(v=>typeof v!=='string'||!v.trim()))||!d||d.q!==q||d.part!==part||!['prompt','answer','evidence','why','trap'].every(k=>typeof d[k]==='string')||!['paraphrase','mistakeType'].every(k=>d[k]===undefined||typeof d[k]==='string')||!incompleteSource&&(!Number.isFinite(d.timeStart)||!Number.isFinite(d.timeEnd)||d.timeStart<range.start||d.timeEnd>range.end||d.timeEnd<=d.timeStart))throw Error('Review feedback or question mapping unavailable');}
 return {start:range.start,end:range.end,transcript,incompleteSource};
}
export function reviewProgress(value){
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v),count=v=>Number.isSafeInteger(v)&&v>=0;
 if(!object(value)||Object.keys(value).some(k=>!['activities','completed','total','complete'].includes(k))||!object(value.activities)||!object(value.activities.review)||!count(value.completed)||!count(value.total)||value.completed>value.total||typeof value.complete!=='boolean'||value.complete!==(value.total>0&&value.completed===value.total))throw Error('Invalid Review progress');
 for(const [key,v]of Object.entries(value.activities)){if(!['exam','review','script','mcq','matching','map','multi','completion','vocab','retry'].includes(key)||!object(v)||!count(v.done)||!count(v.total)||v.done>v.total||typeof v.complete!=='boolean'||typeof v.available!=='boolean'||v.total>0&&v.complete!==(v.done===v.total))throw Error('Invalid Review progress');}
 if(value.complete&&Object.values(value.activities).some(v=>v.available&&!v.complete))throw Error('Inconsistent Review completion');
 return value;
}
/** Wrap original renderer/trainer; checking stays the original self-study function. */
export function originalReviewV16(token){return `(()=>{document.addEventListener('DOMContentLoaded',()=>{
 if(typeof renderReview!=='function'||typeof DATA==='undefined')return;
 const material=${reviewMaterial.toString()},locate=${evidenceRange.toString()},token=${JSON.stringify(token)};
 let disposed=false,paintedPart=null,rendering=false,lastView='';
 const reportView=()=>{const reviewActive=active(),part=reviewActive?reviewPart:null,key=reviewActive+':'+part;if(lastView===key)return;lastView=key;parent.postMessage({channel:'learners-area-authored-v1',token,op:'view',hub:document.getElementById('hub')?.style.display!=='none',reviewActive,reviewPart:part},'*');};
 const viewObserver=new MutationObserver(reportView);viewObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','style']});

 const audio=()=>document.getElementById('sharedAudio'),active=()=>document.getElementById('activity-review')?.classList.contains('active');
 const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const train=renderTrainer;renderTrainer=function(el,start,end){if(el?.id==='reviewAudio'&&paintedPart===reviewPart&&trainerCtl&&trainer?.start===start&&trainer?.end===end&&el.querySelector('[data-aplay]'))return;return train(el,start,end);};
 const original=renderReview;renderReview=function(){if(disposed)return;reportView();let data;try{data=material(DATA,reviewPart);}catch(error){stopAllAudio();for(const tab of document.querySelectorAll('[data-rpart]')){const selected=Number(tab.dataset.rpart)===reviewPart;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;tab.classList.toggle('active',selected);}const host=document.getElementById('reviewHost');host.replaceChildren();const p=node('p',error.message);p.setAttribute('role','alert');const retry=node('button','Retry Review');retry.className='btn';retry.onclick=()=>renderReview();host.append(p,retry);return;}
 rendering=true;try{original();paintedPart=reviewPart;}finally{rendering=false;}
 // Source clip buttons are replaced on Check/Retry; never retain a detached clip.
 if(activeClip?.button&&!activeClip.button.isConnected){audio().pause();stopActiveClip();}
 const host=document.getElementById('reviewHost');
 if(data.incompleteSource){
  for(const button of host.querySelectorAll('.evidence button[onclick]')){
   button.removeAttribute('onclick');
   button.textContent='▶ Listen to full Part audio';
   button.setAttribute('aria-label','Listen to the original recording of Part '+reviewPart+'; exact question-specific clip timing has not been verified');
   button.onclick=()=>playWindow(data.start,data.end,button);
  }
 }
 const status=node('p','Self-study checking is separate from server course progress.');status.dataset.reviewProgress='';status.setAttribute('role','status');status.setAttribute('aria-live','polite');host.prepend(status);
 const nav=node('nav');nav.setAttribute('aria-label','Review questions');nav.className='tabs';
 for(const card of host.querySelectorAll('.review-card')){const q=Number(card.querySelector('[data-review-input],[data-review-radio]')?.dataset.reviewInput||card.querySelector('[data-review-radio]')?.dataset.reviewRadio);if(!q)continue;card.id='la-review-card-'+q;card.tabIndex=-1;const jump=node('button','Q'+q);jump.type='button';jump.className='btn';jump.dataset.reviewQuestion=String(q);jump.setAttribute('aria-controls',card.id);jump.onclick=()=>{card.scrollIntoView({block:'nearest'});card.focus({preventScroll:true});};nav.append(jump);}
 status.after(nav);
 if(!state.reviewChecked.has(reviewPart))return;
 const details=node('details'),summary=node('summary',(data.transcript.trim()?'Full transcript · Part ':'Verified transcript unavailable · Part ')+reviewPart),text=node('div',data.transcript||'The supplied text does not match these questions. No transcript has been verified for this Part.'),message=node('p');details.dataset.reviewTranscript='';text.className='transcript';text.tabIndex=0;text.setAttribute('role','region');text.setAttribute('aria-label','Full transcript for part '+reviewPart);message.setAttribute('role','status');details.append(summary,text,message);host.append(details);
 for(const card of host.querySelectorAll('.review-card')){const q=Number(card.id.replace('la-review-card-',''));const button=node('button','Find Q'+q+' evidence in transcript');button.type='button';button.className='btn';button.dataset.reviewEvidence=String(q);button.onclick=()=>{const hit=locate(data.transcript,DATA.questions[q].evidence);text.replaceChildren();details.open=true;if(hit){text.append(document.createTextNode(data.transcript.slice(0,hit.start)));const mark=node('mark',data.transcript.slice(hit.start,hit.end));mark.tabIndex=-1;text.append(mark,document.createTextNode(data.transcript.slice(hit.end)));mark.scrollIntoView({block:'nearest'});mark.focus({preventScroll:true});message.textContent='Authored evidence selected for Q'+q;}else{text.textContent=data.transcript;message.textContent=data.incompleteSource?'Question-specific audio clip timings have not been verified.':'Evidence is not a unique verbatim transcript passage. Use the authored question audio clip.';text.focus();}};card.append(button);}
 details.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();details.open=false;summary.focus();}});
 };
 const progress=event=>{const d=event.data;if(event.source!==parent||d?.token!==token||d.channel!=='learners-area-review-progress'||!active()||d.part!==reviewPart||disposed)return;const status=document.querySelector('[data-review-progress]');if(!status)return;status.replaceChildren(document.createTextNode(d.phase==='saved'?'Server confirmed course progress. Self-study results are not exam grades.':d.phase==='saving'?'Saving course work. Waiting for server confirmation.':'Course save not confirmed. Own revisions are retained.'));
 if(d.phase==='error'){status.setAttribute('role','alert');const retry=node('button','Retry saving Review');retry.type='button';retry.className='btn';retry.dataset.reviewSaveRetry='';retry.onclick=()=>{const answers={};for(let q=(reviewPart-1)*10+1;q<=reviewPart*10;q++)if(state.reviewAnswers[q]?.trim())answers[q]=state.reviewAnswers[q];parent.postMessage({channel:'learners-area-authored-v1',token,op:'course',activity:'review',answers,manualRetry:true},'*');};status.append(retry);}else status.setAttribute('role','status');};
 addEventListener('message',progress);
 addEventListener('pagehide',()=>{disposed=true;viewObserver.disconnect();removeEventListener('message',progress);});
 });})();`;}
