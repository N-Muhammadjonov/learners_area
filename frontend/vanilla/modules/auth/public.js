import {enableDiagnostics} from '../../js/diagnostics.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {passwordForm} from './password-form.js';
import {el} from '../../js/dom.js';
import {dictionary,readPreferences} from '../../js/preferences.js';
import {publicPresentation} from '../../js/adapters/frontend.js';
import {authShell} from '../../js/components/auth-shell.js';
import {telegram} from './telegram.js';
/** Public policy loads inside the stable source AuthShell, not a blank route.
 * Retrying bootstrap never remounts controls or replays an account mutation. */
export async function mount(context){
 const {root,url,signal,navigate}=context,{locale}=readPreferences(),dict=await dictionary(locale);if(signal.aborted)return;
 const path=url.pathname,register=path==='/register',reset=path.startsWith('/reset-password'),confirm=path.endsWith('/confirm');
 const title=register?dict.auth.registerTitle:reset?confirm?dict.auth.resetConfirmTitle:dict.auth.resetTitle:dict.auth.loginTitle;
 const footer=reset?undefined:[register?dict.auth.haveAccount:dict.auth.noAccount,' ',el('a',{href:register?'/login':'/register',class:'btn-secondary auth-switch-pill'},register?dict.auth.loginCta:dict.auth.registerCta)];
 const region=el('div',{'data-public-auth':''}),shell=authShell({...context,dict,locale},{title,children:region,footer});root.append(shell);let busy=false;
 async function load(){
  if(busy||signal.aborted)return;busy=true;region.dataset.publicAuth='loading';region.replaceChildren(el('div',{role:'status','aria-busy':'true','aria-label':dict.common.loading,class:'h-32 animate-pulse rounded-xl bg-ink-50'}));
  try{
   const presentation=await publicPresentation(signal),{auth}=presentation;if(signal.aborted)return;if(presentation.diagnostics)void enableDiagnostics(signal);
   if(reset&&!auth.passwordEnabled){void navigate('/login',{replace:true});return;}
   // In Telegram-only mode the notice is public, localised UI copy, not an auth decision.
   // Keep ordinary password-mode subtitles unchanged when password login is enabled.
   const isUz=locale==='uz',telegramOnly=!reset&&auth.telegramOnly;
   const subtitle=reset?confirm?undefined:dict.auth.resetSubtitle:telegramOnly
    ?register
     ?(isUz?"Maxfiylik sababli hozir faqatgina Telegram orqali ro'yxatdan o'tishingiz mumkin":"For privacy reasons, you can currently register only through Telegram.")
     :undefined
    :register?dict.auth.registerSubtitle:dict.auth.loginSubtitle;
   shell.querySelector('[data-auth-subtitle]')?.remove();
   const subtitleNode=telegramOnly&&!register
    ?el('p',{'data-auth-subtitle':'',class:'mt-1 text-sm text-ink-500'},
      isUz?"Maxfiylik sabab hozir faqatgina telegram bot orqali ro'yxatdan o'tishingiz mumkin. Muammo bo'lsa ":"For privacy reasons, registration is currently available only through our Telegram bot. If you need help, contact ",
      el('a',{href:'https://t.me/uzriw',target:'_blank',rel:'noopener noreferrer',class:'auth-contact-link','data-auth-support-link':'','aria-label':isUz?'Nurmuhammad bilan Telegram orqali bog\'lanish':'Contact Nurmuhammad on Telegram'},'Nurmuhammad'),
      isUz?' ga yozing.':'.')
    :subtitle?el('p',{'data-auth-subtitle':'',class:'mt-1 text-sm text-ink-500'},subtitle):null;
   if(subtitleNode)shell.querySelector('.card h1').after(subtitleNode);
   const tg=reset?null:telegram({...context,dict},auth,register?'register':'login');
   const form=!reset&&!auth.passwordEnabled?tg:await passwordForm({...context,dict},auth,tg);if(signal.aborted)return;
   region.dataset.publicAuth='ready';region.replaceChildren(form);
  }catch(e){if(signal.aborted)return;region.dataset.publicAuth='error';region.replaceChildren(el('div',{'data-integration-required':'public-bootstrap'},RegionFailureNotice({region:'public-bootstrap',message:dict.auth.errorServer,retryLabel:dict.common.retry,refresh:load})));}
  finally{busy=false;}
 }
 void load();
}
