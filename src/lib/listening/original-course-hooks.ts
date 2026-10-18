/** Runs only in the allowlisted original opaque runtime; completion comes back from the server. */
export const originalCourseHooks=String.raw`
function laCourseUnit(){const active=document.querySelector('.activity.active');if(active?.id==='activity-vocab')return String(window.laVocabUnit||'').trim().slice(0,160);const card=active?.querySelector('.practice-card');const title=card?.querySelector('h2')?.textContent.trim()||'';const position=card?.querySelector('.muted')?.textContent.trim()||'';return title?(position+'|'+title).slice(0,160):'';}
function laCourseRecord(activity,answers){const clean=Object.fromEntries(Object.entries(answers).filter(([key,value])=>key&&typeof value==='string'&&value.trim()));if(Object.keys(clean).length)window.laCourseWork?.(activity,clean);}
function laCoursePaint(status){
 if(!status)return;
 let panel=document.getElementById('la-course-progress');
 if(!panel){panel=document.createElement('p');panel.id='la-course-progress';panel.className='muted';panel.setAttribute('role','status');document.getElementById('activityCards')?.before(panel);}
 panel.textContent=status.complete?'Test completed. The next test is unlocked.':'Activities completed: '+status.completed+' / '+status.total;
 document.querySelectorAll('[data-open]').forEach(button=>{const result=status.activities[button.dataset.open];if(!result)return;let badge=button.querySelector('[data-course-status]');if(!badge){badge=document.createElement('span');badge.dataset.courseStatus='';badge.style.cssText='display:block;font-size:13px;margin-top:8px;opacity:.8';button.append(badge);}badge.textContent=!result.available?(button.dataset.open==='retry'?'No weak questions':'Not available for this test'):result.complete?'✓ Completed':result.done+' / '+result.total;});
}
addEventListener('la-course-status',e=>laCoursePaint(e.detail));
document.addEventListener('DOMContentLoaded',()=>laCoursePaint(window.laInitialCourseStatus));
document.addEventListener('click',event=>{
 const button=event.target instanceof Element?event.target.closest('button'):null;
 const active=document.querySelector('.activity.active');if(!button||!active||button.disabled)return;
 const activity=active.id.replace('activity-',''),unit=laCourseUnit();let answers={};
 if(activity==='review'&&button.id==='checkReviewPart'){
  active.querySelectorAll('[data-review-input]').forEach(el=>answers[el.dataset.reviewInput]=el.value);
  active.querySelectorAll('[data-review-radio]:checked').forEach(el=>answers[el.dataset.reviewRadio]=el.value);
 }else if(activity==='script'&&['checkScriptPart','checkScript'].includes(button.id)){
  active.querySelectorAll('[data-gap]').forEach(el=>answers[scriptPart+':'+el.dataset.gap]=el.value);
 }else if(activity==='mcq'&&button.id==='checkMcq')answers[unit]=typeof mcqSelected==='undefined'?'':mcqSelected;
 else if(activity==='map'&&button.hasAttribute('data-mapopt'))answers[unit]=button.dataset.mapopt;
 else if(activity==='matching'&&button.hasAttribute('data-matchopt'))answers[unit]=button.dataset.matchopt;
 else if(activity==='multi'&&['checkMulti','multiCheck'].includes(button.id)){const picked=Array.from(active.querySelectorAll('[data-multiopt].selected,[data-multiopt]:checked,[data-multi-practice]:checked')).map(el=>el.dataset.multiopt||el.dataset.multiPractice);if(picked.length>=2)answers[unit]=picked.join(',');}
 else if(activity==='completion'&&button.id==='completionCheck')answers[unit]=document.getElementById('completionAnswer')?.value||'';
 else if(activity==='retry'&&button.id==='retryMultiCheck'){const range=/Questions\s*(\d+)\s*[-–]\s*(\d+)/i.exec(active.querySelector('#retryPractice h2')?.textContent||'');const picked=Array.from(active.querySelectorAll('[data-retry-multi]:checked')).map(el=>el.dataset.retryMulti);if(range&&picked.length===Number(range[2])-Number(range[1])+1)for(let q=Number(range[1]);q<=Number(range[2]);q++)answers[String(q)]=picked.join(',');}
 else if(activity==='vocab'&&button.hasAttribute('data-vopt'))answers[unit]=button.dataset.vopt;
 laCourseRecord(activity,answers);
},true);
const laOriginalRetryFeedback=showRetryFeedback;
showRetryFeedback=function(q,value){laOriginalRetryFeedback(q,value);laCourseRecord('retry',{[String(q)]:String(value)});};
`;
