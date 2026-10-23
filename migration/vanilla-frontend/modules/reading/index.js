import {readingDictionary} from './dictionary.js';
import {readingLegacyDestination} from '../../js/reading-destinations.js';
/** One entry for every learner Reading route. Each original page maps to one native module below; the Reading
 * dictionary overlay is loaded once per locale. Unknown Reading paths use the shared not-found presentation. */
export async function mount(context){
 const {url,navigate}=context;
 const dict=await readingDictionary(context);
 if(context.signal.aborted)return;
 const ctx={...context,dict},path=url.pathname.replace(/\/+$/,'');
 if(path==='/app/reading'){
  // Original src/app/app/(shell)/reading/page.tsx: a server redirect that keeps legacy query links working.
  const params=Object.fromEntries(url.searchParams);
  void navigate(readingLegacyDestination(params)??'/app/reading/lessons',{replace:true});
  return;
 }
 if(path==='/app/reading/lessons')return (await import('./lessons.js')).mountLessons(ctx);
 if(/^\/app\/reading\/lessons\/[^/]+$/.test(path))return (await import('./lessons.js')).mountLesson(ctx);
 const {mount:notFound}=await import('../not-found.js');
 return notFound(ctx);
}
