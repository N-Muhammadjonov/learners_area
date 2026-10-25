import {h,TABS,GAMES,chip,notice} from './shared.js';
import {mountWords} from './words.js';
import {mountRevision} from './revision.js';
import {mountUse} from './use.js';
import {mountBoard} from './board.js';
import {mountDictionary} from './dictionary.js';
import {mountGames} from './games.js';
import {searchBox} from './search.js';
/** Original vocabulary layout and route-entry semantics; shell provides auth, locale and theme. */
export function mount(ctx){const {root,url,dict,navigate,signal}=ctx;const path=url.pathname;const leaf=path.split('/').at(-1);if(path==='/app/vocabulary/review'){void navigate('/app/vocabulary?tab=revision',{replace:true});return;}
 if(path==='/app/vocabulary/games'){const shell=h('div',{'data-route-usable':'vocabulary-games'});root.append(shell);mountGames(ctx,shell);return;}
 if(path.startsWith('/app/vocabulary/games/')){if(!GAMES.includes(leaf)){root.append(h('p',{role:'alert'},dict.errors.notFound));return;}const shell=h('div',{'data-route-usable':'vocabulary-game'});root.append(shell);mountGames(ctx,shell,leaf);return;}
 if(path!=='/app/vocabulary'){root.append(h('p',{role:'alert'},dict.errors.notFound));return;}
 const query=url.searchParams.get('tab');if(query==='games'){void navigate('/app/vocabulary/games',{replace:true});return;}
 const tab=['use','board','revision','dictionary'].includes(query)?query:'words';const t=dict.vocabulary,workspace=h('div',{class:'mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4','data-route-usable':'vocabulary','data-vocabulary-route':'','data-vocabulary-workspace':''});
 const top=h('div',{class:'flex flex-wrap items-end justify-between gap-3'},h('div',{},h('h1',{class:'font-display text-2xl text-ink-900','data-vocabulary-title':''},t.title),h('p',{class:'mt-1 text-sm text-ink-500'},tab==='dictionary'?dict.globalDictionary.description:t.search.hint)));
 if(tab!=='dictionary')top.append(searchBox(ctx,hit=>{if(tab==='words'){const node=[...workspace.querySelectorAll('[data-vocab-entry]')].find(n=>n.dataset.vocabEntry===hit.id);const button=node?.querySelector('button');if(button?.getAttribute('aria-expanded')!=='true')button?.click();node?.scrollIntoView?.({behavior:'smooth',block:'nearest'});}else void navigate('/app/vocabulary');}));
 const main=h('div',{id:'vocabulary-panel',role:'region','aria-label':t.tab[tab],'data-vocabulary-panel':tab,class:'flex flex-col gap-4'});workspace.append(top,main);root.append(workspace);
 if(tab==='dictionary')mountDictionary(ctx,main);
 else {const area=h('div',{class:'grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'});const body=h('div',{class:'flex min-w-0 flex-col gap-4'}),aside=h('aside',{class:'flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start'});area.append(body,aside);main.append(area);
  if(tab==='words')mountWords(ctx,body);else if(tab==='revision')mountRevision(ctx,body);else if(tab==='use')mountUse(ctx,body);else mountBoard(ctx,body,{compact:true});if(tab!=='board')mountBoard(ctx,aside,{compact:false});aside.append(h('div',{class:'card p-4'},h('h2',{class:'text-sm font-medium text-ink-900'},t.games.casualNote),h('p',{class:'mt-2 text-xs text-ink-500'},t.games.hint)));}
 signal.addEventListener('abort',()=>workspace.remove(),{once:true});}
