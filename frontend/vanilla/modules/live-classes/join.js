import {el,listen} from '../../js/dom.js';
import {api} from '../../js/api-client.js';
import {joinState,opensAt,safeExternalUrl,localDate} from './contract.js';
/** State is display only; POST /api/live-classes/:id/join is authoritative. */
export function joinControl(ctx,c,attended){
 const {dict,signal,locale}=ctx,t=dict.liveClasses,host=el('div',{'data-live-state':joinState(c)});
 let joined=Boolean(attended),joinedAt=attended||null,pending=false,error='';
 const meeting=safeExternalUrl(c.meetingUrl);
 function draw(){if(signal.aborted)return;const state=joinState(c);host.setAttribute('data-live-state',state);
  if(state==='cancelled'){host.replaceChildren(el('span',{'data-live-cancelled':'',class:'text-xs text-ink-300'},t.status.cancelled));return;}
  if(state==='closed'&&!joined){host.replaceChildren(el('span',{'data-live-closed':'',class:'text-xs text-ink-300'},t.closedWatchRecording));return;}
  if(joined){host.replaceChildren(meeting?el('a',{href:meeting,target:'_blank',rel:'noopener noreferrer',class:'btn-primary','data-live-open-room':''},t.join):el('span',{'data-live-attended':'',class:'text-xs text-band-good'},`${t.joined}${joinedAt?' · '+localDate(joinedAt,locale):''} ✓`));return;}
  if(state==='too_early'){host.replaceChildren(el('span',{'data-live-opens-at':'',class:'text-xs text-ink-300'},`${t.opensAt} ${localDate(opensAt(c),locale)}`));return;}
  const button=el('button',{type:'button',disabled:pending,class:'btn-primary','data-live-join':''},pending?'…':t.join);
  listen(button,'click',async()=>{if(pending||signal.aborted)return;pending=true;error='';draw();
   try{const data=await api.request(`/api/live-classes/${c.id}/join`,{method:'POST',signal,timeoutMs:25000});if(signal.aborted)return;
    if(data?.ok!==true||data?.joined!==true)throw Error('invalid_join_response');joined=true;joinedAt=typeof data.joinedAt==='string'?data.joinedAt:null;
    // The source opens a room after successful POST. Browsers may block async popups;
    // the confirmed, accessible Open Room link always remains available.
    if(meeting)try{window.open(meeting,'_blank','noopener,noreferrer');}catch{}
   }catch(e){if(signal.aborted)return;error=e?.code==='too_early'?`${t.opensAt} ${localDate(opensAt(c),locale)}`:e?.code==='closed'?t.closedWatchRecording:e?.code==='cancelled'?t.status.cancelled:dict.errors.unknown;
   }finally{pending=false;draw();}},signal);
  host.replaceChildren(el('div',{class:'flex flex-col items-end gap-1'},button,error?el('span',{'data-live-join-error':'',class:'text-xs text-band-warn',role:'alert'},error):null));
 }
 draw();return host;
}
