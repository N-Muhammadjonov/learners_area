import {el} from '../../js/dom.js';
import {SectionEntryFrame} from '../../js/generated/SectionEntryFrame.js';
import {sectionEntryFrames} from '../../js/generated/section-entry.js';
import {workspaceKey} from '../../js/generated/interaction-navigation.js';
/** Source loading frame only while an authorized destination is unresolved.
 * It never stands in for ready content, a successful API or a converted page. */
export function workspaceTransition({dict,signal,refresh}){
 const content=el('div',{'data-workspace-content':''}),outgoing=el('div',{'data-outgoing-workspace':''},content),node=el('div',{class:'workspace-transition','aria-busy':'false','data-workspace-transition':''},outgoing),frames=sectionEntryFrames(dict);let frame,notice,timer,stalled,activeSignal,abort;
 function end(){clearTimeout(timer);clearTimeout(stalled);activeSignal?.removeEventListener('abort',abort);activeSignal=null;frame?.remove();notice?.remove();frame=notice=null;outgoing.hidden=false;content.inert=false;node.setAttribute('aria-busy','false');}
 function begin(url,flight){end();activeSignal=flight;abort=end;flight.addEventListener('abort',abort,{once:true});if(flight.aborted)return;
  // Retain a settled outgoing view until the authorized replacement is ready.
  // Its controls are inert so rapid clicks cannot mutate a route being left.
  outgoing.hidden=false;content.inert=true;node.setAttribute('aria-busy','true');
  if(!content.hasChildNodes()){const routeKey=workspaceKey(url.pathname);frame=SectionEntryFrame({routeKey,frame:frames[routeKey]??frames.other,privateBoundary:true});node.append(frame);}
  timer=setTimeout(()=>{if(flight.aborted)return;notice=el('div',{class:'workspace-transition__notice',role:'status','aria-live':'polite','data-navigation-pending':''},dict.common.loading);node.append(notice);},120);
  stalled=setTimeout(()=>{if(flight.aborted)return;const retry=el('button',{type:'button',class:'btn-secondary'},dict.errorPage.retry);retry.addEventListener('click',()=>{if(!flight.aborted)void refresh();});notice?.remove();notice=el('div',{class:'workspace-transition__notice',role:'status','data-workspace-loading':'','data-navigation-pending':''},el('span',{},dict.errors.unknown),retry);node.append(notice);},15000);
 }

 signal.addEventListener('abort',end,{once:true});return {node,content,begin,end};
}
