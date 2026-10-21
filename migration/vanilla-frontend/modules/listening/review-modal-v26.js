/** Isolate the existing authored vocabulary dialog without changing its markup/style.
 * Own only the temporary inert attributes; disposal is synchronous with lexical scope.
 * No queued focus restoration: the caller alone decides whether its source is current.
 */
export function isolateReviewModal(dialog,signal){
 if(signal.aborted||!dialog.isConnected)return ()=>{};
 const doc=dialog.ownerDocument,owned=new Map();let stopped=false;
 const restore=(node,value)=>{if(value===null)node.removeAttribute('inert');else node.setAttribute('inert',value);};
 const isolate=()=>{if(stopped)return;if(!dialog.isConnected){stop();return;}for(const [node,value]of owned)if(!node.isConnected){restore(node,value);owned.delete(node);}for(let branch=dialog;branch.parentElement;branch=branch.parentElement){
  for(const sibling of branch.parentElement.children)if(sibling!==branch&&!sibling.inert){owned.set(sibling,sibling.getAttribute('inert'));sibling.inert=true;}
  if(branch.parentElement===doc.body)break;
 }};isolate();
 const observer=new doc.defaultView.MutationObserver(isolate);observer.observe(doc.body,{childList:true,subtree:true});
 const focus=event=>{if(!stopped&&dialog.isConnected&&!dialog.contains(event.target))dialog.focus({preventScroll:true});};
 doc.addEventListener('focusin',focus,true);
 function stop(){if(stopped)return;stopped=true;observer.disconnect();doc.removeEventListener('focusin',focus,true);signal.removeEventListener('abort',stop);for(const [node,value]of owned){restore(node,value);}owned.clear();}
 signal.addEventListener('abort',stop,{once:true});return stop;
}
