import {accountResult} from './adapters/account.js';
import {SESSION_CHANNEL,SESSION_STORAGE,localSessionEvent,publishSessionEvent} from './session-events.js';
import {api} from './api-client.js';
import {privateScope} from './private-scope.js';
/** Port of AccessChangeListener: event-driven, coalesced authority reconciliation,
 * one disconnect check; no periodic polling, local role grants or client re-grading. */
export function watchAuthority(session,{navigate,refresh,signal,window:win=window,document:doc=document,scope=privateScope,request=api.request,EventSource:Events=globalThis.EventSource,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let status=session.user.accountStatus,closed=false,stream=null,pending=false,queued=false,requestController,timer,role=session.user.role,opened=false,checkedDisconnect=false;
 const identity=scope.scope;
 const live=()=>!closed&&scope.scope===identity;
 const logout=()=>{if(!live())return;scope.setScope(null);stop();void navigate('/login',{replace:true});};
 function schedule(seconds){clearTimer(timer);if(!Number.isSafeInteger(seconds))return;const remaining=seconds*1000-now();if(remaining<=0){logout();return;}timer=setTimer(()=>schedule(seconds),Math.min(remaining,2147000000));}
 async function update(){if(!live())return;if(pending){queued=true;return;}pending=true;requestController=new AbortController();const deadline=setTimer(()=>requestController?.abort(),8000);
  try{const state=await request('/api/auth/state',{signal:requestController.signal});if(!live())return;if(!['student','teacher','admin','owner'].includes(state.role)||!['active','pending','suspended','rejected'].includes(state.accountStatus))return;if(status==='active'&&state.accountStatus!=='active'){logout();return;}if(status!==state.accountStatus){status=state.accountStatus;scope.clear('authority-change');void refresh();return;}if(Number.isSafeInteger(state.expiresAt))schedule(state.expiresAt);if(role!==state.role){role=state.role;scope.clear('authority-change');void refresh();}}
  catch(error){if(live()&&error.status===401)logout();}
  finally{clearTimer(deadline);requestController=null;pending=false;if(queued&&live()){queued=false;void update();}}
 }
 function connect(){if(!live()||!session.accessEventsEnabled||stream||!Events)return;stream=new Events('/api/auth/changes',{withCredentials:true});stream.addEventListener('access-changed',()=>{win.dispatchEvent(new win.Event('learners-area:authority-hint'));void update();});stream.addEventListener('open',()=>{checkedDisconnect=false;if(opened)void update();opened=true;});stream.addEventListener('error',()=>{if(!checkedDisconnect){checkedDisconnect=true;void update();}});stream.addEventListener('unavailable',()=>{stream?.close();stream=null;void update();});}
 let storageUsable=false;try{const storage=win.localStorage;if(storage){storage.setItem('learners-area:signal-probe','1');storage.removeItem('learners-area:signal-probe');storageUsable=true;}}catch{}
 const reconcile=()=>{if(!live())return;connect();if(!channel&&!storageUsable){scope.clear('authority-change');void refresh();return;}void update();},visible=()=>{if(doc.visibilityState==='visible')reconcile();};
 let channel=null;try{if(typeof win.BroadcastChannel==='function')channel=new win.BroadcastChannel(SESSION_CHANNEL);}catch{}
 const changed=data=>{const kind=data==='logout'?'logout':localSessionEvent(data);if(kind==='logout')logout();else if(kind==='refresh'&&live()){scope.clear('authority-change');void refresh();}};if(channel)channel.onmessage=e=>changed(e.data);const storage=e=>{if(e.key===SESSION_STORAGE&&e.newValue)try{changed(JSON.parse(e.newValue));}catch{}};win.addEventListener('storage',storage);
 function stop(){if(closed)return;closed=true;clearTimer(timer);requestController?.abort();stream?.close();channel?.close();win.removeEventListener('learners-area:auth-failure',logout);win.removeEventListener('storage',storage);win.removeEventListener('online',reconcile);win.removeEventListener('pageshow',reconcile);doc.removeEventListener('visibilitychange',visible);signal?.removeEventListener('abort',stop);}
 if(signal?.aborted){stop();return {stop,reconcile:update};}schedule(session.expiresAt);if(closed)return {stop,reconcile:update};connect();win.addEventListener('learners-area:auth-failure',logout);win.addEventListener('online',reconcile);win.addEventListener('pageshow',reconcile);doc.addEventListener('visibilitychange',visible);signal?.addEventListener('abort',stop,{once:true});return {stop,reconcile: update};
}
export async function logoutSession({signal,navigate}){accountResult(await api.request('/api/auth/logout',{method:'POST',signal}),'mutation');if(signal?.aborted)return;publishSessionEvent('logout');privateScope.setScope(null);api.clear();await navigate('/login',{replace:true});}
