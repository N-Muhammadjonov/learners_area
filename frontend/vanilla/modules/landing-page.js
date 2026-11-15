/** Public landing directly mounted in the SPA, with independently cached assets. */
export async function mountLanding({root,signal,navigate}){
 const [{LANDING_MARKUP},{initializeLanding}]=await Promise.all([
  import('./landing-markup.js'),import('./landing-runtime.js')
 ]);
 if(signal.aborted)return;
 const style=document.createElement('link');
 style.rel='stylesheet';style.href='/modules/landing-stage.css';
 style.dataset.landingStyles='';
 const font=document.createElement('link');
 font.rel='stylesheet';font.href='https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700;800&display=swap';
 font.dataset.landingFont='';
 document.head.append(style,font);
 const container=document.createElement('div');
 container.dataset.nativeLanding='';
 container.innerHTML=LANDING_MARKUP;
 root.replaceChildren(container);
 let started=false;
 const start=()=>{
  if(started||signal.aborted||!container.isConnected)return;
  started=true;
  observer.disconnect();
  document.body.classList.add('intro-inverted');
  initializeLanding(container,{signal,navigate});
 };
 const observer=new MutationObserver(start);
 observer.observe(document.documentElement,{childList:true,subtree:true});
 start();
 signal.addEventListener('abort',()=>{
  observer.disconnect();
  document.body.classList.remove('intro-inverted');
  document.body.style.removeProperty('--intro-nav-opacity');
  style.remove();font.remove();
 },{once:true});
}
