import {el} from '../js/dom.js';
export async function mount({root,url}){
 // Deliberately a migration status surface, NOT an imitation of the original page.
 root.append(el('main',{'data-migration-unavailable':'',class:'mx-auto max-w-xl p-6'},el('h1',{class:'font-display text-xl text-ink-900'},'Migration candidate — route not converted'),el('p',{class:'mt-4 text-ink-700'},'This route is recorded in the source inventory but is not implemented in this checkpoint. No protected content, account privileges, or educational data is simulated.'),el('p',{class:'mt-4 text-sm text-ink-500'},url.pathname),el('a',{href:'/',class:'btn-secondary mt-4'},'Return to entry')));
}
