import {readingLegacyDestination} from './reading-destinations.js';
/** Exact alias destinations from src/lib/nav/private-modules.mjs. Query strings
 * and fragments survive, with destination-owned query parameters taking priority. */
import {PRIVATE_MODULES,APP_HOME_ALIASES,APP_LEGACY_ALIASES} from './private-modules.js';
export function canonicalPath(url){
 let destination;
 if(APP_HOME_ALIASES.includes(url.pathname))destination='/app';
 else destination=APP_LEGACY_ALIASES.find(a=>a.source===url.pathname)?.destination;
 if(!destination){const module=PRIVATE_MODULES.find(m=>url.pathname==='/'+m.segment||url.pathname.startsWith('/'+m.segment+'/'));if(module)destination=module.destination+url.pathname.slice(module.segment.length+1);}
 if(!destination&&!['/app/listening','/app/reading','/app/grammar'].includes(url.pathname))return null;destination??=url.pathname;
 let to=new URL(destination,url.origin);for(const [k,v] of url.searchParams)if(!to.searchParams.has(k))to.searchParams.append(k,v);to.hash=url.hash;
 if(to.pathname==='/app/listening')to.pathname='/app/listening/lessons';
 if(to.pathname==='/app/grammar'&&!to.searchParams.get('tab'))to.pathname='/app/grammar/lessons';
 if(to.pathname==='/app/reading'){const target=readingLegacyDestination(Object.fromEntries(to.searchParams));const next=new URL(!target||target==='/app/reading'?'/app/reading/lessons':target,url.origin);next.hash=to.hash;to=next;}
 const output=to.pathname+to.search+to.hash;return output===url.pathname+url.search+url.hash?null:output;
}
