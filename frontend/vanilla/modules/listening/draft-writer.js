import {api,ApiError} from '../../js/api-client.js';
const queues=new Map();

/** One flight and one coalesced latest snapshot per attempt, across SPA remounts.
 * Writes have a bounded lifetime independent of the departing route. */
export function listeningDraftWriter(attemptId,initialHash){
 let state=queues.get(attemptId);
 if(!state){state={hash:initialHash,flight:false,pending:null,blocked:null};queues.set(attemptId,state);}
 async function drain(){
  if(state.flight||!state.pending)return;state.flight=true;
  const job=state.pending;state.pending=null;
  try{
   if(state.blocked)throw state.blocked;
   const body={...job.body,...typeof state.hash==='string'?{expectedDraftHash:state.hash}:{}};
   const result=await api.request('/api/listening/attempts/'+attemptId+'/draft',{method:'PUT',body,timeoutMs:12000,keepalive:new TextEncoder().encode(JSON.stringify(body)).byteLength<60000});
   if(typeof result.draftHash==='string')state.hash=result.draftHash;
   job.waiters.forEach(w=>w.resolve(result));
  }catch(error){
   if([401,403,409].includes(error.status))state.blocked=error;
   job.waiters.forEach(w=>w.reject(error));
  }finally{
   state.flight=false;
   if(state.pending)void drain();else if(queues.get(attemptId)===state)queues.delete(attemptId);
  }
 }
 return {
  get hash(){return state.hash;},
  write(body){
   if(state.blocked)return Promise.reject(state.blocked);
   return new Promise((resolve,reject)=>{
    const snapshot=JSON.parse(JSON.stringify(body));
    if(state.pending){snapshot.startAudio=state.pending.body.startAudio||snapshot.startAudio;state.pending.body=snapshot;state.pending.waiters.push({resolve,reject});}
    else state.pending={body:snapshot,waiters:[{resolve,reject}]};
    queues.set(attemptId,state);void drain();
   });
  },
  reconcile(hash){if(state.flight||state.pending)throw new ApiError(409,'save_pending');state.hash=hash;state.blocked=null;}
 };
}

export function sameListeningAnswers(a,b){
 return Object.keys({...a,...b}).every(key=>(a[key]??'')===(b[key]??''));
}
