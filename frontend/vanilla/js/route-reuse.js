import {privateScope} from './private-scope.js';
/** Only settled, passive views may survive navigation. Never retain exams or players. */
const PASSIVE=new Set(['/app/dashboard','/app/progress','/app/reading/lessons','/app/reading/academic','/app/reading/general','/app/listening/lessons','/app/listening/academic','/app/listening/tests','/app/listening/general','/app/listening/mcq','/app/grammar/lessons','/app/video-lessons']);
const ACTIVE='audio,video,iframe,canvas,dialog[open],[data-retention-session-region],[data-reading-full-focus],[data-async-loading],[aria-busy="true"],.animate-pulse,[role="status"],[role="alert"],input:not([type="search"]),textarea,[contenteditable="true"]';
/** Retention budget by device capability. The eligibility rules stay identical;
 * only how many settled passive views are kept, for how long, and how many DOM
 * nodes they may occupy together changes. Small/low-memory devices keep fewer
 * views so the retained tree cannot dominate their heap. */
export function retentionProfile(win=typeof window==='undefined'?undefined:window){
 const nav=win?.navigator,coarse=win?.matchMedia?.('(pointer: coarse)')?.matches===true,width=win?.innerWidth??0;
 const memory=typeof nav?.deviceMemory==='number'?nav.deviceMemory:null;
 if(memory!==null&&memory<=2)return {name:'low-memory',limit:2,maxNodes:4000,ttl:20000};
 if(coarse||(width>0&&width<768))return {name:'mobile',limit:3,maxNodes:6000,ttl:25000};
 if(width>0&&width<1024)return {name:'tablet',limit:4,maxNodes:7000,ttl:30000};
 return {name:'desktop',limit:4,maxNodes:8000,ttl:60000};
}
export function createRouteReuse(options={}){
 const profile=retentionProfile(options.window),scope=options.scope??privateScope;
 const limit=options.limit??profile.limit,maxNodes=options.maxNodes??profile.maxNodes,ttl=options.ttl??profile.ttl,clock=options.clock??Date.now;
 const entries=new Map();let nodes=0;
 const presentation=()=>typeof document==='undefined'?'':document.documentElement.lang+':'+(document.querySelector('meta[name="la-build"]')?.content??'source');
 const valid=e=>!!scope.scope&&e.identity===scope.scope&&e.generation===scope.generation&&e.revision===scope.revision&&e.presentation===presentation()&&e.expiry>clock()&&!e.controller.signal.aborted;
 function drop(key){const e=entries.get(key);if(!e)return;entries.delete(key);nodes-=e.nodeCount;e.controller.abort('view-evicted');e.dispose?.();for(const key of Object.keys(e.context.state??{}))delete e.context.state[key];e.staging.replaceChildren();}
 function clear(){for(const key of [...entries.keys()])drop(key);}
 const stop=scope.subscribe(clear);
 return {
  stamp:()=>({identity:scope.scope,generation:scope.generation,revision:scope.revision,presentation:presentation(),expiry:clock()+ttl}),
  eligible(entry){return !!entry.context.session&&entry.context.route?.protected&&PASSIVE.has(entry.context.url.pathname)&&entry.context.route.layout!=='focus'&&valid(entry)&&entry.nodes.length>0&&entry.nodes.every(n=>n.nodeType===1&&!n.matches(ACTIVE)&&!n.querySelector(ACTIVE));},
  take(key){const e=entries.get(key);if(!e)return;if(!valid(e)){drop(key);return;}entries.delete(key);nodes-=e.nodeCount;return e;},
  put(key,e){if(!this.eligible(e))return false;const count=e.nodes.reduce((sum,n)=>sum+1+n.querySelectorAll('*').length,0);if(count>maxNodes)return false;drop(key);for(const fn of e.pause??[])try{fn();}catch{}for(const n of e.nodes)e.staging.append(n);e.nodeCount=count;entries.set(key,e);nodes+=count;while(entries.size>limit||nodes>maxNodes)drop(entries.keys().next().value);return true;},
  clear,destroy(){clear();stop();},get size(){return entries.size;},get nodeCount(){return nodes;},get profile(){return {...profile,limit,maxNodes,ttl};},
 };
}
