import {safeNextPath} from './safe-next.js';
/** Only our recorded in-app predecessor can send Back through browser history. */
export function previousAppPath(win=window){
 const state=win.history.state,raw=state?.__laFrom;
 if(typeof state?.__laEntry!=='string'||typeof raw!=='string')return null;
 const safe=safeNextPath(raw);if(!safe||!/^\/app(?:\/|\?|#|$)/.test(safe))return null;
 const current=win.location.pathname+win.location.search+win.location.hash;
 return safe===current?null:safe;
}
export const plainPrimaryClick=event=>!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;
