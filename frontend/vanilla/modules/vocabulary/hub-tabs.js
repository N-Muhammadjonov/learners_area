import {h} from './shared.js';

/** One navigable vocabulary tab bar for the hub and all game routes. */
export function vocabularyHubTabs(ctx,active,gameQuery=''){
 const icons={words:'📦',revision:'🔁',games:'🎮',use:'✍️',board:'🏆',dictionary:'📖'};
 const paths={
  words:'/app/vocabulary',
  revision:'/app/vocabulary?tab=revision',
  games:'/app/vocabulary/games'+(gameQuery?'?'+gameQuery:''),
  use:'/app/vocabulary?tab=use',
  board:'/app/vocabulary?tab=board',
  dictionary:'/app/vocabulary?tab=dictionary'
 };
 return h('nav',{class:'vocabulary-hub-tabs','data-vocabulary-hub-tabs':'',
  'aria-label':ctx.locale==='uz'?'Vocabulary bo‘limlari':'Vocabulary sections'},
  Object.entries(paths).map(([key,href])=>h('a',{
   class:'vocabulary-hub-tab',href,'data-vocabulary-hub-tab':key,
   'aria-current':active===key?'page':null
  },h('span',{'aria-hidden':'true'},icons[key]+' '),ctx.dict.vocabulary.tab[key]??key)));
}
