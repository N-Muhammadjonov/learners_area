/** Decorate the owner's existing Script controls. No copied material, grading,
 * progress writer or media owner. Drafts remain in the existing source bridge. */
export function originalScriptAccessibility(){return `(()=>{document.addEventListener('DOMContentLoaded',()=>{
 if(typeof renderScript!=='function'||!document.getElementById('scriptTabs'))return;
 const tabs=document.getElementById('scriptTabs');let disposed=false;
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Script parts');
 const decorate=()=>{const host=document.getElementById('scriptHost');if(!host)return;
 host.setAttribute('role','tabpanel');host.setAttribute('aria-label','Script Completion · Part '+scriptPart);
 for(const tab of tabs.querySelectorAll('[data-spart]')){const selected=Number(tab.dataset.spart)===scriptPart;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(selected));tab.setAttribute('aria-controls','scriptHost');tab.tabIndex=selected?0:-1;}
 for(const input of host.querySelectorAll('[data-gap]')){input.maxLength=4000;input.setAttribute('aria-label','Part '+scriptPart+' · gap '+input.dataset.gap);const result=host.querySelector('[data-gapresult="'+input.dataset.gap+'"]');if(result){result.id='la-script-result-'+input.dataset.gap;input.setAttribute('aria-describedby',result.id);}}
 const score=host.querySelector('#scriptScore');score?.setAttribute('role','status');score?.setAttribute('aria-live','polite');
 for(const id of ['checkScriptPart','checkScript','retryGaps','retryScript'])document.getElementById(id)?.setAttribute('aria-controls','scriptHost');
 document.querySelector('#scriptAudio [data-arange]')?.setAttribute('aria-label','Script audio position');};
 const render=renderScript;renderScript=function(){if(disposed)return;const value=render.apply(this,arguments);decorate();return value;};
 const key=event=>{const tab=event.target.closest?.('[data-spart]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const available=[...tabs.querySelectorAll('[data-spart]')],index=available.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?available.length-1:(index+(event.key==='ArrowRight'?1:available.length-1))%available.length;const part=available[next]?.dataset.spart;available[next]?.click();tabs.querySelector('[data-spart="'+part+'"]')?.focus();};
 tabs.addEventListener('keydown',key);decorate();addEventListener('pagehide',()=>{disposed=true;tabs.removeEventListener('keydown',key);},{once:true});});})();`;}
