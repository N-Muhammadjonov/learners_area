/** DOM-free, monotonic game physics. Values are LA tuning, not Mentora parameters. */
export const ROUND_MS=60000;
export const DIFFICULTIES=Object.freeze({
 beginner:Object.freeze({gracePeriodMs:2100,dangerSpeed:.045,speechActivationMs:80,speechReleaseMs:320,sensitivity:1.15}),
 intermediate:Object.freeze({gracePeriodMs:1100,dangerSpeed:.075,speechActivationMs:110,speechReleaseMs:260,sensitivity:1}),
 advanced:Object.freeze({gracePeriodMs:450,dangerSpeed:.12,speechActivationMs:130,speechReleaseMs:210,sensitivity:.95})
});
/** @typedef {'idle'|'requesting_permission'|'calibrating'|'ready'|'running'|'paused'|'won'|'lost'|'quit'|'error'} GamePhase */
/** @param {{level?:string,now?:()=>number,durationMs?:number,collisionAt?:number}} options */
export function createFluencyEngine({level='intermediate',now=()=>performance.now(),durationMs=ROUND_MS,collisionAt=1}={}){
 if(!DIFFICULTIES[level]||!Number.isFinite(durationMs)||durationMs<=0||!Number.isFinite(collisionAt)||collisionAt<=0||collisionAt>1)throw Error('invalid_game_configuration');
 /** @type {GamePhase} */ let phase='idle';
 let elapsedMs=0,dangerProgress=0,silenceMs=0,speaking=false,last=0,error=null;
 const snapshot=()=>Object.freeze({phase,level,elapsedMs,remainingMs:Math.max(0,durationMs-elapsedMs),durationMs,dangerProgress,silenceMs,speaking,error});
 function reset(next=level){if(!DIFFICULTIES[next])throw Error('invalid_level');level=next;phase='idle';elapsedMs=0;dangerProgress=0;silenceMs=0;speaking=false;error=null;last=0;return snapshot();}
 function advance(at=now(),voice=false){
  if(phase!=='running'||!Number.isFinite(at)||at<last)return snapshot();
  const dt=at-last,config=DIFFICULTIES[level],grace=Math.max(0,config.gracePeriodMs-silenceMs);
  const collisionMs=voice?Infinity:grace+(collisionAt-dangerProgress)/config.dangerSpeed*1000;
  const remaining=durationMs-elapsedMs,used=Math.max(0,Math.min(dt,remaining,collisionMs));
  elapsedMs+=used;last=at;speaking=!!voice;
  if(voice)silenceMs=0;
  else{dangerProgress=Math.min(collisionAt,dangerProgress+Math.max(0,used-grace)/1000*config.dangerSpeed);silenceMs+=used;}
  if(collisionMs<=dt&&collisionMs<=remaining){phase='lost';dangerProgress=collisionAt;speaking=false;}
  else if(elapsedMs>=durationMs){phase='won';elapsedMs=durationMs;speaking=false;}
  return snapshot();
 }
 return {
  snapshot,reset,advance,
  request(){if(phase==='paused'){phase='requesting_permission';error=null;return true;}if(!['idle','won','lost','quit','error'].includes(phase))return false;reset();phase='requesting_permission';return true;},
  permissionGranted(){if(phase==='requesting_permission')phase='calibrating';return snapshot();},
  calibrated(){if(phase==='calibrating')phase='ready';return snapshot();},
  start(at=now()){if(phase==='ready'){phase='running';last=at;speaking=false;}return snapshot();},
  pause(at=now()){if(phase==='running')advance(at,speaking);if(['running','requesting_permission','calibrating','ready'].includes(phase)){phase='paused';speaking=false;}return snapshot();},
  quit(){phase='quit';speaking=false;return snapshot();},
  fail(code){if(!['won','lost','quit'].includes(phase)){phase='error';error=code;speaking=false;}return snapshot();}
 };
}
