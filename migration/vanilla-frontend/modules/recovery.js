import {dictionary,readPreferences} from '../js/preferences.js';
import {authShell} from '../js/components/auth-shell.js';
import {passwordForm} from './auth/password-form.js';
/** Source RecoveryPage is LoginForm(recovery), independent of public provider policy. */
export async function mount(context){const {locale}=readPreferences(),dict=await dictionary(locale);const form=await passwordForm({...context,dict,recovery:true},{googleConfigured:false},null);if(!context.signal.aborted)context.root.append(authShell({...context,dict,locale},{title:dict.auth.loginTitle,children:form}));}
