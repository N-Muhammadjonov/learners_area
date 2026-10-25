import {el} from '../../js/dom.js';
import {studyForm} from './study-form.js';
export function renderOnboarding(context){const {dict}=context;
 return el('div',{class:'flex min-h-dvh items-center justify-center bg-paper-sunken p-4'},el('div',{class:'w-full max-w-xl'},el('div',{class:'card p-6'},el('h1',{class:'font-display text-xl text-ink-900'},dict.onboarding.title),el('p',{class:'mt-1 text-sm text-ink-500'},dict.onboarding.subtitle),el('div',{class:'mt-6'},studyForm(context)))));
}
