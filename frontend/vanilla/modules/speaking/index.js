/** Single lazy entry for learner Speaking routes. All source files are read-only.
 * Frontend structure: HTML5 DOM nodes; CSS3 in speaking.css; state in JS modules. */
let stylesLoaded=false;
function css(){if(stylesLoaded)return;stylesLoaded=true;
 if(document.querySelector('link[data-speaking-css]'))return;
 const link=document.createElement('link');link.rel='stylesheet';link.href='/modules/speaking/speaking.css';link.setAttribute('data-speaking-css','');document.head.append(link);
}
export async function mount(context){
 if(context.signal.aborted)return;
 const path=context.url.pathname.replace(/\/+$/,'');css();
 if(path==='/app/speaking/shadowing')return context.navigate('/app/speaking/lessons',{replace:true});
 const pages={
  '/app/speaking':'./hub.js',
  '/app/speaking/lessons':'./lessons.js',
  '/app/speaking/practice':'./practice.js',
  '/app/speaking/history':'./history.js',
  '/app/speaking/ai':'./ai.js',
  '/app/speaking/live-partner':'./live-partner.js',
 };
 const file=pages[path];if(!file){const {mount}=await import('../not-found.js');return mount(context);}
 const {mount}=await import(file);if(!context.signal.aborted)return mount(context);
}
