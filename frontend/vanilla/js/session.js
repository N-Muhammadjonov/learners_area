import {api,ApiError} from './api-client.js';
/** Presentation redirect only. Never grants private content or stores local roles. */
export async function entryDestination(signal){
 try{const state=await api.request('/api/auth/state',{signal});
 if(state.ok!==true||!['owner','admin','teacher','student'].includes(state.role)||!['active','pending','suspended','rejected'].includes(state.accountStatus))throw new ApiError(502,'invalid_response');
 return state.accountStatus==='active'?'/app':'/pending';
 }catch(e){if(e instanceof ApiError&&e.status===401)return '/login';throw e;}
}
export function clearSession(){api.clear();}
