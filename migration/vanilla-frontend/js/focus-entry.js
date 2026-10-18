/** Native source intent/replay bus. UI focus only, never an attempt/session grant. */
const listeners=new Set();let pending=null;
export function announceFocusEntry(attemptId){if(typeof window==='undefined'||typeof attemptId!=='string'||!attemptId)return;const intent={attemptId,pathname:window.location.pathname};pending=listeners.size?null:intent;for(const listener of listeners)listener(intent);}
export function subscribeFocusEntry(listener){listeners.add(listener);const replay=pending;pending=null;if(replay)listener(replay);return ()=>listeners.delete(listener);}
/** Route mount calls once for the server-approved attempt identity. */
export function testFocusEntry({identity,signal}){if(!signal?.aborted)announceFocusEntry(identity);return null;}
