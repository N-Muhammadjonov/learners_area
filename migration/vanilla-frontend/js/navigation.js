/** Exact alias destinations from src/lib/nav/private-modules.mjs. Query strings
 * and fragments survive, with destination-owned query parameters taking priority. */
import {PRIVATE_MODULES,APP_HOME_ALIASES,APP_LEGACY_ALIASES} from './private-modules.js';
export function canonicalPath(url){
 let destination;
 if(APP_HOME_ALIASES.includes(url.pathname))destination='/app';
 else destination=APP_LEGACY_ALIASES.find(a=>a.source===url.pathname)?.destination;
 if(url.pathname==='/app/speaking/shadowing')destination='/app/speaking/lessons';
 if(!destination){const module=PRIVATE_MODULES.find(m=>url.pathname==='/'+m.segment||url.pathname.startsWith('/'+m.segment+'/'));if(module)destination=module.destination+url.pathname.slice(module.segment.length+1);}
 if(!destination)return null;
 const to=new URL(destination,url.origin);for(const [k,v] of url.searchParams)if(!to.searchParams.has(k))to.searchParams.append(k,v);to.hash=url.hash;
 return to.pathname+to.search+to.hash;
}
