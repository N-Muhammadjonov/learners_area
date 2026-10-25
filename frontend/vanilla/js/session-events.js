/** Cross-tab invalidation hints only. No identity, role, cookie or bearer value. */
export const SESSION_CHANNEL='learners-area:session',SESSION_STORAGE='learners-area:session-event';
let sequence=0;const received=new Set();
const documentId=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
export function localSessionEvent(value){if(!value||!['logout','refresh'].includes(value.kind)||typeof value.source!=='string'||!value.source||value.source.length>200||value.source===documentId||typeof value.id!=='string'||!value.id||value.id.length>300||received.has(value.id))return null;received.add(value.id);while(received.size>100)received.delete(received.values().next().value);return value.kind;}
export function publishSessionEvent(kind){const message={kind,source:documentId,id:documentId+':'+(++sequence)};if(!['logout','refresh'].includes(kind))throw TypeError('Invalid session event');
 try{if(typeof BroadcastChannel==='function'){const channel=new BroadcastChannel(SESSION_CHANNEL);try{channel.postMessage(message);}finally{channel.close();}}}catch{}
 try{localStorage.setItem(SESSION_STORAGE,JSON.stringify(message));localStorage.removeItem(SESSION_STORAGE);}catch{} // Optional storage fallback, never an auth authority.
}
