import {accountResult} from './adapters/account.js';
import {SESSION_CHANNEL,SESSION_STORAGE,localSessionEvent,publishSessionEvent} from './session-events.js';
import {api} from './api-client.js';
import {privateScope} from './private-scope.js';
/** An idle session listens. Checks happen on a targeted change or a transport gap,
 * never on a navigation/button click or an interval. Server APIs still authorize. */
export function watchAuthority(session,{navigate,refresh,signal,window:win=window,document:doc=document,scope=privateScope,request=api.request,EventSource:Events=globalThis.EventSource,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let status=session.user.accountStatus,role=session.user.role,closed=false,stream=null,connected=false,opened=false,eventsUnavailable=false,needsReconcile=false,checkedDisconnect=false,pending=false,queued=false,requestController,timer;
 const identity=scope.scope,live=()=>!closed&&scope.scope===identity;
 const logout=()=>{if(!live())return;scope.setScope(null);stop();void navigate('/login',{replace:true});};
 function schedule(seconds){clearTimer(timer);if(!Number.isSafeInteger(seconds))return;const remaining=seconds*1000-now();if(remaining<=0){logout();return;}timer=setTimer(()=>schedule(seconds),Math.min(remaining,2147000000));}
 async function update(force=false){if(!live())return;if(pending){if(force)queued=true;return;}pending=true;requestController=new AbortController();const deadline=setTimer(()=>requestController?.abort(),8000);
  try{const state=await request('/api/auth/state',{signal:requestController.signal});if(!live())return;if(!['student','teacher','admin','owner'].includes(state.role)||!['active','pending','suspended','rejected'].includes(state.accountStatus))return;needsReconcile=false;
   if(status==='active'&&state.accountStatus!=='active'){logout();return;}if(status!==state.accountStatus){status=state.accountStatus;scope.clear('authority-change');void refresh();return;}if(Number.isSafeInteger(state.expiresAt))schedule(state.expiresAt);if(role!==state.role){role=state.role;scope.clear('authority-change');void refresh();}
  }catch(error){if(live()&&error.status===401)logout();}
  finally{clearTimer(deadline);requestController=null;pending=false;if(queued&&live()){queued=false;void update();}}
 }
 function connect(){if(!live()||!session.accessEventsEnabled||eventsUnavailable||stream||!Events)return;
  stream=new Events('/api/auth/changes',{withCredentials:true});
  stream.addEventListener('access-changed',()=>{scope.invalidate('view:');scope.invalidate('catalogue:');needsReconcile=true;win.dispatchEvent(new win.Event('learners-area:authority-hint'));void update(true);});
  stream.addEventListener('session-revoked',logout);
  stream.addEventListener('ready',()=>{connected=true;needsReconcile=false;checkedDisconnect=false;});
  stream.addEventListener('open',()=>{connected=true;if(opened&&needsReconcile&&!checkedDisconnect)void update();opened=true;});
  stream.addEventListener('error',()=>{connected=false;needsReconcile=true;if(!checkedDisconnect&&win.navigator?.onLine!==false){checkedDisconnect=true;void update();}});
  stream.addEventListener('unavailable',()=>{stream?.close();stream=null;connected=false;eventsUnavailable=true;needsReconcile=true;void update();});
 }
 let storageUsable=false;try{const storage=win.localStorage;if(storage){storage.setItem('learners-area:signal-probe','1');storage.removeItem('learners-area:signal-probe');storageUsable=true;}}catch{}
 let channel=null;try{if(typeof win.BroadcastChannel==='function')channel=new win.BroadcastChannel(SESSION_CHANNEL);}catch{}
 const reconcile=()=>{if(!live()||win.navigator?.onLine===false)return;connect();if(connected&&!needsReconcile)return;if(!channel&&!storageUsable&&!session.accessEventsEnabled){scope.clear('authority-change');void refresh();return;}void update();};
 const online=()=>{eventsUnavailable=false;reconcile();},offline=()=>{connected=false;needsReconcile=true;checkedDisconnect=false;},visible=()=>{if(doc.visibilityState==='visible')reconcile();},pageshow=event=>{if(event.persisted)needsReconcile=true;reconcile();};
 const changed=data=>{const kind=data==='logout'?'logout':localSessionEvent(data);if(kind==='logout')logout();else if(kind==='refresh'&&live()){scope.clear('authority-change');void refresh();}};
 if(channel)channel.onmessage=event=>changed(event.data);const storage=event=>{if(event.key===SESSION_STORAGE&&event.newValue)try{changed(JSON.parse(event.newValue));}catch{}};
 function stop(){if(closed)return;closed=true;clearTimer(timer);requestController?.abort();stream?.close();channel?.close();win.removeEventListener('learners-area:auth-failure',logout);win.removeEventListener('storage',storage);win.removeEventListener('online',online);win.removeEventListener('offline',offline);win.removeEventListener('pageshow',pageshow);doc.removeEventListener('visibilitychange',visible);signal?.removeEventListener('abort',stop);}
 if(signal?.aborted){stop();return {stop,reconcile:()=>update(true)};}schedule(session.expiresAt);if(closed)return {stop,reconcile:()=>update(true)};connect();win.addEventListener('learners-area:auth-failure',logout);win.addEventListener('storage',storage);win.addEventListener('online',online);win.addEventListener('offline',offline);win.addEventListener('pageshow',pageshow);doc.addEventListener('visibilitychange',visible);signal?.addEventListener('abort',stop,{once:true});return {stop,reconcile:()=>update(true)};
}
export async function logoutSession({signal,navigate}){accountResult(await api.request('/api/auth/logout',{method:'POST',signal}),'mutation');if(signal?.aborted)return;publishSessionEvent('logout');privateScope.setScope(null);api.clear();await navigate('/login',{replace:true});}
