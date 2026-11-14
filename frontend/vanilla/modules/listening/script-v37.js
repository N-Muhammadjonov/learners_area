/** Decorate the owner's existing Script controls. No copied material, grading,
 * progress writer or media owner. Drafts remain in the existing source bridge. */
export function originalScriptAccessibility(token,occurrences=[]){return `(()=>{const token=${JSON.stringify(token)},linkedOccurrences=${JSON.stringify(occurrences)};document.addEventListener('DOMContentLoaded',()=>{
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
  const sourceRows=linkedOccurrences.filter(row=>row.part===scriptPart&&
    Number.isSafeInteger(row.start)&&Number.isSafeInteger(row.end)&&row.end>row.start&&
    source.slice(row.start,row.end)===row.surface&&row.occurrenceId);
  const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT),nodes=[];let node;
  while((node=walker.nextNode()))if(!node.parentElement?.closest('.script-gap-wrap,.la-script-lexical-word'))nodes.push(node);
  let cursor=0;
  for(const textNode of nodes){
   const raw=textNode.nodeValue||'';
   if(!raw)continue;
   const segment=textNode.parentElement?.closest('[data-script-source-start]');
   const proposed=segment?Number(segment.dataset.scriptSourceStart):-1;
   const at=Number.isSafeInteger(proposed)&&proposed>=0&&source.slice(proposed,proposed+raw.length)===raw
    ?proposed:source.indexOf(raw,cursor);
   if(at<0||source.slice(at,at+raw.length)!==raw)continue;
   const rows=sourceRows.filter(row=>row.start>=at&&row.end<=at+raw.length).sort((x,y)=>x.start-y.start||y.end-x.end);
   if(!rows.length){cursor=at+raw.length;continue;}
   const fragment=document.createDocumentFragment();let last=0;
   for(const row of rows){
    const begin=row.start-at,end=row.end-at;
    if(begin<last||end>raw.length)continue;
    fragment.append(document.createTextNode(raw.slice(last,begin)));
    const word=document.createElement('span');word.className='la-script-lexical-word';
    word.dataset.scriptSourceStart=String(row.start);word.dataset.scriptPart=String(scriptPart);
    word.dataset.occurrenceId=row.occurrenceId;
    word.dataset.lexicalSaved=String(savedOccurrences.some(saved=>
      saved.section===scriptPart&&saved.startChar<=row.start&&saved.endChar>=row.end));
    word.textContent=raw.slice(begin,end);
    fragment.append(word);last=end;
   }
   fragment.append(document.createTextNode(raw.slice(last)));
   textNode.replaceWith(fragment);cursor=at+raw.length;
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
   let expectedCursor=0;
   for(const gap of rows){
    const needle=String(gap.match||'').toLowerCase();
    if(!needle)return originalTranscript(part);
    let at=lowered.indexOf(needle,expectedCursor);
    if(at<0){
     const unique=lowered.indexOf(needle);
     if(unique<0||lowered.indexOf(needle,unique+1)>=0)return originalTranscript(part);
     at=unique;
    }
    positions.push({gap,start:at,end:at+needle.length});
    expectedCursor=Math.max(expectedCursor,at+needle.length);
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
