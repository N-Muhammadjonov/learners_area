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
 const tab=['use','board','revision','dictionary'].includes(query)?query:'words';const t=dict.vocabulary,workspace=h('div',{class:'mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4','data-route-usable':'vocabulary','data-vocabulary-route':'','data-vocabulary-workspace':''});const menu=h('nav',{class:'flex flex-wrap gap-2','aria-label':t.title},TABS.map(k=>h('a',{href:k==='games'?'/app/vocabulary/games':k==='words'?'/app/vocabulary':`/app/vocabulary?tab=${k}`,class:`rounded-md px-3 py-2 text-sm ${k===tab?'bg-signal-600 text-signal-contrast':'bg-paper-sunken text-ink-900'}`,'aria-current':k===tab?'page':undefined,'data-vocab-tab':k},t.tab[k])));
 const top=h('div',{class:'flex flex-wrap justify-between items-center gap-3'},h('h1',{class:'font-display text-2xl'},t.title));const main=h('div',{id:'vocabulary-panel',role:'region','aria-label':t.tab[tab],'data-vocabulary-panel':tab,class:'min-w-0 flex flex-col gap-4'});
 workspace.append(top,menu,main);root.append(workspace);
 if(tab==='dictionary')mountDictionary(ctx,main);
 else if(tab==='board')mountBoard(ctx,main,{compact:false});
 else {const area=h('div',{class:'grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'});const body=h('main',{class:'min-w-0 space-y-4'}),aside=h('aside',{class:'min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start'});area.append(body,aside);main.append(h('div',{class:'flex flex-wrap justify-between items-center'},searchBox(ctx,hit=>{if(tab==='words'){const node=workspace.querySelector(`[data-vocab-entry="${hit.id}"]`);node?.querySelector('button')?.click();node?.scrollIntoView({behavior:'smooth',block:'nearest'});}else void navigate('/app/vocabulary?q='+encodeURIComponent(hit.term));})),area);
  if(tab==='words')mountWords(ctx,body);else if(tab==='revision')mountRevision(ctx,body);else mountUse(ctx,body);mountBoard(ctx,aside,{compact:true});aside.append(h('div',{class:'card p-4'},h('h3',{class:'font-semibold'},t.games.casualNote),notice(t.games.hint)));}
 signal.addEventListener('abort',()=>workspace.remove(),{once:true});}
