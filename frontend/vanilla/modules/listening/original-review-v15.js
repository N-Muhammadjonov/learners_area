/** Source-defined Review controls only. No material, verdict or grading replacement. */
export function originalReview(){return `(()=>{document.addEventListener('DOMContentLoaded',()=>{
 if(typeof renderReview!=='function'||!document.getElementById('reviewTabs'))return;
 let disposed=false;const tabs=document.getElementById('reviewTabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Review parts');
 const decorate=()=>{for(const tab of tabs.querySelectorAll('[data-rpart]')){const selected=Number(tab.dataset.rpart)===reviewPart;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;tab.setAttribute('aria-controls','reviewHost');}
 const host=document.getElementById('reviewHost');host.setAttribute('role','tabpanel');host.setAttribute('aria-label','Review questions for part '+reviewPart);
 for(const control of host.querySelectorAll('[data-review-input],[data-review-radio]')){const q=control.dataset.reviewInput||control.dataset.reviewRadio,heading=control.closest('.review-card')?.querySelector('h3');if(heading){heading.id='la-review-question-'+q;control.setAttribute('aria-describedby',heading.id);}if(control.matches('[data-review-input]')){control.maxLength=4000;control.setAttribute('aria-label','Review answer for question '+q);}}
 document.querySelector('#reviewAudio [data-arange]')?.setAttribute('aria-label','Review audio position');const score=host.querySelector('.review-score');score?.setAttribute('role','status');score?.setAttribute('aria-live','polite');for(const id of ['checkReviewPart','retryReviewPart'])document.getElementById(id)?.setAttribute('aria-controls','reviewHost');};
 const render=renderReview;renderReview=function(){if(disposed)return;const result=render();decorate();return result;};
 const key=event=>{const tab=event.target.closest?.('[data-rpart]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let part=Number(tab.dataset.rpart);part=event.key==='Home'?1:event.key==='End'?4:((part-1+(event.key==='ArrowRight'?1:3))%4)+1;tabs.querySelector('[data-rpart="'+part+'"]').click();tabs.querySelector('[data-rpart="'+part+'"]').focus();};tabs.addEventListener('keydown',key);
 addEventListener('pagehide',()=>{disposed=true;tabs.removeEventListener('keydown',key);});
 });})();`;}
