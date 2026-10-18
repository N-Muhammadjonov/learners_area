import {passwordForm} from './password-form.js';
import {el} from '../../js/dom.js';
import {dictionary,readPreferences} from '../../js/preferences.js';
import {publicPresentation} from '../../js/adapters/frontend.js';
import {authShell} from '../../js/components/auth-shell.js';
import {safeNextPath} from '../../js/safe-next.js';
import {field,formSubmit,errorNode} from '../shared/forms.js';
import {telegram} from './telegram.js';
export async function mount(context){
 const {root,url,signal,navigate}=context,{locale}=readPreferences(),dict=await dictionary(locale);
 let presentation;try{presentation=await publicPresentation(signal);}catch(e){if(signal.aborted)return;root.append(authShell({...context,dict,locale},{title:dict.auth.loginTitle,children:el('p',{role:'alert','data-integration-required':'public-bootstrap',class:'text-sm text-band-bad'},dict.auth.errorServer)}));return;}
 const auth=presentation.auth,path=url.pathname,register=path==='/register',reset=path.startsWith('/reset-password'),confirm=path.endsWith('/confirm');
 if(reset&&!auth.passwordEnabled){void navigate('/login',{replace:true});return;}
 const title=register?dict.auth.registerTitle:reset?confirm?dict.auth.resetConfirmTitle:dict.auth.resetTitle:dict.auth.loginTitle;
 const subtitle=reset?confirm?undefined:dict.auth.resetSubtitle:auth.telegramOnly?dict.auth.continueWithTelegram:register?dict.auth.registerSubtitle:dict.auth.loginSubtitle;
 const tg=reset?null:telegram({...context,dict},auth,register?'register':'login');
 const form=!reset&&!auth.passwordEnabled?tg:await passwordForm({...context,dict},auth,tg);
 const footer=reset?undefined:[register?dict.auth.haveAccount:dict.auth.noAccount,' ',el('a',{href:register?'/login':'/register',class:'btn-secondary'},register?dict.auth.loginCta:dict.auth.registerCta)];
 root.append(authShell({...context,dict,locale},{title,subtitle,children:form,footer}));
}
