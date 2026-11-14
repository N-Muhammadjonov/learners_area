import {consumePublicLevelHint} from '../../js/public-level-hint.js';
import {enableDiagnostics} from '../../js/diagnostics.js';
import {api} from '../../js/api-client.js';
import {publishSessionEvent} from '../../js/session-events.js';
import {consumeLandingPlanIntent} from '../../js/plan-entry-intent.js';
import {RegionFailureNotice} from '../shared/presentation.js';
import {passwordForm} from './password-form.js';
import {el,listen} from '../../js/dom.js';
import {dictionary,readPreferences} from '../../js/preferences.js';
import {publicPresentation} from '../../js/adapters/frontend.js';
import {authShell} from '../../js/components/auth-shell.js';
import {telegram} from './telegram.js';
/** Public policy loads inside the stable source AuthShell, not a blank route.
 * Retrying bootstrap never remounts controls or replays an account mutation. */
export async function mount(context){
 // Load the standalone document only on its public routes.
 // srcdoc isolates the original typography, CSS and animations from AuthShell.
 if(context.url.pathname==='/'||context.url.pathname==='/landing'){
  const {root,signal,navigate}=context;
  const fallback=document.querySelector('[data-public-landing-fallback]')?.cloneNode(true);
  if(fallback)root.append(fallback);
  let LANDING_HTML;
  try{({LANDING_HTML}=await import('../landing-inline.js'));}catch{return;}
  if(signal.aborted)return;
  const frame=document.createElement('iframe');
  frame.title='Learners Area — platforma bilan tanishing';
  frame.setAttribute('data-inline-landing','');
  frame.setAttribute('loading','eager');
  frame.style.cssText='display:block;width:100%;height:100dvh;min-height:100vh;border:0;background:#06101f';
  // A srcdoc document inherits the site's nonce-based CSP.
  // Reuse the nonce from the server-rendered module bootstrap.
  const nonce=document.querySelector('script[nonce]')?.nonce;
  if(!nonce)return;
  frame.style.display='none';
  frame.addEventListener('load',()=>{
   if(signal.aborted)return;
   fallback?.remove();
   frame.style.display='block';
  },{once:true,signal});
  frame.addEventListener('error',()=>frame.remove(),{once:true,signal});
  frame.srcdoc=LANDING_HTML.replace(/<script(?=[\s>])/g, '<script nonce="'+nonce+'"');
  const allowed=new Set(['/login','/register']);
  const receive=event=>{
   if(event.source!==frame.contentWindow||event.origin!==window.location.origin)return;
   const message=event.data;
   if(message?.type!=='la:landing:navigate'||typeof message.path!=='string')return;
   const target=new URL(message.path,window.location.origin);
   if(target.origin!==window.location.origin||!allowed.has(target.pathname))return;
   void navigate(target.pathname+target.search+target.hash);
  };
  window.addEventListener('message',receive,{signal});
  root.append(frame);
  return;
 }
 const {root,url,signal,navigate}=context,{locale}=readPreferences(),dict=await dictionary(locale);if(signal.aborted)return;
 const path=url.pathname,register=path==='/register',reset=path.startsWith('/reset-password'),confirm=path.endsWith('/confirm');
 const title=register?dict.auth.registerTitle:reset?confirm?dict.auth.resetConfirmTitle:dict.auth.resetTitle:dict.auth.loginTitle;
 const footer=reset?undefined:[register?dict.auth.haveAccount:'',el('a',{href:register?'/login':'/register',class:'btn-secondary auth-switch-pill'},register?dict.auth.loginCta:(locale==='uz'?'Birinchi marta keldingizmi?':'First time here?'))];
 const region=el('div',{'data-public-auth':''}),shell=authShell({...context,dict,locale},{title,children:region,footer});root.append(shell);let busy=false;
 // A bot-issued login proof is kept in the URL fragment, not a server-visible query.
 // Remove the fragment synchronously before exchanging it for an HttpOnly session.
 if(url.hash.startsWith('#tg-handoff=')){
  const proof=url.hash.slice('#tg-handoff='.length);
  window.history.replaceState(window.history.state,'',url.pathname+url.search);
  const parts=/^([0-9a-fA-F-]{36})\.([0-9a-f]{64})$/.exec(proof);
  if(!parts){
   region.replaceChildren(el('p',{role:'alert'},locale==='uz'?'Kirish havolasi yaroqsiz.':'Invalid sign-in link.'));
   return;
  }
  const intent={intentId:parts[1],browserNonce:parts[2]};
  const complete=async registration=>{
   region.replaceChildren(el('p',{role:'status',class:'text-sm text-ink-500'},
    locale==='uz'?'Kirish tasdiqlanmoqda…':'Signing you in…'));
   try{
    const result=await api.request('/api/auth/telegram/intent/exchange',{
     method:'POST',body:{...intent,...registration},signal
    });
    if(signal.aborted)return;
    void consumePublicLevelHint();
    publishSessionEvent('refresh');
    context.invalidateSession?.();
    const destination=result.accountStatus==='active'?
      (result.role==='guardian'?'/app/progress':result.onboarded?(consumeLandingPlanIntent()??'/app'):'/onboarding'):'/pending';
    await navigate(destination,{replace:true});
   }catch(error){
    if(signal.aborted)return;
    region.replaceChildren(el('p',{role:'alert',class:'text-xs text-band-bad'},
     locale==='uz'
      ?'Kirish havolasi eskirgan yoki yaroqsiz. Botdan yangi havola oling.'
      :'This sign-in link has expired or is invalid. Get a new link from the bot.'));
   }
  };
  if(path!=='/register'){
   await complete({});
   return;
  }
  // First-time Telegram users must supply the registration fields required by
  // the canonical server-side registration exchange. No second Telegram login.
  const name=el('input',{type:'text',name:'name',class:'input w-full',minlength:'3',maxlength:'200',
   required:true,autocomplete:'name',placeholder:locale==='uz'?'Ism va familiya':'Full name'});
  const male=el('input',{type:'radio',name:'gender',value:'male',required:true});
  const female=el('input',{type:'radio',name:'gender',value:'female',required:true});
  const submit=el('button',{type:'submit',class:'btn-primary w-full'},
   locale==='uz'?'Hisob yaratish va davom etish':'Create account and continue');
  const error=el('p',{role:'alert',class:'text-xs text-band-bad'});
  const form=el('form',{class:'flex flex-col gap-3'},
   el('label',{class:'text-sm'},locale==='uz'?'Ism va familiyangiz':'Your full name',name),
   el('fieldset',{},el('legend',{},locale==='uz'?'Jins':'Gender'),
    el('label',{class:'mr-4'},male,locale==='uz'?' Erkak':' Male'),
    el('label',{},female,locale==='uz'?' Ayol':' Female')),
   submit,error);
  listen(form,'submit',event=>{
   event.preventDefault();
   const fullName=name.value.trim().replace(/\s+/g,' ');
   const gender=male.checked?'male':female.checked?'female':null;
   if(!/^\S+(?:\s+\S+)+$/.test(fullName)||fullName.length<3||fullName.length>200||!gender){
    error.textContent=locale==='uz'?'Ism, familiya va jinsni kiriting.':'Enter your full name and gender.';
    return;
   }
   submit.disabled=true;
   void complete({name:fullName,gender});
  },signal);
  region.replaceChildren(form);
  return;
 }

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
