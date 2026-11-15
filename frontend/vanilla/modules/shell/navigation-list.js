import {el} from '../../js/dom.js';
import {dockIcon} from './dock-icons.js';
import {dockItems} from './dock.js';
/** Optional labelled navigation, inside Study tools. Uses the Dock's exact role-scoped items. */
export function navigationList(context){
 const details=el('details',{class:'la-navigation-list','data-navigation-list':''}),nav=el('nav',{'aria-label':context.dict.shell.learningNav});
 const segment=context.url.pathname.split('/')[2]||'dashboard',active=context.url.pathname==='/app/study-plan/leaderboard'?'leaderboard':['admin','teacher','owner'].includes(segment)?'management':segment;
 details.append(el('summary',{},context.dict.shell.learningNav),nav);
 for(const item of dockItems(context.dict,context.session.user.role))nav.append(el('a',{href:item.href,...(item.key===active?{'aria-current':'page'}:{}),'data-navigation-list-item':item.key},dockIcon(item.key),el('span',{},item.label)));
 return details;
}
