import {api} from './api-client.js';
export function cookie(name){return document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);}
export function readPreferences(){return {theme:cookie('la_theme')==='night'?'night':'day',locale:cookie('la_locale')==='en'?'en':'uz'};}
export async function dictionary(locale){return (await import(`./i18n/${locale==='en'?'en':'uz'}.js`)).default;}
export async function setPreference(key,value,signal){
 if(!({theme:['day','night'],locale:['uz','en']}[key]??[]).includes(value))throw Error('Invalid preference');
 await api.request('/api/'+key,{method:'POST',body:{[key]:value},signal});
}
