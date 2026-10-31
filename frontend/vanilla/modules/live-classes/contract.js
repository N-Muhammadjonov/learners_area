/** Source: main src/lib/services/live-classes/window.ts — display only, server gates POST. */
export const JOIN_OPENS_BEFORE_MS=15*60*1000;
export const JOIN_CLOSES_AFTER_MS=30*60*1000;
export const STATES=['upcoming','scheduled','live','ended','completed','recording_processing','recording_ready','recorded','recording_unavailable','cancelled'];
export const YOUTUBE_ID_RE=/^[A-Za-z0-9_-]{11}$/;

export function joinState(c,now=new Date()){
 if(c.status==='cancelled')return 'cancelled';
 if(c.status==='live')return 'open';
 if(c.status==='completed'||c.status==='ended'||c.status==='recorded')return 'closed';
 const start=Date.parse(c.scheduledAt),end=start+c.durationMinutes*60000;
 if(now.getTime()<start-JOIN_OPENS_BEFORE_MS)return 'too_early';
 if(now.getTime()>end+JOIN_CLOSES_AFTER_MS)return 'closed';
 return 'open';
}

export const opensAt=c=>new Date(Date.parse(c.scheduledAt)-JOIN_OPENS_BEFORE_MS);

const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const str=v=>typeof v==='string';
const optStr=v=>v===null||v===undefined||str(v);
const iso=v=>str(v)&&Number.isFinite(Date.parse(v));
const optIso=v=>v===null||v===undefined||iso(v);
const uuid=v=>str(v)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fail=()=>{throw new TypeError('invalid_live_classes_projection');};

