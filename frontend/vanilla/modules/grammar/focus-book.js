/** Dedicated Grammar book page. Reuses the original ShadowRoot exercise HTML. */
import {h} from '../../js/native.js';
import {mountBookDetail} from './book.js';
import {mountSkillBookDetail} from './book-skill.js';
import {isValidPracticeBook, isValidPracticeTrack} from './practice-route.js';

export function mount(context) {
  const book = context.url.searchParams.get('book');
  const track = context.url.searchParams.get('track');
  const host = h('div', {
    class:'grammar-focus-page', 'data-route-usable':'grammar-focus-book',
    'data-grammar-focus-book':'',
  });
  context.root.append(host);
  if (!isValidPracticeBook(book) || !isValidPracticeTrack(track)) {
    host.append(h('p',{role:'alert'},context.locale==='en'?
      'Grammar lesson not found.':'Grammar darsi topilmadi.'));
    return;
  }
  if (track) void mountSkillBookDetail(context,host,track,book);
  else void mountBookDetail(context,host,book);
  context.signal.addEventListener('abort',()=>host.replaceChildren(),{once:true});
}
