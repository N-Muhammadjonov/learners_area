import {el} from '../js/dom.js';
import {dictionary,readPreferences} from '../js/preferences.js';
import {render} from '../js/generated/AppError.js';
import {parentFor} from '../js/generated/nav-routes.js';
/** Source error surface. Fixed digest only; a message/stack is never reflected. */
export async function mount(context){const {root,signal,url}=context,dict=context.dict??await dictionary(readPreferences().locale);if(signal.aborted)return;
 const digest=typeof context.error?.digest==='string'&&/^[a-z0-9][a-z0-9_.:-]{0,99}$/i.test(context.error.digest)?context.error.digest:'render_error';
 try{sessionStorage.setItem('learners-area:last-error',digest);}catch{}
 const node=render({dict,parent:parentFor(url.pathname,dict),error:{digest},reset:()=>{if(signal.aborted)return;if(context.error?.code==='module_load_failed')window.location.reload();else void context.refresh();}});
 root.append(context.session?node:el('main',{class:'min-h-dvh bg-paper px-6 text-ink-900'},node));
}
