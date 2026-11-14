/** Decorate the owner's existing Script controls. No copied material, grading,
 * progress writer or media owner. Drafts remain in the existing source bridge. */
export function originalScriptAccessibility(token){return `(()=>{const token=${JSON.stringify(token)};document.addEventListener('DOMContentLoaded',()=>{
 if(typeof renderScript!=='function'||!document.getElementById('scriptTabs'))return;
 const tabs=document.getElementById('scriptTabs');let disposed=false;
 let savedOccurrences=[];
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Script parts');
 const decorate=()=>{const host=document.getElementById('scriptHost');if(!host)return;
 host.setAttribute('role','tabpanel');host.setAttribute('aria-label','Script Completion · Part '+scriptPart);
 for(const tab of tabs.querySelectorAll('[data-spart]')){const selected=Number(tab.dataset.spart)===scriptPart;tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(selected));tab.setAttribute('aria-controls','scriptHost');tab.tabIndex=selected?0:-1;}
 for(const input of host.querySelectorAll('[data-gap]')){input.maxLength=4000;input.setAttribute('aria-label','Part '+scriptPart+' · gap '+input.dataset.gap);const result=host.querySelector('[data-gapresult="'+input.dataset.gap+'"]');if(result){result.id='la-script-result-'+input.dataset.gap;input.setAttribute('aria-describedby',result.id);}}
 const score=host.querySelector('#scriptScore');score?.setAttribute('role','status');score?.setAttribute('aria-live','polite');
 for(const id of ['checkScriptPart','checkScript','retryGaps','retryScript'])document.getElementById(id)?.setAttribute('aria-controls','scriptHost');
 document.querySelector('#scriptAudio [data-arange]')?.setAttribute('aria-label','Script audio position');};
 const decorateLexical=()=>{
  const host=document.querySelector('#activity-script.active #scriptHost .script-transcript');
  const source=typeof DATA==='object'&&typeof DATA.transcript?.[String(scriptPart)]==='string'?DATA.transcript[String(scriptPart)]:null;
  if(!host||!source)return;
  if(!document.getElementById('la-script-lexical-style')){
   const style=document.createElement('style');style.id='la-script-lexical-style';
   style.textContent='.la-script-lexical-word{text-decoration-line:underline;text-decoration-style:dotted;text-decoration-thickness:1px;text-underline-offset:.2em;text-decoration-color:#4cafff;cursor:help}.la-script-lexical-word[data-lexical-saved="true"]{text-decoration-color:#f8ba36}';
   document.head.append(style);
  }
  const skipped=new Set(['i','you','he','she','it','we','they','me','him','her','us','them','my','your','his','its','our','their','a','an','the','am','is','are','was','were','be','been','being','do','does','did','to','of','in','on','at','and','or','but','if','as','by','for','with']);
  const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),nodes=[];let node;
  while((node=walker.nextNode()))if(!node.parentElement?.closest('.script-gap-wrap'))nodes.push(node);
  let cursor=0;
  for(const textNode of nodes){
   const raw=textNode.nodeValue||'';
   if(!/[A-Za-z]{2}/.test(raw))continue;
   const segment=textNode.parentElement?.closest('[data-script-source-start]');
   const proposed=segment?Number(segment.dataset.scriptSourceStart):-1;
   const at=Number.isSafeInteger(proposed)&&proposed>=0&&source.slice(proposed,proposed+raw.length)===raw
    ?proposed:source.indexOf(raw,cursor);
   if(at<0||source.slice(at,at+raw.length)!==raw)continue;
   const fragment=document.createDocumentFragment();let last=0,m;
   const word=/[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/g;
   while((m=word.exec(raw))){
    fragment.append(document.createTextNode(raw.slice(last,m.index)));
    if(skipped.has(m[0].toLowerCase()))fragment.append(document.createTextNode(m[0]));
    else{
     const element=document.createElement('span');element.className='la-script-lexical-word';
     element.dataset.scriptSourceStart=String(at+m.index);element.dataset.scriptPart=String(scriptPart);
     element.dataset.lexicalSaved='false';element.textContent=m[0];fragment.append(element);
    }
    last=m.index+m[0].length;
   }
   fragment.append(document.createTextNode(raw.slice(last)));
   textNode.replaceWith(fragment);
   cursor=at+raw.length;
  }
  for(const element of host.querySelectorAll('.la-script-lexical-word')){
   const start=Number(element.dataset.scriptSourceStart);
   const finish=start+element.textContent.length;
   element.dataset.lexicalSaved=String(savedOccurrences.some(row=>
    row.section===scriptPart&&row.startChar<=start&&row.endChar>=finish));
  }
 };
 // Repair only a source with gap numbering out of transcript order. All original
 // labels and grading keys stay intact; ambiguous source matches stay untouched.
 if(typeof buildScriptTranscript==='function'){
  const originalTranscript=buildScriptTranscript;
  buildScriptTranscript=function(part){
   const source=typeof DATA==='object'?DATA.transcript?.[String(part)]:null;
   if(typeof source!=='string'||!source)return originalTranscript(part);
   const rows=(DATA.script_completion||[]).filter(g=>g.part===part).sort((a,b)=>a.n-b.n);
   const lowered=source.toLowerCase(),positions=[];
   for(const gap of rows){
    const needle=String(gap.match||'').toLowerCase();
    if(!needle)return originalTranscript(part);
    const at=lowered.indexOf(needle);
    if(at<0||lowered.indexOf(needle,at+1)>=0)return originalTranscript(part);
    positions.push({gap,start:at,end:at+needle.length});
   }
   const ordered=[...positions].sort((a,b)=>a.start-b.start);
   if(ordered.some((item,i)=>i>0&&ordered[i-1].end>item.start))return originalTranscript(part);

   let cursor=0,result='';
   for(const {gap,start,end} of ordered){
    result+='<span data-script-source-start="'+cursor+'">'+escapeHtml(source.slice(cursor,start))+'</span>';
    result+='<span class="script-gap-wrap"><b class="script-gap-number">'+gap.n+'</b><input class="script-gap-input" data-gap="'+gap.q+'" autocomplete="off" aria-label="Part '+part+' gap '+gap.n+'" placeholder=""><span class="script-gap-answer" data-gapresult="'+gap.q+'"></span></span>';
    cursor=end;
   }
   return result+'<span data-script-source-start="'+cursor+'">'+escapeHtml(source.slice(cursor))+'</span>';
  };
 }
 const render=renderScript;renderScript=function(){if(disposed)return;const value=render.apply(this,arguments);decorate();decorateLexical();return value;};
 const key=event=>{const tab=event.target.closest?.('[data-spart]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const available=[...tabs.querySelectorAll('[data-spart]')],index=available.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?available.length-1:(index+(event.key==='ArrowRight'?1:available.length-1))%available.length;const part=available[next]?.dataset.spart;available[next]?.click();tabs.querySelector('[data-spart="'+part+'"]')?.focus();};
 const showSaved=()=>{
  const host=document.querySelector('#activity-script.active #scriptHost .script-transcript');
  if(!host)return;
  for(const element of host.querySelectorAll('.la-script-lexical-word')){
   const start=Number(element.dataset.scriptSourceStart),end=start+element.textContent.length;
   element.dataset.lexicalSaved=String(savedOccurrences.some(row=>
    row.section===scriptPart&&row.startChar<=start&&row.endChar>=end));
  }
 };
 const receive=event=>{
  if(disposed||event.source!==parent||event.data?.token!==token)return;
  const packet=event.data;
  if(packet.channel==='learners-area-script-saved'&&Array.isArray(packet.savedOccurrences)){
   savedOccurrences=packet.savedOccurrences.filter(row=>Number.isInteger(row.section)&&
    Number.isSafeInteger(row.startChar)&&Number.isSafeInteger(row.endChar)&&
    row.endChar>row.startChar);
   showSaved();
  }else if(packet.channel==='learners-area-script-save-status'){
   const {part,start,end,saved}=packet;
   if(!Number.isInteger(part)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start)return;
   savedOccurrences=savedOccurrences.filter(row=>!(row.section===part&&row.startChar<=start&&row.endChar>=end));
   if(saved)savedOccurrences.push({section:part,startChar:start,endChar:end});
   showSaved();
  }
 };
 addEventListener('message',receive);
 tabs.addEventListener('keydown',key);decorate();decorateLexical();addEventListener('pagehide',()=>{disposed=true;removeEventListener('message',receive);tabs.removeEventListener('keydown',key);},{once:true});});})();`;}
