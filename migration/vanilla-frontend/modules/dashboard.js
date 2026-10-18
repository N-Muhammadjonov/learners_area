import {el} from '../js/dom.js';
import {viewData,requireFields} from '../js/adapters/frontend.js';
export function mount(context){const {root,dict,signal,url}=context;const host=el('div',{'data-dashboard-native':''},el('div',{role:'status','aria-busy':'true','aria-label':dict.common.loading,class:'h-40 animate-pulse rounded-xl bg-ink-50'}));root.append(host);
 void (async()=>{try{const result=requireFields(await viewData(url.pathname+url.search,signal),url.pathname==='/app'?['dashboard','openLessonsResult','mock']:['mock']);requireFields(result.mock,['tests','attempts','attemptsUnavailable','catalogueUnavailable','attemptTitlesUnavailable']);
 for(const a of result.mock.attempts)for(const k of ['startedAt','finishedAt'])if(a[k])a[k]=new Date(a[k]);const {render}=await import(url.pathname==='/app'?'../js/generated/dashboard.js':'../js/generated/mocks.js');if(!signal.aborted)host.replaceChildren(render({...result,context,dict,locale:context.locale,user:context.session.user}));
 }catch(e){if(!signal.aborted)host.replaceChildren(el('p',{role:'alert','data-integration-required':'dashboard',class:'text-sm text-band-bad'},dict.auth.errorServer));}})();
}
