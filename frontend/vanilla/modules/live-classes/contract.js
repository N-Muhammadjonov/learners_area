/** Source: main src/lib/services/live-classes/window.ts — display only, server gates POST. */
export const JOIN_OPENS_BEFORE_MS=15*60*1000;
export const JOIN_CLOSES_AFTER_MS=30*60*1000;
export const STATES=['upcoming','live','completed','recorded','cancelled'];
export function joinState(c,now=new Date()){
 if(c.status==='cancelled')return 'cancelled';
 if(c.status==='live')return 'open';
 const start=Date.parse(c.scheduledAt),end=start+c.durationMinutes*60000;
 if(now.getTime()<start-JOIN_OPENS_BEFORE_MS)return 'too_early';
 if(now.getTime()>end+JOIN_CLOSES_AFTER_MS)return 'closed';
 return 'open';
}
export const opensAt=c=>new Date(Date.parse(c.scheduledAt)-JOIN_OPENS_BEFORE_MS);
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const str=v=>typeof v==='string';
const url=v=>v===null||v===undefined||str(v);
const iso=v=>str(v)&&Number.isFinite(Date.parse(v));
const uuid=v=>str(v)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fail=()=>{throw new TypeError('invalid_live_classes_projection');};
export function parseLiveClasses(data){
 // Expected proposed /api/frontend/view?route=%2Fapp%2Flive-classes data payload.
 // There is deliberately no sample/placeholder fallback and no privileged data handling.
 if(!object(data)||typeof data.courseAvailable!=='boolean'||!Array.isArray(data.upcoming)||!Array.isArray(data.past)||!Array.isArray(data.attendance))fail();
 const rows=(list,kind)=>list.map(c=>{
  if(!object(c)||!uuid(c.id)||!str(c.title)||!iso(c.scheduledAt)||!Number.isInteger(c.durationMinutes)||c.durationMinutes<=0||!STATES.includes(c.status)||!url(c.meetingUrl)||!url(c.recordingUrl)||!url(c.teacherUserId)||!url(c.topic))fail();
  return {...c,kind};
 });
 const upcoming=rows(data.upcoming,'upcoming'),past=rows(data.past,'past');
 const seen=new Set();for(const c of [...upcoming,...past]){if(seen.has(c.id))fail();seen.add(c.id);}
 const attendance=new Map();for(const a of data.attendance){if(!object(a)||!uuid(a.liveClassId)||!iso(a.joinedAt)||!seen.has(a.liveClassId))fail();attendance.set(a.liveClassId,a.joinedAt);}
 if(data.attendanceUnavailable===true)fail(); // attendance is a core gate
 const teachers=new Map();if(data.teachers!=null){if(!Array.isArray(data.teachers))fail();for(const t of data.teachers){if(!object(t)||!uuid(t.id)||!str(t.name))fail();teachers.set(t.id,t.name);}}
 const materials=new Map();if(data.materials!=null){if(!object(data.materials))fail();for(const [id,list] of Object.entries(data.materials)){if(!seen.has(id)||!Array.isArray(list))fail();materials.set(id,list);}}
 return {courseAvailable:data.courseAvailable,upcoming,past,attendance,teachers,materials,metadataUnavailable:data.metadataUnavailable===true};
}
/** Deliberately strict for source links. Never permit javascript:, data:, credentials or scheme-relative URLs. */
export function safeExternalUrl(raw){
 if(typeof raw!=='string')return null;
 try{const u=new URL(raw);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function safeObjectKey(key){return typeof key==='string'&&key.length>0&&key.length<512&&!key.split('/').includes('..')&&!key.startsWith('/')&&/^[A-Za-z0-9._/-]+$/.test(key)?key:null;}
export function localDate(value,locale,{dayOnly=false}={}){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
 return new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',dayOnly?{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}:{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(date);
}
