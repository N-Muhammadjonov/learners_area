import {api} from './api-client.js';
import {privateScope} from './private-scope.js';
/** Port of AccessChangeListener: event-driven, coalesced authority reconciliation,
 * one disconnect check; no periodic polling, local role grants or client re-grading. */
export function watchAuthority(session,{navigate,refresh,signal,window:win=window,document:doc=document,scope=privateScope,request=api.request,EventSource:Events=globalThis.EventSource,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let closed=false,stream=null,pending=false,queued=false,requestController,timer,role=session.user.role,opened=false,checkedDisconnect=false;
 const identity=scope.scope;
 const live=()=>!closed&&scope.scope===identity;
 const logout=()=>{if(!live())return;scope.setScope(null);stop();void navigate('/login',{replace:true});};
 function schedule(seconds){clearTimer(timer);if(!Number.isSafeInteger(seconds))return;const remaining=seconds*1000-now();if(remaining<=0){logout();return;}timer=setTimer(()=>schedule(seconds),Math.min(remaining,2147000000));}
 async function update(){if(!live())return;if(pending){queued=true;return;}pending=true;requestController=new AbortController();const deadline=setTimer(()=>requestController?.abort(),8000);
  try{const state=await request('/api/auth/state',{signal:requestController.signal});if(!live())return;if(!['student','teacher','admin','owner'].includes(state.role)||!['active','pending','suspended','rejected'].includes(state.accountStatus))return;if(state.accountStatus!=='active'){logout();return;}if(Number.isSafeInteger(state.expiresAt))schedule(state.expiresAt);if(role!==state.role){role=state.role;scope.clear('authority-change');void refresh();}}
  catch(error){if(live()&&error.status===401)logout();}
  finally{clearTimer(deadline);requestController=null;pending=false;if(queued&&live()){queued=false;void update();}}
 }
 function connect(){if(!live()||!session.accessEventsEnabled||stream||!Events)return;stream=new Events('/api/auth/changes',{withCredentials:true});stream.addEventListener('access-changed',update);stream.addEventListener('open',()=>{checkedDisconnect=false;if(opened)void update();opened=true;});stream.addEventListener('error',()=>{if(!checkedDisconnect){checkedDisconnect=true;void update();}});stream.addEventListener('unavailable',()=>{stream?.close();stream=null;void update();});}
 const reconcile=()=>{connect();void update();},visible=()=>{if(doc.visibilityState==='visible')reconcile();};
 const channel=typeof win.BroadcastChannel==='function'?new win.BroadcastChannel('learners-area:session'):null;
 if(channel)channel.onmessage=e=>{if(e.data==='logout')logout();};
 function stop(){if(closed)return;closed=true;clearTimer(timer);requestController?.abort();stream?.close();channel?.close();win.removeEventListener('learners-area:auth-failure',logout);win.removeEventListener('online',reconcile);win.removeEventListener('pageshow',reconcile);doc.removeEventListener('visibilitychange',visible);signal?.removeEventListener('abort',stop);}
 schedule(session.expiresAt);connect();win.addEventListener('learners-area:auth-failure',logout);win.addEventListener('online',reconcile);win.addEventListener('pageshow',reconcile);doc.addEventListener('visibilitychange',visible);signal?.addEventListener('abort',stop,{once:true});return {stop,reconcile: update};
}
export async function logoutSession({signal,navigate}){await api.request('/api/auth/logout',{method:'POST',signal});if(typeof BroadcastChannel==='function'){const c=new BroadcastChannel('learners-area:session');c.postMessage('logout');c.close();}privateScope.setScope(null);api.clear();await navigate('/login',{replace:true});}
