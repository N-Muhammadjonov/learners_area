/** Memory policies are presentation freshness, never an authorization grant. */
const CATALOGUES=new Set(['/app/listening/lessons','/app/listening/academic','/app/listening/tests','/app/listening/general','/app/listening/mcq','/app/reading/lessons','/app/reading/academic','/app/reading/general','/app/reading/question-types','/app/writing','/app/speaking','/app/speaking/lessons','/app/grammar/lessons','/app/video-lessons']);
export function viewPolicy(route){
 let url;try{url=new URL(route,'https://local.invalid');}catch{return null;}
 if(!route.startsWith('/')||url.origin!=='https://local.invalid'||url.hash||route.length>2048)return null;
 if(url.pathname==='/app/dashboard'||url.pathname==='/app/progress')return {ttl:10000,staleTtl:50000,snapshot:true};
 // Time-sensitive assignments/notifications and dynamic examination state are NEVER cached.
 // Stable learner catalogues use the existing bounded, identity-scoped memory only.
 // Writing tabs can include active exercises; only the ordinary catalogue has a snapshot.
 if(url.pathname==='/app/writing'&&url.search&&url.searchParams.get('tab')!=='lessons')return null;
 return CATALOGUES.has(url.pathname)?{ttl:120000,staleTtl:0}:null;
}
export function cataloguePolicy(path){return path==='/api/vocabulary/summary'?{ttl:10000}:path==='/api/vocabulary/folders'||path==='/api/vocabulary/packs'?{ttl:120000}:{ttl:30000};}
export function presentationKey(kind,path){
 const version=typeof document==='undefined'?'source':document.querySelector('meta[name="la-build"]')?.content??'source';
 const locale=typeof document==='undefined'?'':document.documentElement.lang;
 return kind+':'+version+':'+locale+':'+path;
}
// These writes contain presence/preferences only, and do not change learning records.
export const affectsLearningData=path=>!['/api/presence','/api/theme','/api/locale'].includes(path.split('?')[0]);
