import {el} from '../dom.js';
import {brandBlock} from './brand.js';
import {controls} from './controls.js';
export function authShell(context,{title,subtitle,children,footer}){
 const {dict}=context;
 return el('div',{'data-shell':'','data-auth-shell':'',class:'relative flex min-h-dvh items-center justify-center bg-paper-sunken px-4 pb-6 pt-24'},controls(context),
 el('div',{class:'w-full max-w-sm'},el('a',{href:'https://t.me/learners_area',target:'_blank',rel:'noopener noreferrer','aria-label':dict.shell.telegramBrand,class:'mx-auto mb-6 flex w-fit max-w-full items-center justify-center rounded-sm px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-600','data-auth-brand':''},brandBlock('justify-center')),
 el('div',{class:'card p-6'},el('h1',{class:'font-display text-xl text-ink-900'},title),subtitle?el('p',{class:'mt-1 text-sm text-ink-500'},subtitle):null,el('div',{class:'mt-5'},children)),footer?el('div',{class:'mt-4 text-center text-sm text-ink-500'},footer):null));
}