export function extractYoutubeId(raw){
 if(!str(raw)||!raw.trim())return null;
 const s=raw.trim();
 if(YOUTUBE_ID_RE.test(s))return s;
 try{
  const u=new URL(s);
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
  const h=u.hostname.toLowerCase();
  const parts=u.pathname.split('/').filter(Boolean);
  let id=null;
  if(h==='youtu.be'||h==='www.youtu.be'){if(parts.length===1)id=parts[0];}
  else if(h==='studio.youtube.com'){if(parts.length>=2&&parts[0]==='video')id=parts[1];}
  else if(['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(h)){
   if(parts.length===1&&parts[0]==='watch')id=u.searchParams.get('v');
   else if(parts.length===2&&['live','embed','shorts','v'].includes(parts[0]))id=parts[1];
  }
  return id&&YOUTUBE_ID_RE.test(id)?id:null;
 }catch{return null;}
}

export function youtubeThumbnailUrl(videoId){
 return str(videoId)&&YOUTUBE_ID_RE.test(videoId)?`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`:null;
}

/** Official YouTube IFrame Player API embed URL.
 * Uses supported parameters only: enablejsapi=1, playsinline=1, rel=0, controls=0 (or 1 for recordings), origin.
 * Never uses deprecated modestbranding=1, showinfo, or forced autoplay.
 */
export function liveEmbedUrl(videoId,{origin=null,controls=0}={}){
 if(!str(videoId)||!YOUTUBE_ID_RE.test(videoId))throw new TypeError('invalid_youtube_video_id');
 const params=new URLSearchParams({
  enablejsapi:'1',
  playsinline:'1',
  rel:'0',
  controls:controls?'1':'0',
 });
 if(str(origin)&&/^https?:\/\/[^/?#]+$/i.test(origin)){
  params.set('origin',origin);
 }
 return `https://www.youtube.com/embed/${videoId}?${params.toString()}`;
}

function parseRow(c,kind){
 if(!object(c)||!uuid(c.id)||!str(c.title)||!iso(c.scheduledAt)||!Number.isInteger(c.durationMinutes)||c.durationMinutes<=0||!STATES.includes(c.status)||!optStr(c.meetingUrl)||!optStr(c.recordingUrl)||!optStr(c.teacherUserId)||!optStr(c.topic))fail();
 const ytId=str(c.youtubeVideoId)&&YOUTUBE_ID_RE.test(c.youtubeVideoId)?c.youtubeVideoId:(extractYoutubeId(c.meetingUrl)||extractYoutubeId(c.recordingUrl));
 const recStatus=str(c.recordingStatus)?c.recordingStatus:(c.status==='recorded'?'ready':'none');
 const lifecycle=str(c.lifecycleStatus)?c.lifecycleStatus:(c.status==='live'?'live':c.status==='recorded'||recStatus==='ready'?'recording_ready':c.status==='completed'?(recStatus==='processing'?'recording_processing':recStatus==='unavailable'?'recording_unavailable':'ended'):c.status==='cancelled'?'cancelled':'scheduled');
 return {
  ...c,
  description:str(c.description)?c.description:(c.topic??null),
  youtubeVideoId:ytId,
  thumbnailUrl:str(c.thumbnailUrl)?c.thumbnailUrl:youtubeThumbnailUrl(ytId),
  recordingStatus:recStatus,
  lifecycleStatus:lifecycle,
  recordingDurationSeconds:Number.isInteger(c.recordingDurationSeconds)&&c.recordingDurationSeconds>0?c.recordingDurationSeconds:null,
  kind,
 };
}

export function parseLiveClasses(data){
 // Expected /api/frontend/view?route=%2Fapp%2Flive-classes data payload.
 // There is deliberately no sample/placeholder fallback and no privileged data handling.
 if(!object(data)||typeof data.courseAvailable!=='boolean'||!Array.isArray(data.upcoming)||!Array.isArray(data.past)||!Array.isArray(data.attendance))fail();
 const upcoming=data.upcoming.map(c=>parseRow(c,'upcoming'));
 const past=data.past.map(c=>parseRow(c,'past'));
 const seen=new Set();
 for(const c of [...upcoming,...past]){if(seen.has(c.id))fail();seen.add(c.id);}
 const attendance=new Map();
 for(const a of data.attendance){
  if(!object(a)||!uuid(a.liveClassId)||!iso(a.joinedAt)||!seen.has(a.liveClassId))fail();
  attendance.set(a.liveClassId,a.joinedAt);
 }
 if(data.attendanceUnavailable===true)fail();
 const teachers=new Map();
 if(data.teachers!=null){
  if(!Array.isArray(data.teachers))fail();
  for(const t of data.teachers){
   if(!object(t)||!uuid(t.id)||!str(t.name))fail();
   teachers.set(t.id,t.name);
  }
 }
 const materials=new Map();
 if(data.materials!=null){
  if(!object(data.materials))fail();
  for(const [id,list] of Object.entries(data.materials)){
   if(!seen.has(id)||!Array.isArray(list))fail();
   materials.set(id,list);
  }
 }
 const liveNow=upcoming.filter(c=>c.status==='live');
 const scheduledOnly=upcoming.filter(c=>c.status!=='live');
 const page=object(data.pastPagination)?data.pastPagination:{hasMore:false,nextCursor:null};
 if(typeof page.hasMore!=='boolean'||(page.nextCursor!==null&&page.nextCursor!==undefined&&!str(page.nextCursor))||(page.hasMore&&!page.nextCursor))fail();
 const previousRecordings=past.filter(c=>c.status!=='cancelled'&&(c.lifecycleStatus==='recording_ready'||c.status==='recorded'||c.lifecycleStatus==='recording_processing'));
 return {
  courseAvailable:data.courseAvailable,
  liveNow,
  scheduledOnly,
  upcoming,
  past,
  pastPagination:{hasMore:page.hasMore,nextCursor:page.nextCursor||null},
  previousRecordings,
  attendance,
  teachers,
  materials,
  metadataUnavailable:data.metadataUnavailable===true,
 };
}

export function parseLiveClassDetail(data){
 if(!object(data)||!object(data.liveClass))fail();
 const c=data.liveClass;
 if(!uuid(c.id)||!str(c.title)||!iso(c.scheduledAt)||!Number.isInteger(c.durationMinutes)||c.durationMinutes<=0||!STATES.includes(c.status))fail();
 const ytId=str(c.youtubeVideoId)&&YOUTUBE_ID_RE.test(c.youtubeVideoId)?c.youtubeVideoId:null;
 const recStatus=str(c.recordingStatus)?c.recordingStatus:(c.status==='recorded'?'ready':'none');
 const lifecycle=str(c.lifecycleStatus)?c.lifecycleStatus:(c.status==='live'?'live':c.status==='recorded'||recStatus==='ready'?'recording_ready':c.status==='completed'?(recStatus==='processing'?'recording_processing':recStatus==='unavailable'?'recording_unavailable':'ended'):'scheduled');
 const att=object(data.attendance)?{
  joined:Boolean(data.attendance.joined),
  joinedAt:optIso(data.attendance.joinedAt)?data.attendance.joinedAt:null,
  lastSeenAt:optIso(data.attendance.lastSeenAt)?data.attendance.lastSeenAt:null,
  estimatedDurationSeconds:Number.isInteger(data.attendance.estimatedDurationSeconds)?data.attendance.estimatedDurationSeconds:0,
 }:{joined:false,joinedAt:null,lastSeenAt:null,estimatedDurationSeconds:0};
 const rawChat=object(data.chat)&&Array.isArray(data.chat.messages)?data.chat:{messages:[],hasMore:false,nextBefore:null};
 const messages=rawChat.messages.map(m=>{
  if(!object(m)||!uuid(m.id)||!str(m.body)||!iso(m.createdAt))fail();
  return {
   id:m.id,
   classId:str(m.classId)?m.classId:c.id,
   senderId:str(m.senderId)?m.senderId:'',
   senderName:str(m.senderName)?m.senderName:'Learner',
   senderRole:str(m.senderRole)?m.senderRole:'student',
   body:m.body,
   createdAt:m.createdAt,
  };
 });
 return {
  liveClass:{
   id:c.id,
   title:c.title,
   topic:c.topic??null,
   description:str(c.description)?c.description:(c.topic??null),
   status:c.status,
   lifecycleStatus:lifecycle,
   recordingStatus:recStatus,
   scheduledAt:c.scheduledAt,
   startedAt:optIso(c.startedAt)?c.startedAt:null,
   endedAt:optIso(c.endedAt)?c.endedAt:null,
   durationMinutes:c.durationMinutes,
   recordingDurationSeconds:Number.isInteger(c.recordingDurationSeconds)&&c.recordingDurationSeconds>0?c.recordingDurationSeconds:null,
   teacherUserId:c.teacherUserId??null,
   teacherName:str(c.teacherName)?c.teacherName:null,
   youtubeVideoId:ytId,
   hasYoutubeVideo:Boolean(c.hasYoutubeVideo||ytId),
   thumbnailUrl:str(c.thumbnailUrl)?c.thumbnailUrl:youtubeThumbnailUrl(ytId),
   joinState:str(c.joinState)?c.joinState:joinState(c),
   opensAt:optIso(c.opensAt)?c.opensAt:opensAt(c).toISOString(),
   chatEnabled:c.chatEnabled!==false,
   chatReadOnly:Boolean(c.chatReadOnly??(c.status!=='live')),
  },
  attendance:att,
  chat:{
   messages,
   hasMore:Boolean(rawChat.hasMore),
   nextBefore:str(rawChat.nextBefore)?rawChat.nextBefore:null,
  },
  materials:Array.isArray(data.materials)?data.materials:[],
  canModerate:Boolean(data.canModerate),
  embedOrigin:str(data.embedOrigin)?data.embedOrigin:null,
 };
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
export function localTime(value,locale){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return '—';
 return new Intl.DateTimeFormat(locale==='uz'?'uz-UZ':'en-GB',{timeZone:'Asia/Tashkent',hour:'2-digit',minute:'2-digit'}).format(date);
}
export function minutesFromSeconds(seconds){
 return Number.isFinite(seconds)&&seconds>0?Math.max(1,Math.round(seconds/60)):null;
}

/** Unique per browser tab/room instance; this is correlation data, never authorization. */
export function newAttendanceSessionId(){
 // This ID distinguishes browser tab visits; it is never an authorization token.
 if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
 // UUID format fallback for older browsers lacking crypto.randomUUID.
 const bytes=new Uint8Array(16);
 if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);
 else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
 bytes[6]=(bytes[6]&0x0f)|0x40;
 bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
