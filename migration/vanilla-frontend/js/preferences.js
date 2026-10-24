import {withOverlays} from './i18n/with-overlays.js';
import {accountResult} from './adapters/account.js';
import {api,ApiError} from './api-client.js';
export function cookie(name){return document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);}
export function readPreferences(){return {theme:cookie('la_theme')==='night'?'night':'day',locale:cookie('la_locale')==='en'?'en':'uz'};}
export async function dictionary(locale){return withOverlays((await import(`./i18n/${locale==='en'?'en':'uz'}.js`)).default,locale==='en'?'en':'uz');}
export async function setPreference(key,value,signal){
 if(!({theme:['day','night'],locale:['uz','en']}[key]??[]).includes(value))throw Error('Invalid preference');
 const result=accountResult(await api.request('/api/'+key,{method:'POST',body:{[key]:value},signal}),'mutation');if(result[key]!==undefined&&result[key]!==value)throw new ApiError(502,'invalid_response');
}
