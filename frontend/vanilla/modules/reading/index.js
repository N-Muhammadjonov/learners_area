import {readingDictionary} from './dictionary.js';
import {readingLegacyDestination} from '../../js/generated/reading-destinations.js';
/** Code-only prewarm of the selected entry; no lesson, answer or active-session reads. */
export async function preload(url){
 const path=url.pathname;
 const file=path==='/app/reading/lessons'?'./lessons.js':path==='/app/reading/academic'?'./academic.js':path==='/app/reading/general'?'./general.js':null;
 if(file)await import(file);
}
/** One entry for every learner Reading route. Each original page maps to one native module below; the Reading
 * dictionary overlay is loaded once per locale. Unknown Reading paths use the shared not-found presentation. */
/** Original (focus)/reading/reading-workspace.css: loaded once for every Reading focus screen, scoped to .reading-focus. */
/** Original globals.css dictionary panel: the contextual popover lives on <body>, so it is loaded for every Reading route. */
function ensureReadingPopoverStyles(){
 if(document.querySelector('link[data-reading-popover-css]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href='/modules/reading/reading-popover.css';link.setAttribute('data-reading-popover-css','');document.head.append(link);
}
function ensureFocusStyles(){
 if(document.querySelector('link[data-reading-focus-css]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href='/modules/reading/reading-workspace.css';link.setAttribute('data-reading-focus-css','');document.head.append(link);
}
/** Original (focus)/reading/layout.tsx: a full-viewport main with no ordinary shell. */
function focusContext(ctx){
 const main=document.createElement('main');main.id='main-content';main.tabIndex=-1;main.className='reading-focus';main.setAttribute('data-reading-full-focus','');
 ctx.root.append(main);
 return {...ctx,root:main};
}
export async function mount(context){
 const {url,navigate}=context;
 ensureReadingPopoverStyles();
 const dict=await readingDictionary(context);
 if(context.signal.aborted)return;
 const ctx={...context,dict},path=url.pathname.replace(/\/+$/,'');
 if(path==='/app/reading'){
  // Original src/app/app/(shell)/reading/page.tsx: a server redirect that keeps legacy query links working.
  const params=Object.fromEntries(url.searchParams);
  void navigate(readingLegacyDestination(params)??'/app/reading/lessons',{replace:true});
  return;
 }
 if(path==='/app/reading/articles')return (await import('./articles.js')).mountArticles(ctx);
 if(/^\/app\/reading\/articles\/[^/]+$/.test(path))return (await import('./articles.js')).mountArticle(ctx);
 if(path==='/app/reading/lessons')return (await import('./lessons.js')).mountLessons(ctx);
 if(/^\/app\/reading\/lessons\/[^/]+$/.test(path))return (await import('./lessons.js')).mountLesson(ctx);
     if(path==='/app/reading/history')return (await import('./history.js')).mountHistory(ctx);
  if(path==='/app/reading/question-types'){
   // Original question-types page: a legacy redirect into General Reading; unknown types are not found.
   const {readingQuestionType}=await import('../../js/generated/reading-lib/question-model.js');
   const {readingLegacyDestination}=await import('../../js/generated/reading-destinations.js');
   const params=Object.fromEntries(url.searchParams);
   if(params.type&&!readingQuestionType(params.type)){const {missing}=await import('../listening/catalogue-v9.js');ctx.root.append(missing(dict));return;}
   void navigate(readingLegacyDestination({...params,tab:'types',type:params.type?readingQuestionType(params.type).id:undefined})??'/app/reading/general',{replace:true});
   return;
  }
  if(/^\/app\/reading\/retention\/results\/[^/]+$/.test(path))return (await import('./retention.js')).mountRetentionResult(ctx);
 if(path==='/app/reading/retention/session')return (await import('./retention.js')).mountRetentionSession(ctx);
 if(path==='/app/reading/retention')return (await import('./retention.js')).mountRetention(ctx);
 if(path==='/app/reading/general')return (await import('./general.js')).mountGeneral(ctx);
  if(/^\/app\/reading\/general\/[^/]+$/.test(path)){ensureFocusStyles();return (await import('./general-session.js')).mountGeneralSession(focusContext(ctx));}
 if(path==='/app/reading/academic')return (await import('./academic.js')).mountAcademicCatalogue(ctx);
  if(/^\/app\/reading\/academic\/[^/]+$/.test(path)){ensureFocusStyles();return (await import('./academic.js')).mountAcademicSet(focusContext(ctx));}
  if(/^\/app\/reading\/attempts\/[^/]+$/.test(path)){ensureFocusStyles();return (await import('./attempt.js')).mountAttempt(focusContext(ctx));}
 const {mount:notFound}=await import('../not-found.js');
 return notFound(ctx);
}
