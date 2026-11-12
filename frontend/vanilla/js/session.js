import {api,ApiError} from './api-client.js';
import {consumeLandingPlanIntent,clearLandingPlanIntent} from './plan-entry-intent.js';
/** Presentation redirect only. Never grants private content or stores local roles. */
export async function entryDestination(signal){
 try{const state=await api.request('/api/auth/state',{signal});
 if(state.ok!==true||!['owner','admin','teacher','student','guardian'].includes(state.role)||!['active','pending','suspended','rejected'].includes(state.accountStatus))throw new ApiError(502,'invalid_response');
 if(state.accountStatus!=='active')return '/pending';
 if(state.role==='guardian'){clearLandingPlanIntent();return '/app/progress';}
 if(['student','owner'].includes(state.role))return consumeLandingPlanIntent()??'/app';
 clearLandingPlanIntent();return '/app';
 }catch(e){if(e instanceof ApiError&&e.status===401)return '/login';throw e;}
}
export function clearSession(){api.clear();}
