import {el,listen} from '../js/dom.js';
import {landscape} from '../js/components/landscape.js';
import {brandBlock} from '../js/components/brand.js';
import marks from '../js/components/marks.js';
import {entryDestination} from '../js/session.js';
import {dictionary,readPreferences} from '../js/preferences.js';
export async function mount({root,signal,navigate}){
 const dict=await dictionary(readPreferences().locale),t=dict.landing;
 const wrapper=el('div',{'data-root-entry':''}),touch=el('div',{'data-touch-welcome':''});
 const cta=el('a',{role:'link',tabindex:'0','aria-disabled':'true','data-landing-cta':'',class:'la-welcome-cta mt-10 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-gold px-7 py-3 text-base font-semibold text-ink-950 transition-colors hover:bg-gold-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink-900'},t.cta,el('span',{'aria-hidden':'true'},'→'));
 const error=el('p',{role:'alert',class:'mt-4 text-sm text-band-bad'});error.hidden=true;let destination,checking,busy=false;
 function resolveDestination(){if(destination)return Promise.resolve(destination);if(checking)return checking;checking=entryDestination(signal).then(path=>{if(signal.aborted)return;destination=path;cta.href=path;cta.dataset.landingCtaDestination=path;cta.removeAttribute('aria-disabled');error.hidden=true;return path;}).catch(e=>{if(!signal.aborted){error.textContent=dict.auth.errorNetwork;error.hidden=false;}throw e;}).finally(()=>checking=null);return checking;}
 async function proceed({replace=false}={}){if(signal.aborted||busy)return;busy=true;cta.setAttribute('aria-disabled','true');try{const path=await resolveDestination();if(!signal.aborted&&path)await navigate(path,{replace});}catch{}finally{busy=false;if(destination)cta.removeAttribute('aria-disabled');}}
 listen(cta,'click',e=>{if(destination&&(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0))return;e.preventDefault();e.stopPropagation();void proceed();},signal);
 listen(cta,'keydown',e=>{if(e.key==='Enter'&&!cta.hasAttribute('href')){e.preventDefault();void proceed();}},signal);
 const orbit=el('div',{class:'la-welcome-orbit','aria-hidden':'true'});
 ['listening','reading','writing','speaking','grammar','vocabulary'].forEach((kind,index)=>{const holder=el('span',{class:'module-emoji','aria-hidden':'true'}); // Static trusted SVG geometry only; no response or user text enters this parser.
 const parser=new DOMParser();const doc=parser.parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">${marks[kind]}</svg>`,'image/svg+xml');holder.append(document.importNode(doc.documentElement,true));orbit.append(el('span',{class:`la-welcome-chip la-welcome-chip-${index}`},holder));});
 touch.append(el('div',{'data-theme':'night',class:'la-welcome flex min-h-dvh flex-col text-ink-900',style:{backgroundColor:'#0a1a39',colorScheme:'dark',paddingLeft:'env(safe-area-inset-left)',paddingRight:'env(safe-area-inset-right)'}},landscape(),el('div',{class:'px-6 pt-6'},el('a',{href:'https://t.me/learners_area',target:'_blank',rel:'noopener noreferrer','aria-label':dict.shell.telegramBrand,'data-landing-brand-link':'',class:'la-welcome-brand-link inline-flex rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'},brandBlock())),el('main',{class:'la-welcome-main flex flex-1 flex-col items-center justify-center px-6 py-16 text-center'},orbit,el('h1',{class:'la-welcome-heading max-w-4xl font-display text-4xl font-bold leading-tight tracking-tight text-ink-900 sm:text-5xl md:text-6xl'},el('span',{class:'la-welcome-text block'},t.headlineLead),' ',el('span',{class:'la-welcome-text la-welcome-text-second mt-1 block'},t.headlineWith,' ',el('span',{class:'text-gold'},t.headlineAccent))),el('span',{'aria-hidden':'true',class:'mt-8 block h-px w-24 bg-gold/70 sm:w-32','data-landing-divider':''}),cta,error),el('footer',{class:'px-6 pb-8 text-center text-xs text-ink-300',style:{paddingBottom:'calc(2rem + env(safe-area-inset-bottom))'},'data-landing-footer':''},t.footer)));
 wrapper.append(touch);root.append(wrapper);
 void resolveDestination().catch(()=>{});
}
