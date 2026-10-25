import {api} from './api-client.js';
import {privateScope} from './private-scope.js';
/** Explicit stable metadata only. SRS queues, game sets, attempts and answers stay fresh. */
export const CATALOGUES=new Set(['/api/vocabulary/folders','/api/vocabulary/packs','/api/vocabulary?limit=50&offset=0','/api/vocabulary/summary']);
export async function readCatalogue(path,options={}){
 if(!CATALOGUES.has(path)||options.fresh)return api.request(path,options);
 if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');const key='catalogue:'+path,cached=privateScope.get(key);if(cached!==undefined)return structuredClone(cached);
 const identity=privateScope.scope,generation=privateScope.generation,revision=privateScope.revision,result=await api.request(path,options);
 if(identity&&identity===privateScope.scope&&generation===privateScope.generation&&revision===privateScope.revision&&result?.ok!==false&&!result?.error)privateScope.put(key,structuredClone(result));
 return result;
}
