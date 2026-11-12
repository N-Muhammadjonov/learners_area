/** One-time landing-to-plan navigation intent, never an authorization or test score. */
const KEY='la:public-plan-intent:v1';
const DESTINATION='/app/assignments#study-plan-30';
const TTL_MS=60*60*1000;
export const LANDING_PLAN_DESTINATION=DESTINATION;

export function markLandingPlanIntent(now=Date.now()){
  try{
    if(Number.isFinite(now))sessionStorage.setItem(KEY,String(now));
  }catch{}
}

export function clearLandingPlanIntent(){
  try{sessionStorage.removeItem(KEY);}catch{}
}

export function consumeLandingPlanIntent(now=Date.now()){
  try{
    const raw=sessionStorage.getItem(KEY);
    if(raw===null)return null;
    const started=Number(raw);
    sessionStorage.removeItem(KEY);
    if(!Number.isSafeInteger(started)||started<0||now<started||
       now-started>TTL_MS)return null;
    return DESTINATION;
  }catch{return null;}
}
