import {el} from '../../js/dom.js';
import {SectionEntryFrame} from '../../js/generated/SectionEntryFrame.js';
import {sectionEntryFrames} from '../../js/generated/section-entry.js';
import {workspaceKey} from '../../js/generated/interaction-navigation.js';
/** Source loading frame only while an authorized destination is unresolved.
 * It never stands in for ready content, a successful API or a converted page.
 *
 * A flight that is still unresolved after DESTINATION_GRACE_MS swaps the settled
 * outgoing view for the destination's identity frame (localized title + shape
 * skeletons, `privateBoundary`). That frame is the existing source-loading
 * boundary: it performs no read and carries no private data, so it can appear
 * before the authorized replacement exists. Fast flights keep the settled
 * outgoing view, so an ordinary navigation does not flash a skeleton. */
const DESTINATION_GRACE_MS = 45;
export function workspaceTransition({dict,signal,refresh}){
 const content=el('div',{'data-workspace-content':''}),outgoing=el('div',{'data-outgoing-workspace':''},content),node=el('div',{class:'workspace-transition','aria-busy':'false','data-workspace-transition':''},outgoing),frames=sectionEntryFrames(dict);let frame,notice,timer,stalled,grace,activeSignal,abort;
 function end(){clearTimeout(timer);clearTimeout(stalled);clearTimeout(grace);activeSignal?.removeEventListener('abort',abort);activeSignal=null;frame?.remove();notice?.remove();frame=notice=null;outgoing.hidden=false;content.inert=false;node.setAttribute('aria-busy','false');}
 function showFrame(url){if(frame)return frame;const routeKey=workspaceKey(url.pathname);frame=SectionEntryFrame({routeKey,frame:frames[routeKey]??frames.other,privateBoundary:true});node.append(frame);return frame;}
 function begin(url,flight){end();activeSignal=flight;abort=end;flight.addEventListener('abort',abort,{once:true});if(flight.aborted)return;
  // Retain a settled outgoing view until the authorized replacement is ready.
  // Its controls are inert so rapid clicks cannot mutate a route being left.
  outgoing.hidden=false;content.inert=true;node.setAttribute('aria-busy','true');
  if(!content.hasChildNodes())showFrame(url);
  else grace=setTimeout(()=>{grace=undefined;if(flight.aborted||frame)return;
   // Nothing protected is on screen while the destination is unresolved; the
   // identity frame is the same non-data boundary shown for an empty outlet.
   showFrame(url);outgoing.hidden=true;notice?.remove();notice=null;clearTimeout(timer);timer=undefined;},DESTINATION_GRACE_MS);
  timer=setTimeout(()=>{if(flight.aborted||frame)return;notice=el('div',{class:'workspace-transition__notice',role:'status','aria-live':'polite','data-navigation-pending':''},dict.common.loading);node.append(notice);},120);
  stalled=setTimeout(()=>{if(flight.aborted)return;const retry=el('button',{type:'button',class:'btn-secondary'},dict.errorPage.retry);retry.addEventListener('click',()=>{if(!flight.aborted)void refresh();});notice?.remove();notice=el('div',{class:'workspace-transition__notice',role:'status','data-workspace-loading':'','data-navigation-pending':''},el('span',{},dict.errors.unknown),retry);node.append(notice);},15000);
 }

 signal.addEventListener('abort',end,{once:true});return {node,content,begin,end};
}
