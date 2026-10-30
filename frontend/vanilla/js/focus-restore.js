/** Route-refresh-only selection restore, owned by the destination signal. */
export function restoreWhenAttached(node,signal,selection){if(signal.aborted||!node)return;const doc=node.ownerDocument;let observer,timer;
 const stop=()=>{observer?.disconnect();clearTimeout(timer);signal.removeEventListener('abort',stop);};
 const restore=()=>{if(signal.aborted){stop();return;}if(!node.isConnected)return;stop();node.focus({preventScroll:true});if(Number.isInteger(selection?.start)&&typeof node.setSelectionRange==='function')try{node.setSelectionRange(selection.start,selection.end,selection.direction??'none');}catch{}};
 if(node.isConnected){restore();return;}observer=new doc.defaultView.MutationObserver(restore);observer.observe(doc.documentElement,{childList:true,subtree:true});timer=setTimeout(stop,2000);signal.addEventListener('abort',stop,{once:true});
}
export function fieldSelection(node){return {start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection};}
