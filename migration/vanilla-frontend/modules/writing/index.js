import {loadStyle,WRITING_TABS,missing} from './shared.js';
/** Original Writing URLs; the existing shell remains the navigation/permission owner. */
export async function mount(context){
 loadStyle();
 const path=context.url.pathname.replace(/\/+$/,'');
 let module;
 if(path==='/app/writing')module=await import('./home.js');
 else if(path==='/app/writing/history')module=await import('./submissions.js');
 else if(/^\/app\/writing\/(?:prompts|submissions)\/[^/]+$/.test(path))module=await import('./submissions.js');
 else if(/^\/app\/writing\/lessons\/[^/]+$/.test(path))module=await import('./lessons.js');
 else if(/^\/app\/writing\/exam\/[^/]+$/.test(path))module=await import('./exam.js');
 else if(/^\/app\/writing\/grade\/[^/]+$/.test(path))module=await import('./grade.js');
 else if(/^\/app\/writing\/translation\/[^/]+$/.test(path))module=await import('./translation.js');
 else if(/^\/app\/writing\/language-stealing\/[^/]+$/.test(path))module=await import('./stealing.js');
 if(context.signal.aborted)return;
 if(module)return module.mount(context);
 context.root.append(missing(context));
}
export {WRITING_TABS};
