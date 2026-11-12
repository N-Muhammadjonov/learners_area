import {h,TABS,GAMES,chip,notice} from './shared.js';
import {rewardBadge} from '../shared/coin-reward.js';
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
 let tab=['use','board','revision','dictionary'].includes(query)?query:'words';
 const t=dict.vocabulary,workspace=h('div',{class:'mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-4','data-route-usable':'vocabulary','data-vocabulary-route':'','data-vocabulary-workspace':''});
 const top=h('div',{class:'flex flex-wrap items-end justify-between gap-3'}),main=h('div',{id:'vocabulary-panel',role:'region',class:'flex flex-col gap-4'});
 workspace.append(top,main);root.append(workspace);let child;
 function select(next){
  child?.abort('vocabulary-tab-left');child=new window.AbortController();const own={...ctx,url:next,signal:child.signal};
  tab=['use','board','revision','dictionary'].includes(next.searchParams.get('tab'))?next.searchParams.get('tab'):'words';ctx.url=next;
  main.dataset.vocabularyPanel=tab;main.setAttribute('aria-label',t.tab[tab]);main.replaceChildren();
  top.replaceChildren(h('div',{class:'flex flex-col gap-2'},h('h1',{class:'font-display text-2xl text-ink-900','data-vocabulary-title':''},t.title),tab==='dictionary'?null:rewardBadge(own,'vocabulary'),tab==='dictionary'?null:h('p',{class:'mt-1 text-sm text-ink-500'},tab==='board'?t.board.hint:t.search.hint)));
  if(tab!=='dictionary'&&tab!=='board')top.append(searchBox(own,hit=>{if(tab==='words'){const node=[...workspace.querySelectorAll('[data-vocab-entry]')].find(n=>n.dataset.vocabEntry===hit.id),button=node?.querySelector('button');if(button?.getAttribute('aria-expanded')!=='true')button?.click();node?.scrollIntoView?.({behavior:'smooth',block:'nearest'});}else void navigate('/app/vocabulary');}));
  if(tab==='dictionary')mountDictionary(own,main);
  else if(tab==='board')mountBoard(own,main,{compact:true});
  else{
   const area=h('div',{class:'grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]'}),body=h('div',{class:'flex min-w-0 flex-col gap-4'}),aside=h('aside',{class:'flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start'});
   area.append(body,aside);main.append(area);
   if(tab==='words')mountWords(own,body);else if(tab==='revision')mountRevision(own,body);else if(tab==='use')mountUse(own,body);else mountBoard(own,body,{compact:true});
   if(tab!=='board')mountBoard(own,aside,{compact:false});aside.append(h('div',{class:'card p-4'},h('h2',{class:'text-sm font-medium text-ink-900'},t.games.casualNote),h('p',{class:'mt-2 text-xs text-ink-500'},t.games.hint)));
  }
 }
 const switchTab=next=>{if(signal.aborted||next.pathname!=='/app/vocabulary'||next.searchParams.get('tab')==='games'||ctx.session?.expiresAt&&ctx.session.expiresAt*1000<=Date.now())return false;select(next);return true;};
 ctx.onNavigate?.(switchTab);ctx.onHistory?.(switchTab);
 signal.addEventListener('abort',()=>{child?.abort('vocabulary-left');workspace.remove();},{once:true});select(url);
}

